// request id + log แบบ JSON บรรทัดเดียวต่อคำขอ (ใช้ morgan ตาม Lab 4 แต่กำหนดรูปแบบเป็น JSON)
// Gateway สร้าง X-Request-Id แล้วส่งต่อให้บริการปลายทาง ทำให้ไล่คำขอเดียวกันข้ามบริการได้ด้วย id เดียว
const crypto = require("crypto");
const morgan = require("morgan");

const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

// ใช้ id ที่ส่งมา (ถ้ารูปแบบปลอดภัย) หรือสร้างใหม่ แล้วตอบกลับใน header X-Request-Id
function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  req.id = typeof incoming === "string" && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

// ไม่บันทึก query string (อาจมีข้อมูลที่ไม่ควรอยู่ใน log) และไม่บันทึก header/body
function requestLogger(service) {
  const format = (tokens, req, res) =>
    JSON.stringify({
      time: new Date().toISOString(),
      level: res.statusCode >= 500 ? "error" : "info",
      service,
      requestId: req.id,
      method: req.method,
      path: (req.originalUrl || req.url).split("?")[0],
      status: res.statusCode,
      durationMs: Number(tokens["response-time"](req, res)),
      userId: req.user ? req.user.user_id : undefined,
    });

  return morgan(format, { skip: () => process.env.NODE_ENV === "test" });
}

module.exports = { requestId, requestLogger };
