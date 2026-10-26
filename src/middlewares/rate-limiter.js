// จำกัดจำนวนคำขอ (Lab 12) ด้วย express-rate-limit
// ตัวนับเก็บในหน่วยความจำของแต่ละ instance (ถ้ารันหลาย instance ต้องย้ายไป Redis ดู scalability-design.md)
const rateLimit = require("express-rate-limit");

const isTest = process.env.NODE_ENV === "test";

// ใน test ตั้งค่าให้สูงมากจนไม่รบกวนชุดทดสอบอื่น ส่วนการทดสอบ 429 กำหนดค่าเองผ่านตัวแปรสภาพแวดล้อม
function limitFrom(envName, normal) {
  const fromEnv = Number(process.env[envName]);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return isTest ? 100000 : normal;
}

function tooMany(message) {
  return {
    success: false,
    message,
    error: message,
    code: "TOO_MANY_REQUESTS",
  };
}

const shared = {
  standardHeaders: "draft-7", // ส่ง header RateLimit / RateLimit-Policy
  legacyHeaders: false, // ไม่ส่ง X-RateLimit-*
};

// ทั้งระบบ: 100 คำขอต่อนาทีต่อ IP
const generalLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: limitFrom("RATE_LIMIT_MAX", 100),
  message: tooMany("ส่งคำขอถี่เกินไป กรุณาลองใหม่ในอีกสักครู่"),
});

// เข้าสู่ระบบ: ผิดได้ 5 ครั้งต่อ 15 นาทีต่อ IP (นับเฉพาะครั้งที่ไม่สำเร็จ กันการเดารหัสผ่าน)
const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: limitFrom("AUTH_RATE_LIMIT_MAX", 5),
  skipSuccessfulRequests: true,
  message: tooMany("พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณาลองใหม่ใน 15 นาที"),
});

// สมัครสมาชิก: 10 ครั้งต่อ 15 นาทีต่อ IP
const registerLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: limitFrom("REGISTER_RATE_LIMIT_MAX", 10),
  message: tooMany("สมัครสมาชิกถี่เกินไป กรุณาลองใหม่ใน 15 นาที"),
});

module.exports = { generalLimiter, loginLimiter, registerLimiter };
