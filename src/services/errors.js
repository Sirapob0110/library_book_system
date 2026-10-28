// ข้อผิดพลาดที่ชั้น service ตั้งใจโยนให้ตอบผู้ใช้ตามสถานะที่ระบุ (ใช้ร่วมกันทุก service)
// kind "deny" = รูปแบบเดียวกับ 401/403 ของ auth, code = รหัสสำหรับให้ client แยกแยะกรณี
class ServiceError extends Error {
  constructor(status, message, { kind = "error", code } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

module.exports = { ServiceError };
