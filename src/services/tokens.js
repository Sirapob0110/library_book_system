// refresh token (หมุนเวียนทุกครั้งที่ใช้) และ token รีเซ็ตรหัสผ่าน
// เก็บเฉพาะ sha256 ของ token ในฐานข้อมูล (ถ้าฐานข้อมูลรั่ว ก็เอา token ไปใช้ไม่ได้)
const crypto = require("crypto");
const pool = require("../db");
const { ServiceError } = require("./errors");

const refreshDays = () => Number(process.env.REFRESH_TOKEN_DAYS) || 7;
const resetMinutes = () => Number(process.env.RESET_TOKEN_MINUTES) || 30;
// คำขอ refresh สองครั้งที่มาพร้อมกัน (เช่น สองแท็บ) ภายในช่วงนี้ไม่ถือว่าเป็นการขโมย token
const graceSeconds = () => Number(process.env.REFRESH_GRACE_SECONDS) || 10;

const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
const newRawToken = () => crypto.randomBytes(32).toString("base64url");

// ออก refresh token ใหม่ (ถ้าไม่ระบุ familyId จะเริ่มชุดใหม่ = login ครั้งใหม่)
async function issueRefreshToken(userId, familyId = crypto.randomUUID()) {
  const raw = newRawToken();

  await pool.query("DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < NOW()", [userId]);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [userId, hashToken(raw), familyId, refreshDays()],
  );

  return raw;
}

async function revokeFamily(familyId) {
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL",
    [familyId],
  );
}

// เพิกถอนทุก token ของผู้ใช้ (ใช้หลังเปลี่ยน/รีเซ็ตรหัสผ่าน)
async function revokeAllForUser(userId, executor = pool) {
  await executor.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
}

// ใช้ refresh token แล้วออกตัวใหม่แทน (rotation) คืน { userId, raw }
// ใช้ token ที่ถูกใช้ไปแล้วซ้ำ (ไม่ใช่ช่วงแข่งกัน) = สงสัยว่าถูกขโมย เพิกถอนทั้งชุด
async function rotateRefreshToken(rawToken) {
  const invalid = () => new ServiceError(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", { code: "INVALID_REFRESH_TOKEN" });

  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) throw invalid();

  const hash = hashToken(rawToken);
  const [rows] = await pool.query(
    `SELECT token_id, user_id, family_id,
            revoked_at IS NOT NULL AS revoked,
            revoked_at IS NOT NULL AND revoked_at > DATE_SUB(NOW(), INTERVAL ? SECOND) AS recently_revoked,
            expires_at <= NOW() AS expired
     FROM refresh_tokens WHERE token_hash = ?`,
    [graceSeconds(), hash],
  );
  const row = rows[0];

  if (!row) throw invalid();

  if (Number(row.revoked)) {
    if (Number(row.recently_revoked)) {
      throw new ServiceError(409, "กำลังต่ออายุเซสชันอยู่ กรุณาลองใหม่อีกครั้ง", { code: "REFRESH_CONFLICT" });
    }
    await revokeFamily(row.family_id);
    throw invalid();
  }

  if (Number(row.expired)) throw invalid();

  // เพิกถอนแบบ atomic: ถ้ามีคำขออื่นชิงใช้ไปก่อน affectedRows จะเป็น 0
  const [claimed] = await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_id = ? AND revoked_at IS NULL",
    [row.token_id],
  );

  if (claimed.affectedRows === 0) {
    throw new ServiceError(409, "กำลังต่ออายุเซสชันอยู่ กรุณาลองใหม่อีกครั้ง", { code: "REFRESH_CONFLICT" });
  }

  return { userId: row.user_id, raw: await issueRefreshToken(row.user_id, row.family_id) };
}

// ออกจากระบบ: เพิกถอนทั้งชุดของ token นี้ (ไม่ error ถ้าไม่พบ)
async function revokeByRawToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return;

  const [rows] = await pool.query("SELECT family_id FROM refresh_tokens WHERE token_hash = ?", [hashToken(rawToken)]);

  if (rows[0]) await revokeFamily(rows[0].family_id);
}

// สร้าง token รีเซ็ตรหัสผ่าน (ใช้ได้ครั้งเดียว) และยกเลิกอันเก่าที่ยังไม่ใช้ของผู้ใช้คนเดียวกัน
async function createResetToken(userId) {
  const raw = newRawToken();

  await pool.query("UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL", [userId]);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, hashToken(raw), resetMinutes()],
  );

  return { raw, expiresMinutes: resetMinutes() };
}

module.exports = {
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeByRawToken,
  revokeAllForUser,
  createResetToken,
  refreshDays,
};
