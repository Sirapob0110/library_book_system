// src/services/external-api.js
// เรียก Open Library API เพื่อดึงข้อมูลเพิ่มเติมของหนังสือจากเลข ISBN
// พร้อมกลไก: Timeout + Retry (exponential backoff) + Fallback

require('dotenv').config();
const axios = require('axios');

const config = {
  baseUrl: process.env.EXTERNAL_API_BASE_URL || 'https://openlibrary.org',
  timeoutMs: Number(process.env.EXTERNAL_API_TIMEOUT_MS) || 3000, // รอสูงสุดต่อครั้ง
  retries: process.env.EXTERNAL_API_RETRIES !== undefined
    ? Number(process.env.EXTERNAL_API_RETRIES) : 2,                // ลองใหม่ได้อีก 2 ครั้ง (รวม 3 ครั้ง)
  backoffMs: Number(process.env.EXTERNAL_API_BACKOFF_MS) || 300    // 300ms, 600ms, ...
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ควร retry เมื่อ: network error, timeout, หรือ HTTP 5xx เท่านั้น
// (4xx เป็นความผิดของ request เอง ลองใหม่ก็ไม่หาย)
function isRetryable(err) {
  if (err.response) return err.response.status >= 500;
  return true; // ไม่มี response = network error / timeout / DNS fail
}

function describeError(err) {
  if (err.response) return `HTTP ${err.response.status}`;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return `timeout (>${config.timeoutMs}ms)`;
  return err.code || err.message;
}

// เรียก API หนึ่งครั้ง พร้อม timeout
async function callOnce(isbn) {
  const res = await axios.get(`${config.baseUrl}/api/books`, {
    params: { bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'data' },
    timeout: config.timeoutMs
  });
  return res.data;
}

// เรียกพร้อม retry: คืน { data, attempts } หรือ throw { attempts, lastError }
async function callWithRetry(isbn) {
  const maxAttempts = config.retries + 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await callOnce(isbn);
      console.log(`[external-api] attempt ${attempt}/${maxAttempts} สำเร็จ`);
      return { data, attempts: attempt };
    } catch (err) {
      lastError = err;
      console.warn(`[external-api] attempt ${attempt}/${maxAttempts} ล้มเหลว: ${describeError(err)}`);

      if (!isRetryable(err) || attempt === maxAttempts) {
        const e = new Error(describeError(err));
        e.attempts = attempt;
        throw e;
      }
      const delay = config.backoffMs * 2 ** (attempt - 1);
      console.warn(`[external-api] รอ ${delay}ms ก่อนลองใหม่`);
      await sleep(delay);
    }
  }
  throw lastError; // ไม่ควรมาถึงตรงนี้
}

// ฟังก์ชันหลักที่ route เรียกใช้ — ไม่ throw เสมอ (fallback เมื่อล้มเหลว)
async function lookupBookByIsbn(isbn) {
  try {
    const { data, attempts } = await callWithRetry(isbn);
    const info = data[`ISBN:${isbn}`];

    if (!info) {
      return { source: 'open-library', found: false, attempts, external: null,
               message: 'ไม่พบข้อมูลเลข ISBN นี้ใน Open Library' };
    }
    return {
      source: 'open-library',
      found: true,
      attempts,
      external: {
        title: info.title || null,
        publishers: (info.publishers || []).map((p) => p.name),
        publish_date: info.publish_date || null,
        number_of_pages: info.number_of_pages || null,
        cover_url: info.cover ? info.cover.medium || info.cover.small || null : null,
        url: info.url || null
      }
    };
  } catch (err) {
    // Fallback: ไม่ crash — แจ้งผู้ใช้ชัดเจนว่าข้อมูลภายนอกใช้ไม่ได้ชั่วคราว
    console.error(`[external-api] ล้มเหลวหลัง retry ครบ (${err.attempts} ครั้ง): ${err.message}`);
    return {
      source: 'fallback',
      found: false,
      attempts: err.attempts,
      external: null,
      message: 'ไม่สามารถดึงข้อมูลเพิ่มเติมจาก Open Library ได้ในขณะนี้ แสดงเฉพาะข้อมูลในระบบ กรุณาลองใหม่ภายหลัง',
      fallback_reason: err.message
    };
  }
}

module.exports = { lookupBookByIsbn, config };
