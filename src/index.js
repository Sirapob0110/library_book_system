require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const pool = require('./db');
const { lookupBookByIsbn } = require('./services/external-api');

const app = express();

// ---------- Middleware ----------
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ---------- Swagger UI ----------
const openapiDoc = YAML.load(path.join(__dirname, '..', 'openapi.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));

// ---------- Helpers ----------
const ok = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

function handleDbError(res, err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return fail(res, 409, 'ข้อมูลซ้ำ (เช่น ISBN หรือชื่อหมวดหมู่มีอยู่แล้ว)');
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return fail(res, 400, 'author_id หรือ category_ids ที่ระบุไม่มีอยู่ในระบบ');
  }

  console.error(err);
  return fail(res, 500, 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
}

function validateBook(body) {
  const { title, isbn, author_id, published_year, price } = body || {};

  if (!title || typeof title !== 'string') return 'title จำเป็นต้องระบุ';
  if (!isbn || typeof isbn !== 'string') return 'isbn จำเป็นต้องระบุ';
  if (!Number.isInteger(author_id)) return 'author_id ต้องเป็นจำนวนเต็ม';

  if (
    published_year !== undefined &&
    published_year !== null &&
    !Number.isInteger(published_year)
  ) {
    return 'published_year ต้องเป็นจำนวนเต็ม';
  }

  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    return 'price ต้องเป็นตัวเลขที่ไม่ติดลบ';
  }

  if (
    body.category_ids !== undefined &&
    !(
      Array.isArray(body.category_ids) &&
      body.category_ids.every(Number.isInteger)
    )
  ) {
    return 'category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม';
  }

  return null;
}

async function getBookDetail(id) {
  const [rows] = await pool.query(
    `SELECT b.book_id, b.title, b.isbn, b.published_year, b.price,
            a.author_id, a.name AS author_name, a.nationality
     FROM books b
     JOIN authors a ON b.author_id = a.author_id
     WHERE b.book_id = ?`,
    [id]
  );

  if (rows.length === 0) return null;

  const [cats] = await pool.query(
    `SELECT c.category_id, c.name
     FROM book_categories bc
     JOIN categories c ON bc.category_id = c.category_id
     WHERE bc.book_id = ?
     ORDER BY c.category_id`,
    [id]
  );

  return { ...rows[0], categories: cats };
}

// ---------- Books ----------

// 1) รายการหนังสือ (ค้นหาด้วย ?q= ชื่อเรื่องหรือชื่อผู้แต่ง)
app.get('/api/books', async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : null;

    const sql = `SELECT b.book_id, b.title, b.isbn, b.published_year, b.price,
                        a.author_id, a.name AS author_name
                 FROM books b
                 JOIN authors a ON b.author_id = a.author_id
                 ${q ? 'WHERE b.title LIKE ? OR a.name LIKE ?' : ''}
                 ORDER BY b.book_id`;

    const [rows] = await pool.query(sql, q ? [q, q] : []);
    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 2) รายละเอียดหนังสือ
app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await getBookDetail(req.params.id);

    if (!book) return fail(res, 404, 'ไม่พบหนังสือเล่มนี้');

    ok(res, book);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 3) เพิ่มหนังสือ (transaction)
app.post('/api/books', async (req, res) => {
  const error = validateBook(req.body);
  if (error) return fail(res, 400, error);

  const { title, isbn, author_id, published_year, price, category_ids } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO books
       (title, isbn, author_id, published_year, price)
       VALUES (?, ?, ?, ?, ?)`,
      [title, isbn, author_id, published_year ?? null, price ?? 0]
    );

    if (category_ids && category_ids.length) {
      await conn.query(
        `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
        [category_ids.map((c) => [result.insertId, c])]
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
app.put('/api/books/:id', async (req, res) => {
  const error = validateBook(req.body);
  if (error) return fail(res, 400, error);

  const { title, isbn, author_id, published_year, price, category_ids } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `UPDATE books
       SET title = ?, isbn = ?, author_id = ?, published_year = ?, price = ?
       WHERE book_id = ?`,
      [title, isbn, author_id, published_year ?? null, price ?? 0, req.params.id]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return fail(res, 404, 'ไม่พบหนังสือเล่มนี้');
    }

    if (category_ids !== undefined) {
      await conn.query(
        `DELETE FROM book_categories WHERE book_id = ?`,
        [req.params.id]
      );

      if (category_ids.length) {
        await conn.query(
          `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
          [category_ids.map((c) => [Number(req.params.id), c])]
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
app.delete('/api/books/:id', async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM books WHERE book_id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return fail(res, 404, 'ไม่พบหนังสือเล่มนี้');
    }

    ok(res, { deleted_book_id: Number(req.params.id) });
  } catch (err) {
    handleDbError(res, err);
  }
});

// 6) ข้อมูลเพิ่มเติมจาก API ภายนอก (Open Library)
app.get('/api/books/:id/external-info', async (req, res) => {
  try {
    const book = await getBookDetail(req.params.id);

    if (!book) return fail(res, 404, 'ไม่พบหนังสือเล่มนี้');

    const info = await lookupBookByIsbn(book.isbn);
    ok(res, { book, ...info });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Authors ----------

// 7) รายการผู้แต่ง
app.get('/api/authors', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT author_id, name, nationality, birth_year FROM authors ORDER BY name'
    );

    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 8) เพิ่มผู้แต่ง
app.post('/api/authors', async (req, res) => {
  const { name, nationality, birth_year } = req.body || {};

  if (!name || typeof name !== 'string') {
    return fail(res, 400, 'name จำเป็นต้องระบุ');
  }

  if (
    birth_year !== undefined &&
    birth_year !== null &&
    !Number.isInteger(birth_year)
  ) {
    return fail(res, 400, 'birth_year ต้องเป็นจำนวนเต็ม');
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO authors (name, nationality, birth_year) VALUES (?, ?, ?)',
      [name, nationality ?? null, birth_year ?? null]
    );

    ok(
      res,
      {
        author_id: result.insertId,
        name,
        nationality: nationality ?? null,
        birth_year: birth_year ?? null
      },
      201
    );
  } catch (err) {
    handleDbError(res, err);
  }
});

// 9) หนังสือทั้งหมดของผู้แต่งคนหนึ่ง
app.get('/api/authors/:id/books', async (req, res) => {
  try {
    const [authors] = await pool.query(
      'SELECT author_id, name FROM authors WHERE author_id = ?',
      [req.params.id]
    );

    if (authors.length === 0) {
      return fail(res, 404, 'ไม่พบผู้แต่งคนนี้');
    }

    const [books] = await pool.query(
      `SELECT book_id, title, isbn, published_year, price
       FROM books
       WHERE author_id = ?
       ORDER BY published_year`,
      [req.params.id]
    );

    ok(res, { author: authors[0], books });
  } catch (err) {
    handleDbError(res, err);
  }
});

// ---------- Categories ----------

// 10) รายการหมวดหมู่
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT category_id, name FROM categories ORDER BY name'
    );

    ok(res, rows);
  } catch (err) {
    handleDbError(res, err);
  }
});

// 11) เพิ่มหมวดหมู่
app.post('/api/categories', async (req, res) => {
  const { name } = req.body || {};

  if (!name || typeof name !== 'string') {
    return fail(res, 400, 'name จำเป็นต้องระบุ');
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO categories (name) VALUES (?)',
      [name]
    );

    ok(res, { category_id: result.insertId, name }, 201);
  } catch (err) {
    handleDbError(res, err);
  }
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
