// src/auth.js - JWT authentication และการตรวจสิทธิ์ตามบทบาท (admin / user)
// ใช้ร่วมกันทั้ง Book API และ Circulation Service (ตรวจ token แบบ stateless ด้วย JWT_SECRET เดียวกัน)
require("dotenv").config();
const jwt = require("jsonwebtoken");

const DEV_SECRET = "dev-only-secret-change-me";

function getSecret() {
  return process.env.JWT_SECRET || DEV_SECRET;
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "test") {
  console.warn(
    "[auth] ไม่ได้ตั้ง JWT_SECRET ใน .env กำลังใช้ค่าสำหรับพัฒนาเท่านั้น ห้ามใช้ในระบบจริง",
  );
}

const ROLES = { ADMIN: "admin", USER: "user" };

// สร้าง access token (อายุสั้น 15 นาที) จากข้อมูลผู้ใช้ (ไม่ใส่รหัสผ่านหรือ hash ลงใน token)
// ต่ออายุเซสชันด้วย refresh token ที่เก็บใน cookie httpOnly (ดู src/auth-routes.js)
function signToken(user) {
  return jwt.sign(
    {
      sub: user.user_id,
      username: user.username,
      role: user.role,
      member_id: user.member_id ?? null,
    },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "15m" },
  );
}

// ตอบ error ให้ตรงกับรูปแบบของทั้งสองบริการ (Book API ใช้ message, Circulation ใช้ error)
function deny(res, status, message) {
  return res.status(status).json({ success: false, message, error: message });
}

// ต้องแนบ header: Authorization: Bearer <token>
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return deny(res, 401, "กรุณาเข้าสู่ระบบ (ต้องแนบ Authorization: Bearer <token>)");
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.user = {
      user_id: payload.sub,
      username: payload.username,
      role: payload.role,
      member_id: payload.member_id ?? null,
    };
    return next();
  } catch (err) {
    const message =
      err.name === "TokenExpiredError"
        ? "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
        : "token ไม่ถูกต้อง";
    return deny(res, 401, message);
  }
}

// จำกัดให้เฉพาะบทบาทที่กำหนด (ใช้หลัง authenticate)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return deny(res, 403, "ไม่มีสิทธิ์ทำรายการนี้");
    }
    return next();
  };
}

// จำนวนวินาทีที่ access token ใช้ได้ (อ่านจาก token ที่เพิ่งออก)
function secondsToExpiry(token) {
  const { iat, exp } = jwt.decode(token);
  return exp - iat;
}

module.exports = { ROLES, signToken, secondsToExpiry, authenticate, requireRole, deny };
