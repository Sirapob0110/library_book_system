jest.mock("../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../src/services/external-api", () => ({
  lookupBookByIsbn: jest.fn(),
}));

const request = require("supertest");
const { as, admin } = require("./helpers/auth");
const app = require("../src/index");
const cache = require("../src/cache");
const pool = require("../src/db");
const { lookupBookByIsbn } = require("../src/services/external-api");

describe("Book API", () => {
  let conn;

  const validBook = {
    title: "Test Book",
    isbn: "9780000000001",
    author_id: 1,
    published_year: 2025,
    price: 250,
  };

  const bookDetail = {
    book_id: 1,
    ...validBook,
    total_copies: 3,
    available_copies: 2,
    author_name: "Test Author",
    nationality: "Thai",
  };

  const categories = [{ category_id: 1, name: "Programming" }];

  function mockBookDetail(book = bookDetail, cats = categories) {
    pool.query.mockResolvedValueOnce([[book]]).mockResolvedValueOnce([cats]);
  }

  function mockConnection() {
    conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };

    pool.getConnection.mockResolvedValue(conn);
    return conn;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------- GET BOOKS ----------

  // รายการหนังสือใช้ 2 query: นับจำนวนทั้งหมด แล้วดึงข้อมูลหน้านั้น
  function mockBookList(rows, total = rows.length) {
    pool.query.mockResolvedValueOnce([[{ total }]]).mockResolvedValueOnce([rows]);
  }

  describe("GET /api/books", () => {
    const books = [
      {
        book_id: 1,
        title: "Test Book",
        isbn: "9780000000001",
        total_copies: 3,
        available_copies: 2,
        author_name: "Test Author",
      },
    ];

    test("returns books with pagination (defaults page 1, limit 10)", async () => {
      mockBookList(books);

      const res = await as(app, admin).get("/api/books");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(books);
      expect(res.body.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
      expect(res.body.source).toBe("database");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    test("returns an empty list when no books exist", async () => {
      mockBookList([]);

      const res = await as(app, admin).get("/api/books");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.totalPages).toBe(1);
    });

    test("filters books by search query", async () => {
      mockBookList([bookDetail]);

      const res = await as(app, admin).get("/api/books").query({ q: "Test" });

      expect(res.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE b.deleted_at IS NULL AND (b.title LIKE ? OR a.name LIKE ?)"),
        ["%Test%", "%Test%"],
      );
    });

    test("applies page, limit and computes offset and totalPages", async () => {
      mockBookList(books, 25);

      const res = await as(app, admin).get("/api/books").query({ page: 2, limit: 10 });

      expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
      expect(pool.query).toHaveBeenLastCalledWith(
        expect.stringContaining("LIMIT ? OFFSET ?"),
        [10, 10],
      );
    });

    test("clamps limit to 100 and falls back to defaults for invalid paging", async () => {
      mockBookList(books);
      const big = await as(app, admin).get("/api/books").query({ limit: 5000 });
      expect(big.body.pagination.limit).toBe(100);

      mockBookList(books);
      const bad = await as(app, admin)
        .get("/api/books")
        .query({ page: "abc", limit: "-3" });
      expect(bad.body.pagination.page).toBe(1);
      expect(bad.body.pagination.limit).toBe(1);

      mockBookList(books);
      const zero = await as(app, admin).get("/api/books").query({ page: 0 });
      expect(zero.body.pagination.page).toBe(1);
    });

    test("sorts by an allowed field and order", async () => {
      mockBookList(books);

      await as(app, admin).get("/api/books").query({ sort: "price", order: "desc" });

      expect(pool.query).toHaveBeenLastCalledWith(
        expect.stringContaining("ORDER BY b.price DESC, b.book_id ASC"),
        [10, 0],
      );
    });

    test("falls back to id when sort is not in the allowlist (SQL injection attempt)", async () => {
      mockBookList(books);

      const res = await as(app, admin)
        .get("/api/books")
        .query({ sort: "id;DROP TABLE books--", order: "desc; DELETE" });

      expect(res.status).toBe(200);
      const sql = pool.query.mock.calls.at(-1)[0];
      expect(sql).toContain("ORDER BY b.book_id ASC, b.book_id ASC");
      expect(sql).not.toContain("DROP");
    });

    test("filters by author_id, category_id and availability with bound parameters", async () => {
      mockBookList(books);

      await as(app, admin)
        .get("/api/books")
        .query({ author_id: 2, category_id: 3, available: "true" });

      const [sql, params] = pool.query.mock.calls.at(-1);
      expect(sql).toContain("b.author_id = ?");
      expect(sql).toContain("bc.category_id = ?");
      expect(sql).toContain("b.available_copies > 0");
      expect(params).toEqual([2, 3, 10, 0]);
    });

    test("ignores a non-numeric author_id and a repeated q parameter", async () => {
      mockBookList(books);

      await as(app, admin).get("/api/books?author_id=abc&q=a&q=b");

      const [sql, params] = pool.query.mock.calls.at(-1);
      expect(sql).not.toContain("b.author_id = ?");
      expect(sql).not.toContain("LIKE");
      expect(params).toEqual([10, 0]);
    });

    test("returns 500 when database query fails", async () => {
      const error = new Error("Database unavailable");
      const log = jest.spyOn(console, "error").mockImplementation(() => {});

      pool.query.mockRejectedValueOnce(error);

      const res = await as(app, admin).get("/api/books");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      log.mockRestore();
    });

    test("uses the shared cache when Redis is available (HIT skips the database)", async () => {
      const shared = jest.spyOn(cache, "isShared").mockReturnValue(true);
      const remember = jest
        .spyOn(cache, "remember")
        .mockResolvedValue({ value: { rows: books, pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }, source: "cache" });

      const res = await as(app, admin).get("/api/books").query({ q: "x", sort: "title" });

      expect(res.status).toBe(200);
      expect(res.body.source).toBe("cache");
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(pool.query).not.toHaveBeenCalled();
      expect(remember.mock.calls[0][0]).toContain('"q":"x"');
      expect(remember.mock.calls[0][0]).toContain('"sort":"title"');

      shared.mockRestore();
      remember.mockRestore();
    });
  });

  // ---------- GET BOOK DETAIL ----------

  describe("GET /api/books/:id", () => {
    test("returns 404 when the book does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).get("/api/books/99999");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("returns book details with categories", async () => {
      mockBookDetail();

      const res = await as(app, admin).get("/api/books/1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.book_id).toBe(1);
      expect(res.body.data.categories).toEqual(categories);
    });

    test("returns 500 when loading book details fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await as(app, admin).get("/api/books/1");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  // ---------- POST BOOK ----------

  describe("POST /api/books", () => {
    test("returns 400 when required book data is missing", async () => {
      const res = await as(app, admin)
        .post("/api/books")
        .send({ title: "Test Book" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("isbn จำเป็นต้องระบุ");
    });

    test("returns 400 when author_id is not an integer", async () => {
      const res = await as(app, admin)
        .post("/api/books")
        .send({
          ...validBook,
          author_id: "invalid",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 400 when published_year is not an integer", async () => {
      const res = await as(app, admin)
        .post("/api/books")
        .send({
          ...validBook,
          published_year: "2025",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("published_year ต้องเป็นจำนวนเต็ม");
    });

    test("returns 400 when price is negative", async () => {
      const res = await as(app, admin)
        .post("/api/books")
        .send({
          ...validBook,
          price: -1,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("price ต้องเป็นตัวเลขที่ไม่ติดลบ");
    });

    test("returns 400 when category_ids is invalid", async () => {
      const res = await as(app, admin)
        .post("/api/books")
        .send({
          ...validBook,
          category_ids: "1",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม",
      );
    });

    test("creates a book successfully", async () => {
      const connection = mockConnection();
      connection.query.mockResolvedValueOnce([{ insertId: 10 }]);
      mockBookDetail({ ...bookDetail, book_id: 10 }, []);

      const res = await as(app, admin).post("/api/books").send(validBook);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.book_id).toBe(10);
      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("creates a book with categories", async () => {
      const connection = mockConnection();

      connection.query
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      mockBookDetail({ ...bookDetail, book_id: 10 });

      const res = await as(app, admin)
        .post("/api/books")
        .send({ ...validBook, category_ids: [1] });

      expect(res.status).toBe(201);
      expect(connection.query).toHaveBeenCalledTimes(2);
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    test("rolls back and returns 409 for duplicate data", async () => {
      const connection = mockConnection();
      const error = new Error("Duplicate entry");
      error.code = "ER_DUP_ENTRY";
      connection.query.mockRejectedValueOnce(error);

      const res = await as(app, admin).post("/api/books").send(validBook);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("returns 400 for an invalid foreign key", async () => {
      const connection = mockConnection();
      const error = new Error("Invalid foreign key");
      error.code = "ER_NO_REFERENCED_ROW_2";
      connection.query.mockRejectedValueOnce(error);

      const res = await as(app, admin).post("/api/books").send(validBook);

      expect(res.status).toBe(400);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- PUT BOOK ----------

  describe("PUT /api/books/:id", () => {
    test("returns 400 when input is invalid", async () => {
      const res = await as(app, admin)
        .put("/api/books/1")
        .send({ title: "Missing fields" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 404 and rolls back when book does not exist", async () => {
      const connection = mockConnection();
      connection.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await as(app, admin).put("/api/books/99999").send(validBook);

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("updates a book successfully", async () => {
      const connection = mockConnection();
      connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockBookDetail();

      const res = await as(app, admin).put("/api/books/1").send(validBook);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("updates book categories", async () => {
      const connection = mockConnection();

      connection.query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      mockBookDetail();

      const res = await as(app, admin)
        .put("/api/books/1")
        .send({ ...validBook, category_ids: [1, 2] });

      expect(res.status).toBe(200);
      expect(connection.query).toHaveBeenCalledTimes(3);
      expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    test("rolls back when update query fails", async () => {
      const connection = mockConnection();
      const error = new Error("Database error");
      error.code = "ER_DUP_ENTRY";
      connection.query.mockRejectedValueOnce(error);

      const res = await as(app, admin).put("/api/books/1").send(validBook);

      expect(res.status).toBe(409);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- DELETE BOOK ----------

  describe("DELETE /api/books/:id", () => {
    // ลบหนังสือใช้ transaction: ล็อกแถว -> นับประวัติการยืม (ทั้งหมด/ค้างอยู่) -> ลบจริงหรือตั้ง deleted_at
    const locked = [[{ book_id: 1 }]];
    const loanCounts = (total, active) => [[{ total, active }]];

    test("ไม่เคยถูกยืม: ลบจริง (archived=false)", async () => {
      mockConnection();
      conn.query
        .mockResolvedValueOnce(locked)
        .mockResolvedValueOnce(loanCounts(0, 0))
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).delete("/api/books/1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ deleted_book_id: 1, archived: false });
      expect(conn.query.mock.calls[2][0]).toMatch(/DELETE FROM books/);
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    test("เคยถูกยืมและคืนครบแล้ว: ลบแบบเก็บประวัติ (ตั้ง deleted_at ไม่ลบแถว)", async () => {
      mockConnection();
      conn.query
        .mockResolvedValueOnce(locked)
        .mockResolvedValueOnce(loanCounts(4, 0))
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).delete("/api/books/1");

      expect(res.status).toBe(200);
      expect(res.body.data.archived).toBe(true);
      expect(conn.query.mock.calls[2][0]).toMatch(/UPDATE books SET deleted_at = NOW\(\)/);
      expect(conn.query.mock.calls.some((c) => /DELETE FROM books/.test(c[0]))).toBe(false);
    });

    test("ยังมีผู้ยืมค้างอยู่: 409 BOOK_HAS_ACTIVE_LOANS และไม่แก้ข้อมูล", async () => {
      mockConnection();
      conn.query.mockResolvedValueOnce(locked).mockResolvedValueOnce(loanCounts(3, 1));

      const res = await as(app, admin).delete("/api/books/1");

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("BOOK_HAS_ACTIVE_LOANS");
      expect(res.body.success).toBe(false);
      expect(conn.query).toHaveBeenCalledTimes(2);
      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.commit).not.toHaveBeenCalled();
    });

    test("returns 404 when the book does not exist (หรือถูกลบไปแล้ว)", async () => {
      mockConnection();
      conn.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).delete("/api/books/99999");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(conn.rollback).toHaveBeenCalled();
    });

    test("returns 500 และ rollback เมื่อ query ล้มเหลวระหว่างลบ", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      mockConnection();
      conn.query.mockResolvedValueOnce(locked).mockRejectedValueOnce(new Error("Database error"));

      const res = await as(app, admin).delete("/api/books/1");

      expect(res.status).toBe(500);
      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
      log.mockRestore();
    });

    test("returns 500 เมื่อเชื่อมต่อฐานข้อมูลไม่ได้ (ไม่ค้าง)", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.getConnection.mockRejectedValueOnce(new Error("Database error"));

      const res = await as(app, admin).delete("/api/books/1");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  describe("หนังสือที่ถูกลบแบบเก็บประวัติ (soft delete)", () => {
    test("รายการ รายละเอียด และหนังสือของผู้แต่ง กรอง deleted_at IS NULL", async () => {
      mockBookList([]);
      await as(app, admin).get("/api/books");
      expect(pool.query.mock.calls[0][0]).toMatch(/b\.deleted_at IS NULL/);

      pool.query.mockResolvedValueOnce([[]]);
      await as(app, admin).get("/api/books/7");
      expect(pool.query.mock.calls[2][0]).toMatch(/b\.deleted_at IS NULL/);

      pool.query.mockResolvedValueOnce([[{ author_id: 1, name: "A" }]]).mockResolvedValueOnce([[]]);
      await as(app, admin).get("/api/authors/1/books");
      expect(pool.query.mock.calls[4][0]).toMatch(/deleted_at IS NULL/);
    });

    test("แก้ไขหนังสือที่ถูกลบแล้วได้ 404", async () => {
      mockConnection();
      conn.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await as(app, admin).put("/api/books/1").send(validBook);

      expect(res.status).toBe(404);
      expect(conn.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    });
  });

  // ---------- EXTERNAL INFO ----------

  describe("GET /api/books/:id/external-info", () => {
    test("returns 404 when the book does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).get("/api/books/99999/external-info");

      expect(res.status).toBe(404);
      expect(lookupBookByIsbn).not.toHaveBeenCalled();
    });

    test("returns external information for a book", async () => {
      mockBookDetail();
      lookupBookByIsbn.mockResolvedValueOnce({
        description: "A test description",
      });

      const res = await as(app, admin).get("/api/books/1/external-info");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.book.book_id).toBe(1);
      expect(res.body.data.description).toBe("A test description");
      expect(lookupBookByIsbn).toHaveBeenCalledWith(validBook.isbn);
    });

    test("returns 500 when external lookup fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      mockBookDetail();
      lookupBookByIsbn.mockRejectedValueOnce(
        new Error("External API unavailable"),
      );

      const res = await as(app, admin).get("/api/books/1/external-info");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  // ---------- AUTHORS ----------

  describe("GET /api/authors", () => {
    test("returns authors when query succeeds", async () => {
      const authors = [
        {
          author_id: 1,
          name: "Test Author",
          nationality: "Thai",
          birth_year: 2000,
        },
      ];

      pool.query.mockResolvedValueOnce([authors]);

      const res = await as(app, admin).get("/api/authors");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(authors);
    });

    test("returns 500 when query fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await as(app, admin).get("/api/authors");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  describe("POST /api/authors", () => {
    test("returns 400 when name is missing", async () => {
      const res = await as(app, admin)
        .post("/api/authors")
        .send({ nationality: "Thai" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 400 when birth_year is not an integer", async () => {
      const res = await as(app, admin).post("/api/authors").send({
        name: "Test Author",
        birth_year: "invalid",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("creates an author successfully", async () => {
      pool.query.mockResolvedValueOnce([{ insertId: 10 }]);

      const res = await as(app, admin).post("/api/authors").send({
        name: "Test Author",
        nationality: "Thai",
        birth_year: 2000,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.author_id).toBe(10);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test("returns 409 when author data is duplicated", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Duplicate entry");
      error.code = "ER_DUP_ENTRY";
      pool.query.mockRejectedValueOnce(error);

      const res = await as(app, admin)
        .post("/api/authors")
        .send({ name: "Test Author" });

      expect(res.status).toBe(409);
      log.mockRestore();
    });
  });

  describe("GET /api/authors/:id/books", () => {
    test("returns 404 when author does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).get("/api/authors/99999/books");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("returns author and their books", async () => {
      const author = { author_id: 1, name: "Test Author" };
      const books = [{ book_id: 1, title: "Test Book" }];

      pool.query
        .mockResolvedValueOnce([[author]])
        .mockResolvedValueOnce([books]);

      const res = await as(app, admin).get("/api/authors/1/books");

      expect(res.status).toBe(200);
      expect(res.body.data.author).toEqual(author);
      expect(res.body.data.books).toEqual(books);
    });
  });

  // ---------- CATEGORIES ----------

  describe("GET /api/categories", () => {
    test("returns categories when query succeeds", async () => {
      const rows = [{ category_id: 1, name: "Programming" }];

      pool.query.mockResolvedValueOnce([rows]);

      const res = await as(app, admin).get("/api/categories");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(rows);
    });

    test("returns 500 when query fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await as(app, admin).get("/api/categories");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  describe("POST /api/categories", () => {
    test("returns 400 when name is missing", async () => {
      const res = await as(app, admin).post("/api/categories").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("creates a category successfully", async () => {
      pool.query.mockResolvedValueOnce([{ insertId: 5 }]);

      const res = await as(app, admin)
        .post("/api/categories")
        .send({ name: "Programming" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.category_id).toBe(5);
      expect(res.body.data.name).toBe("Programming");
    });

    test("returns 409 when category name is duplicated", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Duplicate entry");
      error.code = "ER_DUP_ENTRY";
      pool.query.mockRejectedValueOnce(error);

      const res = await as(app, admin)
        .post("/api/categories")
        .send({ name: "Programming" });

      expect(res.status).toBe(409);
      log.mockRestore();
    });
  });
});
