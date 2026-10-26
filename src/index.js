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
const catalog = require("./services/catalog");
const { generalLimiter, loginLimiter, registerLimiter } = require("./middlewares/rate-limiter");
const { notFound, errorHandler } = require("./middlewares/errors");
const { validateBody } = require("./schemas/validate");
const { bookSchema, authorSchema, categorySchema } = require("./schemas/catalog");
const { registerSchema, loginSchema } = require("./schemas/user");
const { graphqlHandler } = require("./graphql");

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const adminOnly = [authenticate, requireRole("admin")];

const app = express();

// อยู่หลัง proxy/gateway 1 ชั้น ให้ rate limit นับ IP ของผู้ใช้จริงจาก X-Forwarded-For
app.set("trust proxy", 1);

// ---------- Middleware (ลำดับสำคัญ: เรียงจากบนลงล่าง) ----------
app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));
app.use(express.json({ limit: "10kb" })); // ข้อมูลเกิน 10KB ตอบ 413

// ---------- Health check (ใช้โดย Gateway และเครื่องมือเฝ้าระวัง) ----------
app.get("/health", (req, res) => {
  res.status(200).json({ service: "book-api", status: "ok" });
});

// ---------- Swagger UI ----------
const openapiDoc = YAML.load(path.join(__dirname, "..", "openapi.yaml"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDoc));

// ทุก route ด้านล่างนับโควตา 100 คำขอต่อนาทีต่อ IP (Swagger UI ไม่นับ)
app.use(generalLimiter);

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

// ---------- Books ----------

// 1) รายการหนังสือ: ค้นหา กรอง เรียง แบ่งหน้า
//    ?q= ชื่อเรื่องหรือผู้แต่ง · ?author_id= · ?category_id= · ?available=true
//    ?sort=id|title|published_year|price|available_copies · ?order=asc|desc · ?page= · ?limit= (สูงสุด 100)
app.get("/api/books", authenticate, async (req, res) => {
  try {
    const { value, source } = await catalog.loadBookList(req.query);

    res.set("X-Cache", source === "cache" ? "HIT" : "MISS");
    res.json({
      success: true,
      data: value.rows,
      pagination: value.pagination,
      source,
    });
  } catch (err) {
    handleDbError(res, err);
  }
});

// 2) รายละเอียดหนังสือ
app.get("/api/books/:id", authenticate, async (req, res) => {
  try {
    const book = await catalog.getBookDetail(req.params.id);

    if (!book) return fail(res, 404, "ไม่พบหนังสือเล่มนี้");

    ok(res, book);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 3) เพิ่มหนังสือ (transaction ใน services/catalog.js)
app.post("/api/books", ...adminOnly, validateBody(bookSchema), async (req, res) => {
  try {
    ok(res, await catalog.createBook(req.body), 201);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 4) แก้ไขหนังสือ
app.put("/api/books/:id", ...adminOnly, validateBody(bookSchema), async (req, res) => {
  try {
    const book = await catalog.updateBook(req.params.id, req.body);

    if (!book) return fail(res, 404, "ไม่พบหนังสือเล่มนี้");

    ok(res, book);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 5) ลบหนังสือ
app.delete("/api/books/:id", ...adminOnly, async (req, res) => {
  try {
    if (!(await catalog.deleteBook(req.params.id))) {
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
    const book = await catalog.getBookDetail(req.params.id);

    if (!book) return fail(res, 404, "ไม่พบหนังสือเล่มนี้");

    const info = await lookupBookByIsbn(book.isbn);
    ok(res, { book, ...info });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Authors ----------

// 7) รายการผู้แต่ง (cache 5 นาที ล้างเมื่อเพิ่มผู้แต่ง)
app.get("/api/authors", authenticate, async (req, res) => {
  try {
    const { value, source } = await catalog.listAuthors();

    res.set("X-Cache", source === "cache" ? "HIT" : "MISS");
    res.json({ success: true, data: value, source });
  } catch (err) {
    handleDbError(res, err);
  }
});

// 8) เพิ่มผู้แต่ง
app.post("/api/authors", ...adminOnly, validateBody(authorSchema), async (req, res) => {
  try {
    ok(res, await catalog.createAuthor(req.body), 201);
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

// 10) รายการหมวดหมู่ (cache 5 นาที ล้างเมื่อเพิ่มหมวดหมู่)
app.get("/api/categories", authenticate, async (req, res) => {
  try {
    const { value, source } = await catalog.listCategories();

    res.set("X-Cache", source === "cache" ? "HIT" : "MISS");
    res.json({ success: true, data: value, source });
  } catch (err) {
    handleDbError(res, err);
  }
});

// 11) เพิ่มหมวดหมู่
app.post("/api/categories", ...adminOnly, validateBody(categorySchema), async (req, res) => {
  try {
    ok(res, await catalog.createCategory(req.body), 201);
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Auth (สมัครสมาชิก / เข้าสู่ระบบ) ----------
// hash สำหรับเทียบเมื่อไม่พบผู้ใช้ เพื่อให้เวลาตอบใกล้เคียงกรณีรหัสผ่านผิด
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

// สมัครสมาชิก: สร้างสมาชิกห้องสมุดและบัญชีผู้ใช้ (บทบาท user เสมอ) ในธุรกรรมเดียวกัน
app.post("/api/auth/register", registerLimiter, validateBody(registerSchema), async (req, res) => {
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
app.post("/api/auth/login", loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body;

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

// ---------- GraphQL (Lab 2): เรียกด้วย POST /graphql ต้องเข้าสู่ระบบ ----------
app.post("/graphql", authenticate, graphqlHandler);

// ---------- 404 และตัวจัดการข้อผิดพลาด (ต้องอยู่หลังทุก route) ----------
app.use(notFound);
app.use(errorHandler);

// ---------- Start ----------
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  require("./cache").connectCache().then(() => {
    app.listen(PORT, () => {
      console.log(`Book API: http://localhost:${PORT}`);
      console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
    });
  });
}

// Export Express app for testing with Supertest
module.exports = app;
