// ฟังก์ชันช่วยจัดรูปแบบที่ใช้ร่วมกันหลายหน้า

// วันนี้ตามเวลาเครื่องผู้ใช้ รูปแบบ YYYY-MM-DD (ไม่ใช้ toISOString เพราะเป็นเวลา UTC
// ทำให้ช่วงเที่ยงคืนถึง 07:00 ของไทยได้วันที่เมื่อวาน)
export function getToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const dateOnly = (value) => String(value).slice(0, 10);

// ข้อความค่าปรับของรายการยืม: ค่าว่างเมื่อไม่เกินกำหนด
export function fineText(loan) {
  const days = Number(loan?.days_overdue) || 0;
  const fine = Number(loan?.fine_amount) || 0;
  if (days <= 0) return "";
  return `เกิน ${days} วัน · ค่าปรับ ${fine.toLocaleString("th-TH")} บาท`;
}

// อ่าน token รีเซ็ตรหัสผ่านจากลิงก์ ?reset_token=...
export function readResetToken(search = window.location.search) {
  return new URLSearchParams(search).get("reset_token") || "";
}
