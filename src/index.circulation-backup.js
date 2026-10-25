const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const YAML = require("yaml");
const swaggerUi = require("swagger-ui-express");
const db = require("../db");

const app = express();
const PORT = Number(process.env.CIRCULATION_PORT) || 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Swagger UI
const swaggerDocument = YAML.parse(
  fs.readFileSync(path.join(__dirname, "openapi.yaml"), "utf8"),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check
app.get("/health", (req, res) => {
  res.json({
    service: "circulation-service",
    status: "ok",
  });
});

// ดึงรายชื่อสมาชิก
app.get("/api/members", async (req, res) => {
  try {
    const [members] = await db.query(
      `SELECT member_id, name, email, phone
       FROM members
       ORDER BY member_id DESC`,
    );

    return res.json({ data: members });
  } catch (error) {
    console.error("Get members error:", error);
    return res.status(500).json({
      error: "ไม่สามารถดึงข้อมูลสมาชิกได้",
    });
  }
});

// เพิ่มสมาชิก
app.post("/api/members", async (req, res) => {
  const { name, email, phone } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return res.status(400).json({
      error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง",
    });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO members (name, email, phone)
       VALUES (?, ?, ?)`,
      [
        name.trim(),
        email.trim(),
        typeof phone === "string" ? phone.trim() || null : null,
      ],
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

// แก้ไขข้อมูลสมาชิก
app.put("/api/members/:id", async (req, res) => {
  const memberId = Number(req.params.id);
  const { name, email, phone } = req.body;

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({
      error: "รหัสสมาชิกไม่ถูกต้อง",
    });
  }

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return res.status(400).json({
      error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง",
    });
  }

  try {
    const [existing] = await db.query(
      "SELECT member_id FROM members WHERE member_id = ?",
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
      [
        name.trim(),
        email.trim(),
        typeof phone === "string" ? phone.trim() || null : null,
        memberId,
      ],
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

// ลบสมาชิก
app.delete("/api/members/:id", async (req, res) => {
  const memberId = Number(req.params.id);

  if (!Number.isInteger(memberId) || memberId <= 0) {
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

// ดูประวัติการยืมของสมาชิก
app.get("/api/members/:id/loans", async (req, res) => {
  const memberId = Number(req.params.id);

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({
      error: "รหัสสมาชิกไม่ถูกต้อง",
    });
  }

  try {
    const [members] = await db.query(
      "SELECT member_id, name FROM members WHERE member_id = ?",
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

    return res.json({
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

// ดูรายการยืมเกินกำหนดที่ยังไม่ได้คืน
app.get("/api/loans/overdue", async (req, res) => {
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

    return res.json({ data: loans });
  } catch (error) {
    console.error("Get overdue loans error:", error);
    return res.status(500).json({
      error: "ไม่สามารถดึงรายการยืมเกินกำหนดได้",
    });
  }
});

// ตรวจสอบรูปแบบวันที่ YYYY-MM-DD
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

// ยืมหนังสือ
app.post("/api/loans", async (req, res) => {
  const { book_id, member_id, loan_date, due_date } = req.body;

  const bookId = Number(book_id);
  const memberId = Number(member_id);
  const today = new Date().toISOString().slice(0, 10);
  const loanDate = loan_date || today;

  if (
    !Number.isInteger(bookId) ||
    bookId <= 0 ||
    !Number.isInteger(memberId) ||
    memberId <= 0 ||
    typeof due_date !== "string" ||
    !due_date
  ) {
    return res.status(400).json({
      error: "กรุณาระบุ book_id, member_id และ due_date ให้ถูกต้อง",
    });
  }

  if (!validDate(loanDate) || !validDate(due_date) || due_date < loanDate) {
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

    if (books[0].available_copies <= 0) {
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
        console.error("Create loan rollback error:", rollbackError);
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

// คืนหนังสือ
app.put("/api/loans/:id/return", async (req, res) => {
  const loanId = Number(req.params.id);

  if (!Number.isInteger(loanId) || loanId <= 0) {
    return res.status(400).json({
      error: "รหัสรายการยืมไม่ถูกต้อง",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [loans] = await connection.query(
      `SELECT loan_id, book_id, return_date
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

    if (loans[0].return_date) {
      await connection.rollback();
      return res.status(409).json({
        error: "หนังสือรายการนี้ถูกคืนแล้ว",
      });
    }

    await connection.query(
      "UPDATE loans SET return_date = CURDATE() WHERE loan_id = ?",
      [loanId],
    );

    await connection.query(
      `UPDATE books
       SET available_copies = LEAST(total_copies, available_copies + 1)
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
        console.error("Return loan rollback error:", rollbackError);
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Circulation Service running on port ${PORT}`);
  });
}

module.exports = app;
