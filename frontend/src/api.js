// ชั้นเรียก API ของหน้าเว็บ
// - access token (อายุ 15 นาที) เก็บในตัวแปรหน่วยความจำเท่านั้น ไม่เก็บใน sessionStorage/localStorage
// - refresh token อยู่ใน cookie httpOnly ที่ JavaScript อ่านไม่ได้ ใช้ผ่าน /api/auth/refresh
// - ได้ 401 แล้วลอง refresh หนึ่งครั้งแล้วยิงคำขอเดิมซ้ำ

function getApiUrl(value, name) {
  const url = value?.trim();

  if (!url) {
    throw new Error(
      `ไม่พบ ${name} กรุณาตั้งค่าในไฟล์ frontend/.env.local แล้วเริ่ม Vite ใหม่`,
    );
  }

  return url.replace(/\/+$/, "");
}

export const BOOK_API = getApiUrl(import.meta.env.VITE_BOOK_API_URL, "VITE_BOOK_API_URL");
export const CIRCULATION_API = getApiUrl(
  import.meta.env.VITE_CIRCULATION_API_URL,
  "VITE_CIRCULATION_API_URL",
);

const NETWORK_ERROR =
  "ไม่สามารถเชื่อมต่อ API ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่และ URL ถูกต้อง";
const RETRY_DELAY_MS = 700;

let accessToken = null;
let sessionLostHandler = null;
let refreshing = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => {
  accessToken = token || null;
};
// เรียกเมื่อเซสชันหมดอายุจริง (refresh ไม่ได้) เพื่อพากลับหน้าเข้าสู่ระบบ
export const setSessionLostHandler = (handler) => {
  sessionLostHandler = handler;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function parse(response) {
  return response.json().catch(() => ({}));
}

function messageOf(result, response) {
  return result.error || result.message || `API ตอบกลับด้วย HTTP ${response.status}`;
}

async function send(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}

// ขอ access token ใหม่ด้วย refresh cookie; คืน {token,user} หรือ null ถ้าไม่มีเซสชัน
// เรียกพร้อมกันหลายที่จะแชร์คำขอเดียว (single-flight) เพราะ refresh token ใช้ได้ครั้งเดียว
export function refreshSession() {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await send(`${BOOK_API}/api/auth/refresh`, { method: "POST" });

    if (response.ok) {
      const { data } = await parse(response);
      setAccessToken(data.token);
      return data;
    }

    // 409: อีกแท็บเพิ่งหมุน token ไป รอสักครู่แล้วลองใหม่ด้วย cookie ใหม่
    if (response.status === 409 && attempt < 2) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    setAccessToken(null);
    if (response.status === 401 || response.status === 409) return null;
    throw new Error(messageOf(await parse(response), response));
  }

  return null;
}

// เรียก API ที่ต้องเข้าสู่ระบบ: คืน JSON ที่สำเร็จ, throw Error(ข้อความภาษาไทย) เมื่อล้มเหลว
export async function apiRequest(url, options = {}) {
  let response = await send(url, options);

  if (response.status === 401 && accessToken) {
    const renewed = await refreshSession().catch(() => null);

    if (renewed) {
      response = await send(url, options);
    }

    if (!renewed || response.status === 401) {
      setAccessToken(null);
      sessionLostHandler?.("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
      throw new Error("กรุณาเข้าสู่ระบบใหม่");
    }
  }

  const result = await parse(response);

  if (!response.ok) throw new Error(messageOf(result, response));
  if (result.success === false) throw new Error(result.error || result.message || "คำขอไม่สำเร็จ");

  return result;
}

// เรียกเส้นทางสาธารณะของระบบสมาชิก (login/register/forgot/reset) คืน result.data
export async function authPost(path, body) {
  const response = await send(`${BOOK_API}${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await parse(response);

  if (!response.ok || result.success === false) {
    throw new Error(result.message || result.error || `API ตอบกลับด้วย HTTP ${response.status}`);
  }

  return result.data;
}

export async function login(username, password) {
  const data = await authPost("/api/auth/login", { username, password });
  setAccessToken(data.token);
  return data;
}

export async function logout() {
  try {
    await authPost("/api/auth/logout");
  } catch {
    // ออกจากระบบฝั่งหน้าเว็บต่อได้แม้เรียกเซิร์ฟเวอร์ไม่สำเร็จ
  } finally {
    setAccessToken(null);
  }
}
