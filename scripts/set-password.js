// ตั้ง/เปลี่ยนรหัสผ่านของผู้ใช้ (ใช้ตั้งรหัสผ่าน admin ตอนติดตั้ง แทนรหัสตัวอย่างจาก seed.sql)
//   npm run set-password -- admin                 (ถามรหัสผ่านแบบไม่แสดงตัวอักษร)
//   npm run set-password -- admin --create-admin  (สร้างบัญชี admin ถ้ายังไม่มี)
//   NEW_PASSWORD=... npm run set-password -- admin (ไม่ถาม ใช้ในสคริปต์อัตโนมัติ)
// อ่านการเชื่อมต่อฐานข้อมูลจาก .env เหมือนบริการอื่น และเพิกถอนเซสชันเดิมทั้งหมดของผู้ใช้
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../src/db");
const { passwordRule } = require("../src/schemas/user");

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      // ไม่ใช่ terminal (เช่น pipe) อ่านทั้งบรรทัดตามปกติ
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (data += c));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0]));
      return;
    }

    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      if (ch === "\u0003") process.exit(130); // Ctrl+C
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((a) => !a.startsWith("--"));
  const createAdmin = args.includes("--create-admin");

  if (!username) {
    console.error("วิธีใช้: npm run set-password -- <username> [--create-admin]");
    process.exit(2);
  }

  let password = process.env.NEW_PASSWORD;

  if (!password) {
    password = await askHidden(`รหัสผ่านใหม่ของ ${username} (8-72 ตัวอักษร): `);
    const again = await askHidden("พิมพ์รหัสผ่านอีกครั้ง: ");
    if (password !== again) {
      console.error("รหัสผ่านสองครั้งไม่ตรงกัน");
      process.exit(1);
    }
  }

  const parsed = passwordRule.safeParse(password);
  if (!parsed.success) {
    console.error(parsed.error.issues[0].message);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const [rows] = await pool.query("SELECT user_id, role FROM users WHERE username = ?", [username]);

  if (rows.length === 0) {
    if (!createAdmin) {
      console.error(`ไม่พบผู้ใช้ "${username}" (ถ้าต้องการสร้างบัญชี admin ใหม่ เพิ่ม --create-admin)`);
      process.exit(1);
    }
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')", [username, hash]);
    console.log(`สร้างบัญชี admin "${username}" แล้ว`);
  } else {
    await pool.query("UPDATE users SET password_hash = ? WHERE user_id = ?", [hash, rows[0].user_id]);
    // เพิกถอนเซสชันเดิม (ตารางอาจยังไม่มีถ้ายังไม่ได้รัน migrations/002-auth-tokens.sql)
    try {
      await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [rows[0].user_id]);
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE") throw err;
    }
    console.log(`เปลี่ยนรหัสผ่านของ "${username}" แล้ว (เซสชันเดิมถูกเพิกถอน)`);
  }
}

main()
  .catch((err) => {
    console.error("ผิดพลาด:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
