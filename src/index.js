require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const pool = require("./db");
const { lookupBookByIsbn } = require("./services/external-api");
const { signToken, authenticate, requireRole } = require("./auth");

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const adminOnly = [authenticate, requireRole("admin")];

const app = express();

// ---------- Middleware ----------
app.use(helmet());
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

// ---------- Swagger UI ----------
const openapiDoc = YAML.load(path.join(__dirname, "..", "openapi.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDoc));

// ---------- Helpers ----------
const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

function handleDbError(res, err) {
  if (err.code === "ER_DUP_ENTRY") {
    return fail(res, 409, "ข้อมูลซ้ำ (เช่น ISBN หรือชื่อหมวดหมู่มีอยู่แล้ว)");
  }

  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return fail(res, 400, "author_id หรือ category_ids ที่ระบุไม่มีอยู่ในระบบ");
  }

  console.error(err);
  return fail(res, 500, "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์");
}

function validateBook(body) {
  const { title, isbn, author_id, published_year, price } = body || {};

  if (!title || typeof title !== "string") return "title จำเป็นต้องระบุ";
  if (!isbn || typeof isbn !== "string") return "isbn จำเป็นต้องระบุ";
  if (!Number.isInteger(author_id)) return "author_id ต้องเป็นจำนวนเต็ม";

  if (
    published_year !== undefined &&
    published_year !== null &&
    !Number.isInteger(published_year)
  ) {
    return "published_year ต้องเป็นจำนวนเต็ม";
  }

  if (price !== undefined && (typeof price !== "number" || price < 0)) {
    return "price ต้องเป็นตัวเลขที่ไม่ติดลบ";
  }

  if (
    body.category_ids !== undefined &&
    !(
      Array.isArray(body.category_ids) &&
      body.category_ids.every(Number.isInteger)
    )
  ) {
    return "category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม";
  }

  return null;
}

// 2. แก้ไข getBookDetail เพิ่ม total_copies และ available_copies
async function getBookDetail(id) {
  const [rows] = await pool.query(
    `SELECT b.book_id, b.title, b.isbn,
            b.published_year, b.price,
            b.total_copies, b.available_copies,
            a.author_id, a.name AS author_name, a.nationality
     FROM books b
     JOIN authors a ON b.author_id = a.author_id
     WHERE b.book_id = ?`,
    [id],
  );

  if (rows.length === 0) return null;

  const [cats] = await pool.query(
    `SELECT c.category_id, c.name
     FROM book_categories bc
     JOIN categories c ON bc.category_id = c.category_id
     WHERE bc.book_id = ?
     ORDER BY c.category_id`,
    [id],
  );

  return { ...rows[0], categories: cats };
}

// ---------- Books ----------

// 1) รายการหนังสือ (ค้นหาด้วย ?q= ชื่อเรื่องหรือชื่อผู้แต่ง)
app.get("/api/books", authenticate, async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : null;

    const sql = `SELECT b.book_id, b.title, b.isbn,
                        b.published_year, b.price,
                        b.total_copies, b.available_copies,
                        a.author_id, a.name AS author_name
                 FROM books b
                 JOIN authors a ON b.author_id = a.author_id
                 ${q ? "WHERE b.title LIKE ? OR a.name LIKE ?" : ""}
                 ORDER BY b.book_id`;

    const [rows] = await pool.query(sql, q ? [q, q] : []);
    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 2) รายละเอียดหนังสือ
app.get("/api/books/:id", authenticate, async (req, res) => {
  try {
    const book = await getBookDetail(req.params.id);

    if (!book) return fail(res, 404, "ไม่พบหนังสือเล่มนี้");

    ok(res, book);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 3) เพิ่มหนังสือ (transaction)
app.post("/api/books", ...adminOnly, async (req, res) => {
  const error = validateBook(req.body);
  if (error) return fail(res, 400, error);

  const { title, isbn, author_id, published_year, price, category_ids } =
    req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO books
       (title, isbn, author_id, published_year, price)
       VALUES (?, ?, ?, ?, ?)`,
      [title, isbn, author_id, published_year ?? null, price ?? 0],
    );

    if (category_ids && category_ids.length) {
      await conn.query(
        `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
        [category_ids.map((c) => [result.insertId, c])],
      );
    }

    await conn.commit();
    ok(res, await getBookDetail(result.insertId), 201);
  } catch (err) {
    await conn.rollback();
    handleDbError(res, err);
  } finally {
    conn.release();
  }
});

