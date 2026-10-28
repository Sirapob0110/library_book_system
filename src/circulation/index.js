const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { requestId, requestLogger } = require("../middlewares/request-log");
const path = require("path");
const YAML = require("yaml");
const swaggerUi = require("swagger-ui-express");
const service = require("../services/circulation");
const { authenticate, requireRole, deny } = require("../auth");
const cache = require("../cache");
const { generalLimiter } = require("../middlewares/rate-limiter");
const { notFound, errorHandler } = require("../middlewares/errors");
const { validateBody } = require("../schemas/validate");
const { memberSchema, loanSchema } = require("../schemas/circulation");

const app = express();
const PORT = Number(process.env.CIRCULATION_PORT) || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const adminOnly = [authenticate, requireRole("admin")];

// ========================
// Middleware
// ========================
// อยู่หลัง proxy/gateway 1 ชั้น ให้ rate limit นับ IP ของผู้ใช้จริงจาก X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  }),
);
app.use(requestId);
app.use(requestLogger("circulation-service"));
app.use(express.json({ limit: "10kb" })); // ข้อมูลเกิน 10KB ตอบ 413

// ========================
// Swagger UI
// ========================
const swaggerPath = path.join(__dirname, "openapi.yaml");
const swaggerDocument = YAML.parse(
  require("fs").readFileSync(swaggerPath, "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ========================
// Health check
// ========================
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "circulation-service",
    status: "ok",
  });
});

// ทุก route ด้านล่างนับโควตา 100 คำขอต่อนาทีต่อ IP (Swagger UI ไม่นับ)
app.use(generalLimiter);

// ========================
// Helper functions
// ========================
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// แปลงข้อผิดพลาดที่ชั้น service ตั้งใจโยน (ServiceError) เป็นคำตอบ HTTP
function sendServiceError(res, error) {
  if (error.kind === "deny") return deny(res, error.status, error.message);
  return res
    .status(error.status)
    .json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
}

const invalidMemberId = (res) => res.status(400).json({ error: "รหัสสมาชิกไม่ถูกต้อง" });

// ========================
// GET /api/members
// ดึงรายชื่อสมาชิก
// ========================
app.get("/api/members", ...adminOnly, async (req, res) => {
  try {
    return res.status(200).json({ data: await service.listMembers() });
  } catch (error) {
    console.error("Get members error:", error);
    return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลสมาชิกได้" });
  }
});

// ========================
// POST /api/members
// เพิ่มสมาชิก
// ========================
app.post("/api/members", ...adminOnly, validateBody(memberSchema), async (req, res) => {
  const member = { ...req.body, phone: req.body.phone || null };

  try {
    const memberId = await service.createMember(member);
    return res.status(201).json({ message: "เพิ่มสมาชิกสำเร็จ", member_id: memberId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "อีเมลนี้มีผู้ใช้งานแล้ว" });
    }
    console.error("Create member error:", error);
    return res.status(500).json({ error: "ไม่สามารถเพิ่มสมาชิกได้" });
  }
});

// ========================
// PUT /api/members/:id
// แก้ไขข้อมูลสมาชิก
// ========================
app.put("/api/members/:id", ...adminOnly, validateBody(memberSchema), async (req, res) => {
  const memberId = Number(req.params.id);
  const member = { ...req.body, phone: req.body.phone || null };

  if (!isPositiveInteger(memberId)) return invalidMemberId(res);

  try {
    const updated = await service.updateMember(memberId, member);
    if (!updated) return res.status(404).json({ error: "ไม่พบสมาชิก" });
    return res.status(200).json({ message: "แก้ไขข้อมูลสมาชิกสำเร็จ", data: updated });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "อีเมลนี้มีผู้ใช้งานแล้ว" });
    }
    console.error("Update member error:", error);
    return res.status(500).json({ error: "ไม่สามารถแก้ไขข้อมูลสมาชิกได้" });
  }
});

// ========================
// DELETE /api/members/:id
// ลบสมาชิก
// ========================
app.delete("/api/members/:id", ...adminOnly, async (req, res) => {
  const memberId = Number(req.params.id);

  if (!isPositiveInteger(memberId)) return invalidMemberId(res);

  try {
    const result = await service.deleteMember(memberId);
    if (!result) return res.status(404).json({ error: "ไม่พบสมาชิก" });
    return res.status(200).json({
      message: result.archived
        ? "ลบสมาชิกสำเร็จ (เก็บประวัติการยืมไว้ และปิดบัญชีผู้ใช้แล้ว)"
        : "ลบสมาชิกสำเร็จ",
      member_id: memberId,
      archived: result.archived,
    });
  } catch (error) {
    if (error instanceof service.ServiceError) return sendServiceError(res, error);
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ error: "ไม่สามารถลบสมาชิกที่มีประวัติการยืมได้" });
    }
    console.error("Delete member error:", error);
    return res.status(500).json({ error: "ไม่สามารถลบสมาชิกได้" });
  }
});

