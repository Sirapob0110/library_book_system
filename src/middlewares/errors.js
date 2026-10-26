// ตัวจัดการ 404 และข้อผิดพลาดกลาง (Lab 4) วางไว้ท้ายสุดหลังทุก route
// ตอบรูปแบบเดียวกันทุกกรณี: { success:false, message, error, code }
function send(res, status, code, message) {
  return res.status(status).json({ success: false, message, error: message, code });
}

function notFound(req, res) {
  return send(res, 404, "ROUTE_NOT_FOUND", "ไม่พบเส้นทางที่เรียก");
}

// Express ต้องการ 4 พารามิเตอร์เพื่อรู้ว่าเป็นตัวจัดการข้อผิดพลาด
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.type === "entity.too.large") {
    return send(res, 413, "PAYLOAD_TOO_LARGE", "ข้อมูลที่ส่งมาใหญ่เกินกำหนด (สูงสุด 10KB)");
  }

  if (err.type === "entity.parse.failed") {
    return send(res, 400, "INVALID_JSON", "รูปแบบ JSON ไม่ถูกต้อง");
  }

  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(err);
    return send(res, 500, "INTERNAL_SERVER_ERROR", "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์");
  }

  return send(res, status, err.code || "REQUEST_ERROR", err.message);
}

module.exports = { notFound, errorHandler };