// 4) แก้ไขหนังสือ
app.put("/api/books/:id", ...adminOnly, async (req, res) => {
  const error = validateBook(req.body);
  if (error) return fail(res, 400, error);

  const { title, isbn, author_id, published_year, price, category_ids } =
    req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `UPDATE books
       SET title = ?, isbn = ?, author_id = ?, published_year = ?, price = ?
       WHERE book_id = ?`,
      [
        title,
        isbn,
        author_id,
        published_year ?? null,
        price ?? 0,
        req.params.id,
      ],
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return fail(res, 404, "ไม่พบหนังสือเล่มนี้");
    }

    if (category_ids !== undefined) {
      await conn.query(`DELETE FROM book_categories WHERE book_id = ?`, [
        req.params.id,
      ]);

      if (category_ids.length) {
        await conn.query(
          `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
          [category_ids.map((c) => [Number(req.params.id), c])],
        );
      }
    }

    await conn.commit();
    ok(res, await getBookDetail(req.params.id));
  } catch (err) {
    await conn.rollback();
    handleDbError(res, err);
  } finally {
    conn.release();
  }
});

// 5) ลบหนังสือ
app.delete("/api/books/:id", ...adminOnly, async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM books WHERE book_id = ?", [
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return fail(res, 404, "ไม่พบหนังสือเล่มนี้");
    }

    ok(res, { deleted_book_id: Number(req.params.id) });
  } catch (err) {
    handleDbError(res, err);
  }
});

// 6) ข้อมูลเพิ่มเติมจาก API ภายนอก (Open Library)
app.get("/api/books/:id/external-info", authenticate, async (req, res) => {
  try {
    const book = await getBookDetail(req.params.id);

    if (!book) return fail(res, 404, "ไม่พบหนังสือเล่มนี้");

    const info = await lookupBookByIsbn(book.isbn);
    ok(res, { book, ...info });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Authors ----------

// 7) รายการผู้แต่ง
app.get("/api/authors", authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT author_id, name, nationality, birth_year FROM authors ORDER BY name",
    );

    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 8) เพิ่มผู้แต่ง
app.post("/api/authors", ...adminOnly, async (req, res) => {
  const { name, nationality, birth_year } = req.body || {};

  if (!name || typeof name !== "string") {
    return fail(res, 400, "name จำเป็นต้องระบุ");
  }

  if (
    birth_year !== undefined &&
    birth_year !== null &&
    !Number.isInteger(birth_year)
  ) {
    return fail(res, 400, "birth_year ต้องเป็นจำนวนเต็ม");
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO authors (name, nationality, birth_year) VALUES (?, ?, ?)",
      [name, nationality ?? null, birth_year ?? null],
    );

    ok(
      res,
      {
        author_id: result.insertId,
        name,
        nationality: nationality ?? null,
        birth_year: birth_year ?? null,
      },
      201,
    );
  } catch (err) {
    handleDbError(res, err);
  }
});

// 9) หนังสือทั้งหมดของผู้แต่งคนหนึ่ง
app.get("/api/authors/:id/books", authenticate, async (req, res) => {
  try {
    const [authors] = await pool.query(
      "SELECT author_id, name FROM authors WHERE author_id = ?",
      [req.params.id],
    );

    if (authors.length === 0) {
      return fail(res, 404, "ไม่พบผู้แต่งคนนี้");
    }

    const [books] = await pool.query(
      `SELECT book_id, title, isbn, published_year, price
       FROM books
       WHERE author_id = ?
       ORDER BY published_year`,
      [req.params.id],
    );

    ok(res, { author: authors[0], books });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Categories ----------

// 10) รายการหมวดหมู่
app.get("/api/categories", authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT category_id, name FROM categories ORDER BY name",
    );

    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 11) เพิ่มหมวดหมู่
app.post("/api/categories", ...adminOnly, async (req, res) => {
  const { name } = req.body || {};

  if (!name || typeof name !== "string") {
    return fail(res, 400, "name จำเป็นต้องระบุ");
  }

  try {
    const [result] = await pool.query(
      "INSERT INTO categories (name) VALUES (?)",
      [name],
    );

    ok(res, { category_id: result.insertId, name }, 201);
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Auth (สมัครสมาชิก / เข้าสู่ระบบ) ----------
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// hash สำหรับเทียบเมื่อไม่พบผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกรณีรหัสผ่านผิด
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function validateRegister(body) {
  const { username, password, name, email, phone } = body || {};

  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "username ต้องยาว 3-30 ตัวอักษร ใช้ได้เฉพาะ A-Z a-z 0-9 และ _";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return "password ต้องยาว 8-72 ตัวอักษร";
  }
  if (typeof name !== "string" || name.trim().length < 2) {
    return "name ต้องมีอย่างน้อย 2 ตัวอักษร";
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return "email ไม่ถูกต้อง";
  }
  if (phone !== undefined && phone !== null && phone !== "" && typeof phone !== "string") {
    return "phone ต้องเป็นข้อความ";
  }
  return null;
}

// สมัครสมาชิก: สร้างสมาชิกห้องสมุดและบัญชีผู้ใช้ (บทบาท user เสมอ) ในธุรกรรมเดียวกัน
app.post("/api/auth/register", async (req, res) => {
  const error = validateRegister(req.body);
  if (error) return fail(res, 400, error);

  const { username, password, name, email, phone } = req.body;
  const passwordHash = await bcrypt.hash(password, 10);
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [member] = await conn.query(
      "INSERT INTO members (name, email, phone) VALUES (?, ?, ?)",
      [name.trim(), email.trim(), phone ? phone.trim() : null],
    );
    const [user] = await conn.query(
      "INSERT INTO users (username, password_hash, role, member_id) VALUES (?, ?, 'user', ?)",
      [username, passwordHash, member.insertId],
    );

    await conn.commit();
    ok(
      res,
      { user_id: user.insertId, username, role: "user", member_id: member.insertId },
      201,
    );
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      return fail(res, 409, "username หรืออีเมลนี้ถูกใช้งานแล้ว");
    }
    handleDbError(res, err);
  } finally {
    if (conn) conn.release();
  }
});

// เข้าสู่ระบบ: ตรวจรหัสผ่านแล้วออก JWT
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return fail(res, 400, "กรุณาระบุ username และ password");
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.role, u.member_id, m.name
       FROM users u LEFT JOIN members m ON m.member_id = u.member_id
       WHERE u.username = ?`,
      [username],
    );
    const user = rows[0];
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !match) {
      return fail(res, 401, "username หรือ password ไม่ถูกต้อง");
    }

    ok(res, {
      token: signToken(user),
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        member_id: user.member_id,
        name: user.name || user.username,
      },
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (อ่านจาก token)
app.get("/api/auth/me", authenticate, (req, res) => {
  ok(res, req.user);
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Book API: http://localhost:${PORT}`);
    console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
  });
}

// Export Express app for testing with Supertest
module.exports = app;
