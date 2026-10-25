jest.mock("../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../src/services/external-api", () => ({
  lookupBookByIsbn: jest.fn(),
}));

const request = require("supertest");
const app = require("../src/index");
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

  describe("GET /api/books", () => {
    test("returns books when query succeeds", async () => {
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

      pool.query.mockResolvedValueOnce([books]);

      const res = await request(app).get("/api/books");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(books);
    });

    test("returns an empty list when no books exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/api/books");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test("filters books by search query", async () => {
      pool.query.mockResolvedValueOnce([[bookDetail]]);

      const res = await request(app).get("/api/books").query({ q: "Test" });

      expect(res.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE b.title LIKE ? OR a.name LIKE ?"),
        ["%Test%", "%Test%"],
      );
    });

    test("returns 500 when database query fails", async () => {
      const error = new Error("Database unavailable");
      const log = jest.spyOn(console, "error").mockImplementation(() => {});

      pool.query.mockRejectedValueOnce(error);

      const res = await request(app).get("/api/books");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      log.mockRestore();
    });
  });

  // ---------- GET BOOK DETAIL ----------

  describe("GET /api/books/:id", () => {
    test("returns 404 when the book does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/api/books/99999");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("returns book details with categories", async () => {
      mockBookDetail();

      const res = await request(app).get("/api/books/1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.book_id).toBe(1);
      expect(res.body.data.categories).toEqual(categories);
    });

    test("returns 500 when loading book details fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await request(app).get("/api/books/1");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  // ---------- POST BOOK ----------

  describe("POST /api/books", () => {
    test("returns 400 when required book data is missing", async () => {
      const res = await request(app)
        .post("/api/books")
        .send({ title: "Test Book" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("isbn จำเป็นต้องระบุ");
    });

    test("returns 400 when author_id is not an integer", async () => {
      const res = await request(app)
        .post("/api/books")
        .send({
          ...validBook,
          author_id: "invalid",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 400 when published_year is not an integer", async () => {
      const res = await request(app)
        .post("/api/books")
        .send({
          ...validBook,
          published_year: "2025",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("published_year ต้องเป็นจำนวนเต็ม");
    });

    test("returns 400 when price is negative", async () => {
      const res = await request(app)
        .post("/api/books")
        .send({
          ...validBook,
          price: -1,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("price ต้องเป็นตัวเลขที่ไม่ติดลบ");
    });

    test("returns 400 when category_ids is invalid", async () => {
      const res = await request(app)
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

      const res = await request(app).post("/api/books").send(validBook);

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

      const res = await request(app)
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

      const res = await request(app).post("/api/books").send(validBook);

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

      const res = await request(app).post("/api/books").send(validBook);

      expect(res.status).toBe(400);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- PUT BOOK ----------

  describe("PUT /api/books/:id", () => {
    test("returns 400 when input is invalid", async () => {
      const res = await request(app)
        .put("/api/books/1")
        .send({ title: "Missing fields" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 404 and rolls back when book does not exist", async () => {
      const connection = mockConnection();
      connection.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await request(app).put("/api/books/99999").send(validBook);

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("updates a book successfully", async () => {
      const connection = mockConnection();
      connection.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockBookDetail();

      const res = await request(app).put("/api/books/1").send(validBook);

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

      const res = await request(app)
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

      const res = await request(app).put("/api/books/1").send(validBook);

      expect(res.status).toBe(409);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- DELETE BOOK ----------

  describe("DELETE /api/books/:id", () => {
    test("deletes a book successfully", async () => {
      pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app).delete("/api/books/1");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted_book_id).toBe(1);
    });

    test("returns 404 when the book does not exist", async () => {
      pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = await request(app).delete("/api/books/99999");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("returns 500 when delete query fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await request(app).delete("/api/books/1");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  // ---------- EXTERNAL INFO ----------

  describe("GET /api/books/:id/external-info", () => {
    test("returns 404 when the book does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/api/books/99999/external-info");

      expect(res.status).toBe(404);
      expect(lookupBookByIsbn).not.toHaveBeenCalled();
    });

    test("returns external information for a book", async () => {
      mockBookDetail();
      lookupBookByIsbn.mockResolvedValueOnce({
        description: "A test description",
      });

      const res = await request(app).get("/api/books/1/external-info");

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

      const res = await request(app).get("/api/books/1/external-info");

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

      const res = await request(app).get("/api/authors");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(authors);
    });

    test("returns 500 when query fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await request(app).get("/api/authors");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  describe("POST /api/authors", () => {
    test("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/authors")
        .send({ nationality: "Thai" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("returns 400 when birth_year is not an integer", async () => {
      const res = await request(app).post("/api/authors").send({
        name: "Test Author",
        birth_year: "invalid",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("creates an author successfully", async () => {
      pool.query.mockResolvedValueOnce([{ insertId: 10 }]);

      const res = await request(app).post("/api/authors").send({
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

      const res = await request(app)
        .post("/api/authors")
        .send({ name: "Test Author" });

      expect(res.status).toBe(409);
      log.mockRestore();
    });
  });

  describe("GET /api/authors/:id/books", () => {
    test("returns 404 when author does not exist", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/api/authors/99999/books");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test("returns author and their books", async () => {
      const author = { author_id: 1, name: "Test Author" };
      const books = [{ book_id: 1, title: "Test Book" }];

      pool.query
        .mockResolvedValueOnce([[author]])
        .mockResolvedValueOnce([books]);

      const res = await request(app).get("/api/authors/1/books");

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

      const res = await request(app).get("/api/categories");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(rows);
    });

    test("returns 500 when query fails", async () => {
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const res = await request(app).get("/api/categories");

      expect(res.status).toBe(500);
      log.mockRestore();
    });
  });

  describe("POST /api/categories", () => {
    test("returns 400 when name is missing", async () => {
      const res = await request(app).post("/api/categories").send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test("creates a category successfully", async () => {
      pool.query.mockResolvedValueOnce([{ insertId: 5 }]);

      const res = await request(app)
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

      const res = await request(app)
        .post("/api/categories")
        .send({ name: "Programming" });

      expect(res.status).toBe(409);
      log.mockRestore();
    });
  });
});
