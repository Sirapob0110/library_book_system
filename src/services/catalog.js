// ชั้นข้อมูลของหนังสือ ผู้แต่ง หมวดหมู่ ใช้ร่วมกันทั้ง REST (src/index.js) และ GraphQL (src/graphql)
// ที่นี่มี SQL และการล้าง cache ที่เดียว ส่วน handler ทำหน้าที่แปลงคำขอ/คำตอบเท่านั้น
const pool = require("../db");
const cache = require("../cache");
const { parsePagination, parseSort, buildPagination } = require("../middlewares/query-parser");

const BOOK_LIST_TTL = 60; // วินาที
const REFERENCE_TTL = 300; // ผู้แต่ง / หมวดหมู่ เปลี่ยนไม่บ่อย

// allowlist ของฟิลด์ที่เรียงได้ (ชื่อที่รับจากผู้ใช้ -> คอลัมน์จริง) กัน SQL injection ผ่าน ORDER BY
const BOOK_SORT = {
  id: "b.book_id",
  title: "b.title",
  published_year: "b.published_year",
  price: "b.price",
  available_copies: "b.available_copies",
};

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

// รายการหนังสือ: ค้นหา กรอง เรียง แบ่งหน้า (ค่าที่ไม่ถูกต้องใช้ค่าเริ่มต้น ไม่ error)
async function queryBooks(query) {
  const { page, limit, offset } = parsePagination(query);
  const { column, order } = parseSort(query, BOOK_SORT, "id");
  const where = [];
  const params = [];

  if (typeof query.q === "string" && query.q.trim()) {
    where.push("(b.title LIKE ? OR a.name LIKE ?)");
    params.push(`%${query.q.trim()}%`, `%${query.q.trim()}%`);
  }

  const authorId = Number.parseInt(query.author_id, 10);
  if (Number.isInteger(authorId)) {
    where.push("b.author_id = ?");
    params.push(authorId);
  }

  const categoryId = Number.parseInt(query.category_id, 10);
  if (Number.isInteger(categoryId)) {
    where.push(
      "EXISTS (SELECT 1 FROM book_categories bc WHERE bc.book_id = b.book_id AND bc.category_id = ?)",
    );
    params.push(categoryId);
  }

  if (query.available === "true") where.push("b.available_copies > 0");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM books b JOIN authors a ON b.author_id = a.author_id ${whereSql}`;

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [rows] = await pool.query(
    `SELECT b.book_id, b.title, b.isbn,
            b.published_year, b.price,
            b.total_copies, b.available_copies,
            a.author_id, a.name AS author_name
     ${from}
     ORDER BY ${column} ${order}, b.book_id ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    rows,
    pagination: buildPagination({ page, limit }, countRows[0].total),
  };
}

// จำนวนคงเหลือถูกปรับโดย Circulation Service จึงเก็บ cache รายการหนังสือเฉพาะเมื่อใช้ Redis
// ที่สองบริการใช้ร่วมกัน (Circulation ล้าง key "books:" เมื่อมีการยืม/คืน) ไม่งั้นข้อมูลจะค้างเก่า
async function loadBookList(query) {
  if (!cache.isShared()) {
    return { value: await queryBooks(query), source: "database" };
  }

  const keyParts = {
    q: query.q,
    author_id: query.author_id,
    category_id: query.category_id,
    available: query.available,
    sort: query.sort,
    order: query.order,
    page: query.page,
    limit: query.limit,
  };

  return cache.remember(`books:list:${JSON.stringify(keyParts)}`, BOOK_LIST_TTL, () =>
    queryBooks(query),
  );
}

// เพิ่มหนังสือและหมวดหมู่ใน transaction เดียว (ล้มเหลวแล้ว rollback ทั้งหมด)
async function createBook(data) {
  const { title, isbn, author_id, published_year, price, category_ids } = data;
  let conn;
  let id;

  try {
    conn = await pool.getConnection(); // อยู่ใน try: ถ้าฐานข้อมูลล่มจะตอบ 500 ไม่ค้างโดยไม่ตอบ
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO books
       (title, isbn, author_id, published_year, price)
       VALUES (?, ?, ?, ?, ?)`,
      [title, isbn, author_id, published_year ?? null, price ?? 0],
    );
    id = result.insertId;

    if (category_ids && category_ids.length) {
      await conn.query(
        `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
        [category_ids.map((c) => [id, c])],
      );
    }

    await conn.commit();
    await cache.invalidate("books:");
    return await getBookDetail(id);
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// แก้ไขหนังสือ: คืน null ถ้าไม่พบ category_ids ที่ส่งมาจะแทนที่ชุดเดิมทั้งหมด
async function updateBook(id, data) {
  const { title, isbn, author_id, published_year, price, category_ids } = data;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `UPDATE books
       SET title = ?, isbn = ?, author_id = ?, published_year = ?, price = ?
       WHERE book_id = ?`,
      [title, isbn, author_id, published_year ?? null, price ?? 0, id],
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return null;
    }

    if (category_ids !== undefined) {
      await conn.query(`DELETE FROM book_categories WHERE book_id = ?`, [id]);

      if (category_ids.length) {
        await conn.query(
          `INSERT INTO book_categories (book_id, category_id) VALUES ?`,
          [category_ids.map((c) => [Number(id), c])],
        );
      }
    }

    await conn.commit();
    await cache.invalidate("books:");
    return await getBookDetail(id);
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// ลบหนังสือ: คืน true ถ้าลบได้ false ถ้าไม่พบ
async function deleteBook(id) {
  const [result] = await pool.query("DELETE FROM books WHERE book_id = ?", [id]);

  if (result.affectedRows === 0) return false;

  await cache.invalidate("books:");
  return true;
}

async function listAuthors() {
  return cache.remember("authors:all", REFERENCE_TTL, async () => {
    const [rows] = await pool.query(
      "SELECT author_id, name, nationality, birth_year FROM authors ORDER BY name",
    );
    return rows;
  });
}

async function createAuthor({ name, nationality, birth_year }) {
  const [result] = await pool.query(
    "INSERT INTO authors (name, nationality, birth_year) VALUES (?, ?, ?)",
    [name, nationality ?? null, birth_year ?? null],
  );

  await cache.invalidate("authors:");

  return {
    author_id: result.insertId,
    name,
    nationality: nationality ?? null,
    birth_year: birth_year ?? null,
  };
}

async function listCategories() {
  return cache.remember("categories:all", REFERENCE_TTL, async () => {
    const [rows] = await pool.query("SELECT category_id, name FROM categories ORDER BY name");
    return rows;
  });
}

async function createCategory({ name }) {
  const [result] = await pool.query("INSERT INTO categories (name) VALUES (?)", [name]);

  await cache.invalidate("categories:");

  return { category_id: result.insertId, name };
}

module.exports = {
  BOOK_SORT,
  getBookDetail,
  queryBooks,
  loadBookList,
  createBook,
  updateBook,
  deleteBook,
  listAuthors,
  createAuthor,
  listCategories,
  createCategory,
};
