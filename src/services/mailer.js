// การส่งวิธีรีเซ็ตรหัสผ่านให้ผู้ใช้
// โปรเจกต์นี้ยังไม่ได้เชื่อมระบบอีเมล: ตอนพัฒนา (ไม่ใช่ production หรือ RESET_DELIVERY=console)
// จะพิมพ์ลิงก์รีเซ็ตลง console ของเซิร์ฟเวอร์ เพื่อให้ทดสอบ flow ได้ครบ
// ถ้าจะใช้งานจริง ให้แทนฟังก์ชัน sendPasswordReset ด้วยการส่งอีเมลจริง (เช่น nodemailer / บริการอีเมล)
// ห้ามส่ง token กลับไปใน response ของ API เด็ดขาด
function sendPasswordReset({ username, token, expiresMinutes }) {
  const origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const link = `${origin}/?reset_token=${token}`;

  if (process.env.RESET_DELIVERY === "console" || process.env.NODE_ENV !== "production") {
    if (process.env.NODE_ENV !== "test") {
      console.log(
        JSON.stringify({ level: "info", event: "password_reset_link", username, expiresMinutes, link }),
      );
    }
    return "console";
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "password_reset_not_delivered",
      message: "ยังไม่ได้ตั้งค่าการส่งอีเมล จึงไม่มีช่องทางส่งลิงก์รีเซ็ตรหัสผ่านให้ผู้ใช้ (ตั้ง RESET_DELIVERY=console เพื่อพิมพ์ลง log)",
    }),
  );
  return "none";
}

module.exports = { sendPasswordReset };
