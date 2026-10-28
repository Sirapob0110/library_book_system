// ตรวจค่าที่ไม่ปลอดภัยตอนเริ่ม Book API: ความลับ JWT ที่เป็นค่าตัวอย่าง และบัญชี admin ที่ยังใช้รหัสผ่านจาก seed.sql
//  - NODE_ENV=production: ถ้าพบ จะไม่ยอมเริ่มระบบ (ตั้ง ALLOW_INSECURE_DEFAULTS=true เพื่อข้ามโดยรับความเสี่ยงเอง)
//  - โหมดอื่น: แสดงคำเตือนอย่างเดียว
const bcrypt = require("bcryptjs");

const DEFAULT_ADMIN_PASSWORD = "Admin@1234"; // รหัสผ่านที่เขียนไว้ใน seed.sql และ README
const WEAK_SECRETS = new Set([
  "dev-only-secret-change-me",
  "dev-only-change-me",
  "change-me-to-a-long-random-string",
  "secret",
  "changeme",
]);

async function findSecurityProblems(pool, env = process.env) {
  const problems = [];
  const secret = env.JWT_SECRET;

  if (!secret || WEAK_SECRETS.has(secret) || secret.length < 16) {
    problems.push("JWT_SECRET ไม่ได้ตั้ง หรือเป็นค่าตัวอย่าง/สั้นเกินไป (ต้องเป็นข้อความสุ่มอย่างน้อย 16 ตัวอักษร)");
  }

  try {
    const [admins] = await pool.query("SELECT username, password_hash FROM users WHERE role = 'admin'");

    for (const admin of admins) {
      if (await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, admin.password_hash)) {
        problems.push(
          `บัญชี admin "${admin.username}" ยังใช้รหัสผ่านตัวอย่างจาก seed.sql (เปลี่ยนด้วย: npm run set-password -- ${admin.username})`,
        );
      }
    }
  } catch (err) {
    // ฐานข้อมูลยังไม่พร้อม/ยังไม่มีตาราง: ข้ามส่วนนี้ (ระบบจะแจ้งปัญหานี้ตอนใช้งานจริงอยู่แล้ว)
    console.warn(`[security] ตรวจบัญชี admin ไม่ได้: ${err.code || err.message}`);
  }

  return problems;
}

async function runSecurityCheck(pool, env = process.env) {
  const problems = await findSecurityProblems(pool, env);

  for (const p of problems) console.warn(`[security] คำเตือน: ${p}`);

  if (problems.length && env.NODE_ENV === "production" && env.ALLOW_INSECURE_DEFAULTS !== "true") {
    throw new Error(`ไม่เริ่มระบบใน production เพราะการตั้งค่าไม่ปลอดภัย:\n- ${problems.join("\n- ")}`);
  }

  return problems;
}

module.exports = { findSecurityProblems, runSecurityCheck, DEFAULT_ADMIN_PASSWORD };
