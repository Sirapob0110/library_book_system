require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" }));

const router = express.Router();

// GET /api/v1/books - รายการหนังสือทั้งหมด พร้อมชื่อผู้แต่งและหมวดหมู่ (JOIN)
router.get("/books", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         books.id, books.title, books.isbn, books.published_year,
         books.total_copies, books.available_copies,
         authors.name AS author_name,
         categories.name AS category_name
       FROM books
       JOIN authors ON books.author_id = authors.id
       JOIN categories ON books.category_id = categories.id
       ORDER BY books.id`,
    );
    res.status(200).json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/books/:id - ข้อมูลหนังสือรายเล่ม
router.get("/books/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         books.id, books.title, books.isbn, books.published_year,
         books.total_copies, books.available_copies,
         authors.name AS author_name,
         categories.name AS category_name
       FROM books
       JOIN authors ON books.author_id = authors.id
       JOIN categories ON books.category_id = categories.id
       WHERE books.id = ?`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: { code: "BOOK_NOT_FOUND", message: "ไม่พบหนังสือที่ระบุ" },
      });
    }
    res.status(200).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/members/:id/loans - ประวัติการยืมของสมาชิกรายคน (JOIN)
router.get("/members/:id/loans", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         loans.id, loans.loan_date, loans.due_date, loans.return_date,
         books.title AS book_title
       FROM loans
       JOIN books ON loans.book_id = books.id
       WHERE loans.member_id = ?
       ORDER BY loans.loan_date DESC`,
      [req.params.id],
    );
    res.status(200).json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/loans/overdue - รายการยืมที่ยังไม่คืนและเลยกำหนดแล้ว
router.get("/loans/overdue", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         loans.id, loans.due_date, loans.loan_date,
         books.title AS book_title,
         members.name AS member_name, members.email AS member_email
       FROM loans
       JOIN books ON loans.book_id = books.id
       JOIN members ON loans.member_id = members.id
       WHERE loans.return_date IS NULL AND loans.due_date < CURDATE()
       ORDER BY loans.due_date ASC`,
    );
    res.status(200).json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/loans - สร้างรายการยืมใหม่ด้วย Transaction (กันที่นั่ง/สำเนาหนังสือหมดพร้อมกัน)
router.post("/loans", async (req, res, next) => {
  const { bookId, memberId, dueDate } = req.body || {};

  if (!bookId || !memberId || !dueDate) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "กรุณาระบุ bookId, memberId และ dueDate",
      },
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [bookRows] = await connection.query(
      "SELECT * FROM books WHERE id = ? FOR UPDATE",
      [bookId],
    );

    if (bookRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        error: { code: "BOOK_NOT_FOUND", message: "ไม่พบหนังสือที่ระบุ" },
      });
    }

    if (bookRows[0].available_copies <= 0) {
      await connection.rollback();
      return res.status(409).json({
        error: { code: "NO_COPIES_AVAILABLE", message: "หนังสือเล่มนี้ถูกยืมหมดแล้ว" },
      });
    }

    const [result] = await connection.query(
      "INSERT INTO loans (book_id, member_id, loan_date, due_date) VALUES (?, ?, CURDATE(), ?)",
      [bookId, memberId, dueDate],
    );

    await connection.query(
      "UPDATE books SET available_copies = available_copies - 1 WHERE id = ?",
      [bookId],
    );

    await connection.commit();
    res.status(201).json({ data: { id: result.insertId, bookId, memberId, dueDate } });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

app.use("/api/v1", router);

app.use((req, res) => {
  res.status(404).json({
    error: { code: "ROUTE_NOT_FOUND", message: "ไม่พบเส้นทางที่ร้องขอ" },
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",
      message:
        statusCode === 500
          ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ"
          : err.message,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server กำลังทำงานที่พอร์ต ${PORT} (${process.env.NODE_ENV})`);
});
