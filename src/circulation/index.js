const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const YAML = require("yaml");
const swaggerUi = require("swagger-ui-express");
const db = require("../db");
const { authenticate, requireRole, deny } = require("../auth");

const app = express();
const PORT = Number(process.env.CIRCULATION_PORT) || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const adminOnly = [authenticate, requireRole("admin")];

// ========================
// Middleware
// ========================
app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());
app.use(morgan("dev"));

// ========================
// Swagger UI
// ========================
const swaggerPath = path.join(__dirname, "openapi.yaml");
const swaggerDocument = YAML.parse(
  require("fs").readFileSync(swaggerPath, "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// ========================
// Helper functions
// ========================
function isValidEmail(email) {
  return (
    typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

function getMemberInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const { name, email, phone } = body;

  if (typeof name !== "string" || !name.trim() || !isValidEmail(email)) {
    return null;
  }

  return {
    name: name.trim(),
    email: email.trim(),
    phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
  };
}

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

function handleDatabaseError(res, error, message) {
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error: "อีเมลนี้มีผู้ใช้งานแล้ว",
    });
  }

  console.error(message, error);

  return res.status(500).json({
    error: "เกิดข้อผิดพลาดในการติดต่อฐานข้อมูล",
  });
}

// ========================
// Health check
// ========================
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "circulation-service",
    status: "ok",
  });
});

// ========================
// GET /api/members
// ดึงรายชื่อสมาชิก
// ========================
app.get("/api/members", ...adminOnly, async (req, res) => {
  try {
    const [members] = await db.query(
      `SELECT member_id, name, email, phone
       FROM members
       ORDER BY member_id DESC`,
    );

    return res.status(200).json({
      data: members,
    });
  } catch (error) {
    console.error("Get members error:", error);

    return res.status(500).json({
      error: "ไม่สามารถดึงข้อมูลสมาชิกได้",
    });
  }
});