// ========================
// GET /api/members/:id/loans
// ดูประวัติการยืมของสมาชิก
// ========================
app.get("/api/members/:id/loans", authenticate, async (req, res) => {
  const memberId = Number(req.params.id);

  if (!isPositiveInteger(memberId)) return invalidMemberId(res);

  // ผู้ใช้ทั่วไปดูได้เฉพาะประวัติของตัวเอง ส่วน admin ดูได้ทุกคน
  if (req.user.role !== "admin" && req.user.member_id !== memberId) {
    return deny(res, 403, "ดูได้เฉพาะประวัติการยืมของตัวเอง");
  }

  try {
    const result = await service.getMemberLoans(memberId);
    if (!result) return res.status(404).json({ error: "ไม่พบสมาชิก" });
    return res.status(200).json({ member: result.member, data: result.loans });
  } catch (error) {
    console.error("Get member loans error:", error);
    return res.status(500).json({ error: "ไม่สามารถดึงประวัติการยืมได้" });
  }
});

// ========================
// GET /api/loans/overdue
// ดูรายการยืมเกินกำหนดที่ยังไม่ได้คืน
// ========================
app.get("/api/loans/overdue", ...adminOnly, async (req, res) => {
  try {
    return res.status(200).json({ data: await service.listOverdueLoans() });
  } catch (error) {
    console.error("Get overdue loans error:", error);
    return res.status(500).json({ error: "ไม่สามารถดึงรายการยืมเกินกำหนดได้" });
  }
});

// ========================
// POST /api/loans
// ยืมหนังสือ
// ========================
app.post("/api/loans", authenticate, validateBody(loanSchema), async (req, res) => {
  const { book_id, loan_date, due_date } = req.body || {};
  let { member_id } = req.body || {};

  // ผู้ใช้ทั่วไปยืมได้เฉพาะในนามสมาชิกของตัวเอง (ไม่ระบุ member_id จะใช้ของตัวเอง)
  if (req.user.role !== "admin") {
    if (member_id === undefined || member_id === null || member_id === "") {
      member_id = req.user.member_id;
    } else if (Number(member_id) !== req.user.member_id) {
      return deny(res, 403, "ยืมได้เฉพาะในนามสมาชิกของตัวเอง");
    }
  }

  const bookId = Number(book_id);
  const memberId = Number(member_id);

  const today = new Date().toISOString().slice(0, 10);
  const loanDate = loan_date || today;

  if (!isPositiveInteger(bookId) || !isPositiveInteger(memberId) || !due_date) {
    return res.status(400).json({
      error: "กรุณาระบุ book_id, member_id และ due_date ให้ถูกต้อง",
    });
  }

  if (!isValidDate(loanDate) || !isValidDate(due_date) || due_date < loanDate) {
    return res.status(400).json({ error: "วันที่ยืมและวันกำหนดคืนไม่ถูกต้อง" });
  }

  try {
    const loanId = await service.createLoan({ bookId, memberId, loanDate, dueDate: due_date });

    return res.status(201).json({
      message: "ยืมหนังสือสำเร็จ",
      loan_id: loanId,
      book_id: bookId,
      member_id: memberId,
      loan_date: loanDate,
      due_date,
    });
  } catch (error) {
    if (error instanceof service.ServiceError) return sendServiceError(res, error);
    console.error("Create loan error:", error);
    return res.status(500).json({ error: "ไม่สามารถทำรายการยืมหนังสือได้" });
  }
});

// ========================
// PUT /api/loans/:id/return
// คืนหนังสือ
// ========================
app.put("/api/loans/:id/return", authenticate, async (req, res) => {
  const loanId = Number(req.params.id);

  if (!isPositiveInteger(loanId)) {
    return res.status(400).json({ error: "รหัสรายการยืมไม่ถูกต้อง" });
  }

  try {
    const fine = await service.returnLoan(loanId, req.user);
    return res.status(200).json({ message: "คืนหนังสือสำเร็จ", loan_id: loanId, ...fine });
  } catch (error) {
    if (error instanceof service.ServiceError) return sendServiceError(res, error);
    console.error("Return loan error:", error);
    return res.status(500).json({ error: "ไม่สามารถคืนหนังสือได้" });
  }
});

// ========================
// 404 และตัวจัดการข้อผิดพลาดกลาง (ต้องอยู่หลังทุก route)
// ========================
app.use(notFound);
app.use(errorHandler);

// ========================
// Start server
// ========================
if (require.main === module) {
  cache.connectCache().then(() => {
    app.listen(PORT, () => {
      console.log(`Circulation Service running on port ${PORT}`);
      console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
    });
  });
}

module.exports = app;
