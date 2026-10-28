// เส้นทางยืนยันตัวตนของ Book API: สมัคร, เข้าสู่ระบบ, ต่ออายุเซสชัน (refresh), ออกจากระบบ, ลืม/ตั้งรหัสผ่านใหม่
//
// โมเดลเซสชัน
//  - access token (JWT อายุ 15 นาที) ส่งใน JSON และเก็บในหน่วยความจำของหน้าเว็บ (ไม่เก็บใน storage เพื่อลดความเสี่ยงจาก XSS)
//  - refresh token เป็นสตริงสุ่ม เก็บใน cookie httpOnly (JavaScript อ่านไม่ได้) path /api/auth, SameSite=Lax
//    ใช้แลก access token ใหม่ และ "หมุนเวียน" ทุกครั้ง (ใช้แล้วเพิกถอนทันที) ใช้ซ้ำ = เพิกถอนทั้งชุด
//  - ออกจากระบบ/เปลี่ยนรหัสผ่าน/ลบบัญชี = เพิกถอน refresh token ผู้ใช้จึงต่ออายุไม่ได้อีก
//    (access token ที่ออกไปแล้วยังใช้ได้จนครบ 15 นาที เพราะตรวจแบบ stateless)
const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { signToken, secondsToExpiry, authenticate } = require("./auth");
const tokens = require("./services/tokens");
const { sendPasswordReset } = require("./services/mailer");
const { ServiceError } = require("./services/errors");
const { loginLimiter, registerLimiter, resetLimiter } = require("./middlewares/rate-limiter");
const { requireTrustedOrigin } = require("./middlewares/same-origin");
const { validateBody } = require("./schemas/validate");
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("./schemas/user");

const router = express.Router();

const COOKIE_NAME = "refresh_token";
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, status, message, code) =>
  res.status(status).json({ success: false, message, error: message, ...(code ? { code } : {}) });

// hash สำหรับเทียบเมื่อไม่พบผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกรณีรหัสผ่านผิด
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    path: "/api/auth",
  };
}

function setRefreshCookie(res, raw) {
  res.cookie(COOKIE_NAME, raw, { ...cookieOptions(), maxAge: tokens.refreshDays() * 864e5 });
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

const publicUser = (u) => ({
  user_id: u.user_id,
  username: u.username,
  role: u.role,
  member_id: u.member_id,
  name: u.name || u.username,
});

function sessionPayload(user) {
  const token = signToken(user);
  return { token, expires_in: secondsToExpiry(token), user: publicUser(user) };
}

function handleError(res, err) {
  if (err instanceof ServiceError) return fail(res, err.status, err.message, err.code);

  console.error(err);
  return fail(res, 500, "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์");
}

const loadUserById = async (userId) => {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.username, u.role, u.member_id, m.name
     FROM users u LEFT JOIN members m ON m.member_id = u.member_id
     WHERE u.user_id = ?`,
    [userId],
  );
  return rows[0];
};

// สมัครสมาชิก: สร้างสมาชิกห้องสมุดและบัญชีผู้ใช้ (บทบาท user เสมอ) ในธุรกรรมเดียวกัน
router.post("/register", registerLimiter, validateBody(registerSchema), async (req, res) => {
  const { username, password, name, email, phone } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [member] = await conn.query(
      "INSERT INTO members (name, email, phone) VALUES (?, ?, ?)",
      [name.trim(), email.trim(), phone ? phone.trim() : null],
    );
    const [user] = await conn.query(
      "INSERT INTO users (username, password_hash, role, member_id) VALUES (?, ?, 'user', ?)",
      [username, passwordHash, member.insertId],
    );

    await conn.commit();
    ok(res, { user_id: user.insertId, username, role: "user", member_id: member.insertId }, 201);
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return fail(res, 409, "username หรืออีเมลนี้ถูกใช้งานแล้ว");
    }
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// เข้าสู่ระบบ: ตรวจรหัสผ่าน ออก access token (JSON) และ refresh token (cookie httpOnly)
router.post("/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.role, u.member_id, m.name
       FROM users u LEFT JOIN members m ON m.member_id = u.member_id
       WHERE u.username = ?`,
      [username],
    );
    const user = rows[0];
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !match) {
      return fail(res, 401, "username หรือ password ไม่ถูกต้อง");
    }

    setRefreshCookie(res, await tokens.issueRefreshToken(user.user_id));
    ok(res, sessionPayload(user));
  } catch (err) {
    handleError(res, err);
  }
});