// ========================
// POST /api/members
// เพิ่มสมาชิก
// ========================
app.post("/api/members", ...adminOnly, async (req, res) => {
  const member = getMemberInput(req.body);

  if (!member) {
    return res.status(400).json({
      error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO members (name, email, phone)
       VALUES (?, ?, ?)`,
      [member.name, member.email, member.phone],
    );

    return res.status(201).json({
      message: "เพิ่มสมาชิกสำเร็จ",
      member_id: result.insertId,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "อีเมลนี้มีผู้ใช้งานแล้ว",
      });
    }

    console.error("Create member error:", error);

    return res.status(500).json({
      error: "ไม่สามารถเพิ่มสมาชิกได้",
    });
  }
});

// ========================
// PUT /api/members/:id
// แก้ไขข้อมูลสมาชิก
// ========================
app.put("/api/members/:id", ...adminOnly, async (req, res) => {
  const memberId = Number(req.params.id);
  const member = getMemberInput(req.body);

  if (!isPositiveInteger(memberId)) {
    return res.status(400).json({
      error: "รหัสสมาชิกไม่ถูกต้อง",
    });
  }

  if (!member) {
    return res.status(400).json({
      error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง",
    });
  }

  try {
    const [existing] = await db.query(
      `SELECT member_id
       FROM members
       WHERE member_id = ?`,
      [memberId],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        error: "ไม่พบสมาชิก",
      });
    }

    await db.query(
      `UPDATE members
       SET name = ?, email = ?, phone = ?
       WHERE member_id = ?`,
      [member.name, member.email, member.phone, memberId],
    );

    const [rows] = await db.query(
      `SELECT member_id, name, email, phone
       FROM members
       WHERE member_id = ?`,
      [memberId],
    );

    return res.status(200).json({
      message: "แก้ไขข้อมูลสมาชิกสำเร็จ",
      data: rows[0],
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "อีเมลนี้มีผู้ใช้งานแล้ว",
      });
    }

    console.error("Update member error:", error);

    return res.status(500).json({
      error: "ไม่สามารถแก้ไขข้อมูลสมาชิกได้",
    });
  }
});

// ========================
// DELETE /api/members/:id
// ลบสมาชิก
// ========================
app.delete("/api/members/:id", ...adminOnly, async (req, res) => {
  const memberId = Number(req.params.id);

  if (!isPositiveInteger(memberId)) {
    return res.status(400).json({
      error: "รหัสสมาชิกไม่ถูกต้อง",
    });
  }

  try {
    const [result] = await db.query("DELETE FROM members WHERE member_id = ?", [
      memberId,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: "ไม่พบสมาชิก",
      });
    }

    return res.status(200).json({
      message: "ลบสมาชิกสำเร็จ",
      member_id: memberId,
    });
  } catch (error) {
    if (
      error.code === "ER_ROW_IS_REFERENCED_2" ||
      error.code === "ER_ROW_IS_REFERENCED"
    ) {
      return res.status(409).json({
        error: "ไม่สามารถลบสมาชิกที่มีประวัติการยืมได้",
      });
    }

    console.error("Delete member error:", error);

    return res.status(500).json({
      error: "ไม่สามารถลบสมาชิกได้",
    });
  }
});

// ========================
// GET /api/members/:id/loans
// ดูประวัติการยืมของสมาชิก
// ========================
app.get("/api/members/:id/loans", authenticate, async (req, res) => {
  const memberId = Number(req.params.id);

  if (!isPositiveInteger(memberId)) {
    return res.status(400).json({
      error: "รหัสสมาชิกไม่ถูกต้อง",
    });
  }

  // ผู้ใช้ทั่วไปดูได้เฉพาะประวัติของตัวเอง ส่วน admin ดูได้ทุกคน
  if (req.user.role !== "admin" && req.user.member_id !== memberId) {
    return deny(res, 403, "ดูได้เฉพาะประวัติการยืมของตัวเอง");
  }

  try {
    const [members] = await db.query(
      `SELECT member_id, name
       FROM members
       WHERE member_id = ?`,
      [memberId],
    );

    if (members.length === 0) {
      return res.status(404).json({
        error: "ไม่พบสมาชิก",
      });
    }

    const [loans] = await db.query(
      `SELECT
         l.loan_id,
         l.book_id,
         b.title,
         l.loan_date,
         l.due_date,
         l.return_date
       FROM loans l
       JOIN books b ON b.book_id = l.book_id
       WHERE l.member_id = ?
       ORDER BY l.loan_id DESC`,
      [memberId],
    );

    return res.status(200).json({
      member: members[0],
      data: loans,
    });
  } catch (error) {
    console.error("Get member loans error:", error);

    return res.status(500).json({
      error: "ไม่สามารถดึงประวัติการยืมได้",
    });
  }
});

// ========================
// GET /api/loans/overdue
// ดูรายการยืมเกินกำหนดที่ยังไม่ได้คืน
// ========================
app.get("/api/loans/overdue", ...adminOnly, async (req, res) => {
  try {
    const [loans] = await db.query(
      `SELECT
         l.loan_id,
         l.member_id,
         m.name AS member_name,
         l.book_id,
         b.title,
         l.loan_date,
         l.due_date
       FROM loans l
       JOIN members m ON m.member_id = l.member_id
       JOIN books b ON b.book_id = l.book_id
       WHERE l.due_date < CURDATE()
         AND l.return_date IS NULL
       ORDER BY l.due_date ASC`,
    );

    return res.status(200).json({
      data: loans,
    });
  } catch (error) {
    console.error("Get overdue loans error:", error);

    return res.status(500).json({
      error: "ไม่สามารถดึงรายการยืมเกินกำหนดได้",
    });
  }
});

// ========================
// POST /api/loans
// ยืมหนังสือ
// ========================
app.post("/api/loans", authenticate, async (req, res) => {
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
    return res.status(400).json({
      error: "วันที่ยืมและวันกำหนดคืนไม่ถูกต้อง",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [members] = await connection.query(
      "SELECT member_id FROM members WHERE member_id = ?",
      [memberId],
    );

    if (members.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        error: "ไม่พบสมาชิก",
      });
    }

    const [books] = await connection.query(
      `SELECT book_id, total_copies, available_copies
       FROM books
       WHERE book_id = ?
       FOR UPDATE`,
      [bookId],
    );

    if (books.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        error: "ไม่พบหนังสือ",
      });
    }

    if (Number(books[0].available_copies) <= 0) {
      await connection.rollback();

      return res.status(409).json({
        error: "หนังสือหมด ไม่มีเล่มให้ยืม",
      });
    }

    const [result] = await connection.query(
      `INSERT INTO loans (book_id, member_id, loan_date, due_date)
       VALUES (?, ?, ?, ?)`,
      [bookId, memberId, loanDate, due_date],
    );

    await connection.query(
      `UPDATE books
       SET available_copies = available_copies - 1
       WHERE book_id = ?`,
      [bookId],
    );

    await connection.commit();

    return res.status(201).json({
      message: "ยืมหนังสือสำเร็จ",
      loan_id: result.insertId,
      book_id: bookId,
      member_id: memberId,
      loan_date: loanDate,
      due_date,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Loan rollback error:", rollbackError);
      }
    }

    console.error("Create loan error:", error);

    return res.status(500).json({
      error: "ไม่สามารถทำรายการยืมหนังสือได้",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ========================
// PUT /api/loans/:id/return
// คืนหนังสือ
// ========================
app.put("/api/loans/:id/return", authenticate, async (req, res) => {
  const loanId = Number(req.params.id);

  if (!isPositiveInteger(loanId)) {
    return res.status(400).json({
      error: "รหัสรายการยืมไม่ถูกต้อง",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [loans] = await connection.query(
      `SELECT loan_id, book_id, member_id, return_date
       FROM loans
       WHERE loan_id = ?
       FOR UPDATE`,
      [loanId],
    );

    if (loans.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        error: "ไม่พบรายการยืม",
      });
    }

    // ผู้ใช้ทั่วไปคืนได้เฉพาะรายการยืมของตัวเอง
    if (req.user.role !== "admin" && loans[0].member_id !== req.user.member_id) {
      await connection.rollback();

      return deny(res, 403, "คืนได้เฉพาะรายการยืมของตัวเอง");
    }

    if (loans[0].return_date) {
      await connection.rollback();

      return res.status(409).json({
        error: "หนังสือรายการนี้ถูกคืนแล้ว",
      });
    }

    await connection.query(
      `UPDATE loans
       SET return_date = CURDATE()
       WHERE loan_id = ?`,
      [loanId],
    );

    await connection.query(
      `UPDATE books
       SET available_copies =
         LEAST(total_copies, available_copies + 1)
       WHERE book_id = ?`,
      [loans[0].book_id],
    );

    await connection.commit();

    return res.status(200).json({
      message: "คืนหนังสือสำเร็จ",
      loan_id: loanId,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Return rollback error:", rollbackError);
      }
    }

    console.error("Return loan error:", error);

    return res.status(500).json({
      error: "ไม่สามารถคืนหนังสือได้",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ========================
// JSON parsing error handler
// ========================
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      error: "รูปแบบ JSON ไม่ถูกต้อง",
    });
  }

  return next(error);
});

// ========================
// Start server
// ========================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Circulation Service running on port ${PORT}`);
    console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
  });
}

module.exports = app;
