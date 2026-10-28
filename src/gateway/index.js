// API Gateway (Lab 13): จุดเข้าเดียวของระบบ พอร์ต 8000
// หน้าที่: ตรวจ JWT, จำกัดจำนวนคำขอ, บันทึก log กลาง, ส่งต่อคำขอไปยังบริการที่รับผิดชอบ
// และตอบ 503 อย่างเหมาะสมเมื่อบริการปลายทางไม่ตอบ (Gateway ไม่ล่มตามไปด้วย)
// ไม่มี business logic และไม่เข้าถึงฐานข้อมูล
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const axios = require("axios");

const { authenticate } = require("../auth");
const { generalLimiter } = require("../middlewares/rate-limiter");
const { notFound, errorHandler } = require("../middlewares/errors");
const { requestId, requestLogger } = require("../middlewares/request-log");
const { requireTrustedOrigin } = require("../middlewares/same-origin");

const PORT = Number(process.env.GATEWAY_PORT) || 8000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const BOOK_SERVICE_URL = (process.env.BOOK_SERVICE_URL || "http://localhost:3000").replace(/\/+$/, "");
const CIRCULATION_SERVICE_URL = (
  process.env.CIRCULATION_SERVICE_URL || "http://localhost:3001"
).replace(/\/+$/, "");
const UPSTREAM_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS) || 3000;

// เส้นทางที่บริการแต่ละตัวรับผิดชอบ (แบ่งตาม Bounded Context ดู microservices-design.md)
const ROUTES = [
  { prefix: "/api/auth", target: BOOK_SERVICE_URL, public: true },
  { prefix: "/api/books", target: BOOK_SERVICE_URL },
  { prefix: "/api/authors", target: BOOK_SERVICE_URL },
  { prefix: "/api/categories", target: BOOK_SERVICE_URL },
  { prefix: "/api/members", target: CIRCULATION_SERVICE_URL },
  { prefix: "/api/loans", target: CIRCULATION_SERVICE_URL },
];

// เฉพาะการสมัครและเข้าสู่ระบบที่เรียกได้โดยไม่มี token (/auth/me ต้องมี token)
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh", // ใช้ cookie refresh token แทน Authorization
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

// header จากบริการปลายทางที่ส่งต่อให้ผู้เรียกด้วย
const PASS_HEADERS = [
  "content-type",
  "x-cache",
  "ratelimit",
  "ratelimit-policy",
  "retry-after",
  "x-request-id",
  "set-cookie", // cookie refresh token จาก Book API ส่งต่อถึงเบราว์เซอร์
];

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  }),
);

// log กลาง (JSON): requestId, method, path, status, เวลาที่ใช้ — id นี้ถูกส่งต่อให้บริการปลายทางด้วย
app.use(requestId);
app.use(requestLogger("api-gateway"));

app.use(express.json({ limit: "10kb" }));

app.get("/health", async (req, res) => {
  const check = async (url) => {
    try {
      const r = await axios.get(`${url}/health`, { timeout: UPSTREAM_TIMEOUT_MS });
      return r.data?.status === "ok" ? "ok" : "error";
    } catch {
      return "down";
    }
  };

  const [book, circulation] = await Promise.all([
    check(BOOK_SERVICE_URL),
    check(CIRCULATION_SERVICE_URL),
  ]);

  res.status(book === "ok" && circulation === "ok" ? 200 : 503).json({
    service: "api-gateway",
    status: "ok",
    upstream: { "book-api": book, "circulation-service": circulation },
  });
});

app.use(generalLimiter);

function serviceUnavailable(res, message) {
  return res.status(503).json({
    success: false,
    message,
    error: message,
    code: "SERVICE_UNAVAILABLE",
  });
}

function proxyTo(route) {
  return async (req, res) => {
    const headers = { "X-Forwarded-For": req.ip, "X-Request-Id": req.id };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
    // cookie ส่งต่อเฉพาะเส้นทาง /api/auth (ที่เดียวที่ใช้ refresh token) ไม่ส่งให้บริการอื่น
    if (route.public && req.headers.cookie) headers.Cookie = req.headers.cookie;

    const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);

    try {
      const upstream = await axios.request({
        method: req.method,
        url: `${route.target}${req.originalUrl}`,
        headers,
        data: hasBody ? req.body : undefined,
        timeout: UPSTREAM_TIMEOUT_MS,
        validateStatus: () => true, // ส่งต่อทุกสถานะ (4xx/5xx) ให้ผู้เรียกตามเดิม
      });

      for (const name of PASS_HEADERS) {
        if (upstream.headers[name]) res.set(name, upstream.headers[name]);
      }

      return res.status(upstream.status).send(upstream.data);
    } catch (err) {
      console.error(
        JSON.stringify({ level: "error", service: "api-gateway", requestId: req.id, message: `เรียก ${route.target} ไม่สำเร็จ`, code: err.code || err.message }),
      );

      const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
      return serviceUnavailable(
        res,
        timedOut
          ? "บริการปลายทางตอบช้าเกินกำหนด กรุณาลองใหม่อีกครั้ง"
          : "ไม่สามารถติดต่อบริการปลายทางได้ในขณะนี้ กรุณาลองใหม่ภายหลัง",
      );
    }
  };
}

// เส้นทางที่ใช้ cookie ต้องมาจากหน้าเว็บของเราเท่านั้น (ตรวจที่ Gateway ก่อนส่งต่อ)
app.post(["/api/auth/refresh", "/api/auth/logout"], requireTrustedOrigin);

for (const route of ROUTES) {
  const guard = (req, res, next) =>
    PUBLIC_PATHS.has(req.baseUrl + req.path) ? next() : authenticate(req, res, next);

  app.use(route.prefix, guard, proxyTo(route));
}

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API Gateway: http://localhost:${PORT}`);
    console.log(`  book-api          -> ${BOOK_SERVICE_URL}`);
    console.log(`  circulation       -> ${CIRCULATION_SERVICE_URL}`);
  });
}

module.exports = app;