// ต่ออายุเซสชัน: แลก refresh token (จาก cookie) เป็น access token ใหม่ และหมุน refresh token
router.post("/refresh", requireTrustedOrigin, async (req, res) => {
  try {
    const { userId, raw } = await tokens.rotateRefreshToken(readCookie(req, COOKIE_NAME));
    const user = await loadUserById(userId);

    if (!user) {
      res.clearCookie(COOKIE_NAME, cookieOptions());
      return fail(res, 401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "INVALID_REFRESH_TOKEN");
    }

    setRefreshCookie(res, raw);
    ok(res, sessionPayload(user));
  } catch (err) {
    // token ใช้ไม่ได้: ล้าง cookie ให้เบราว์เซอร์ (ยกเว้นกรณีแข่งกันที่ cookie ใหม่อาจถูกตั้งแล้วโดยอีกคำขอ)
    if (err instanceof ServiceError && err.status === 401) res.clearCookie(COOKIE_NAME, cookieOptions());
    handleError(res, err);
  }
});

// ออกจากระบบ: เพิกถอน refresh token ทั้งชุดของเครื่องนี้ แล้วล้าง cookie (เรียกซ้ำได้ ไม่ error)
router.post("/logout", requireTrustedOrigin, async (req, res) => {
  try {
    await tokens.revokeByRawToken(readCookie(req, COOKIE_NAME));
    res.clearCookie(COOKIE_NAME, cookieOptions());
    ok(res, { message: "ออกจากระบบแล้ว" });
  } catch (err) {
    handleError(res, err);
  }
});

// ลืมรหัสผ่าน: ตอบข้อความเดิมเสมอ ไม่บอกว่ามีบัญชีนี้หรือไม่ (กันการไล่เดา username/อีเมล)
router.post("/forgot-password", resetLimiter, validateBody(forgotPasswordSchema), async (req, res) => {
  const generic = {
    message: "ถ้ามีบัญชีนี้ในระบบ จะได้รับวิธีรีเซ็ตรหัสผ่านตามช่องทางที่ตั้งไว้ (ลิงก์ใช้ได้ครั้งเดียว และหมดอายุเร็ว)",
  };

  try {
    const { identifier } = req.body;
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username
       FROM users u LEFT JOIN members m ON m.member_id = u.member_id
       WHERE u.username = ? OR m.email = ?
       LIMIT 1`,
      [identifier, identifier],
    );

    if (rows[0]) {
      const { raw, expiresMinutes } = await tokens.createResetToken(rows[0].user_id);
      sendPasswordReset({ username: rows[0].username, token: raw, expiresMinutes });
    }

    ok(res, generic, 202);
  } catch (err) {
    handleError(res, err);
  }
});

// ตั้งรหัสผ่านใหม่ด้วย token จากลิงก์: ใช้ได้ครั้งเดียว หมดอายุ และเพิกถอนทุกเซสชันของผู้ใช้
router.post("/reset-password", resetLimiter, validateBody(resetPasswordSchema), async (req, res) => {
  const { token, password } = req.body;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT reset_id, user_id FROM password_resets
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`,
      [tokens.hashToken(token)],
    );

    if (rows.length === 0) {
      await conn.rollback();
      return fail(res, 400, "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว", "INVALID_RESET_TOKEN");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await conn.query("UPDATE users SET password_hash = ? WHERE user_id = ?", [passwordHash, rows[0].user_id]);
    await conn.query("UPDATE password_resets SET used_at = NOW() WHERE reset_id = ?", [rows[0].reset_id]);
    await tokens.revokeAllForUser(rows[0].user_id, conn);
    await conn.commit();

    res.clearCookie(COOKIE_NAME, cookieOptions());
    ok(res, { message: "ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
  } catch (err) {
    if (conn) await conn.rollback();
    handleError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (อ่านจาก token)
router.get("/me", authenticate, (req, res) => {
  ok(res, req.user);
});

module.exports = router;
