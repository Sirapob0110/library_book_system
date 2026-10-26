// ทดสอบ GraphQL endpoint ของ Book API (Lab 2): สิทธิ์ การตรวจคำถาม query/mutation การรวม query (N+1) และการซ่อนข้อผิดพลาดภายใน
jest.mock("../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../src/services/external-api", () => ({
  lookupBookByIsbn: jest.fn(),
}));

const request = require("supertest");
const { parse } = require("graphql");
const { as, admin, user } = require("./helpers/auth");
const app = require("../src/index");
const pool = require("../src/db");
const { queryDepth, MAX_DEPTH } = require("../src/graphql");

const gql = (who, query, variables, operationName) =>
  as(app, who).post("/graphql").send({ query, variables, operationName });

const bookRow = (id, authorId = 1, extra = {}) => ({
  book_id: id,
  title: `Book ${id}`,
  isbn: `978000000000${id}`,
  published_year: 2020,
  price: "250.00",
  total_copies: 3,
  available_copies: 2,
  author_id: authorId,
  author_name: `Author ${authorId}`,
  ...extra,
});

// จำลองฐานข้อมูลตามข้อความ SQL แทนการเรียงลำดับ mock
function mockDb(routes) {
  pool.query.mockImplementation(async (sql, params) => {
    for (const [pattern, result] of routes) {
      if (pattern.test(sql)) return typeof result === "function" ? result(sql, params) : result;
    }
    throw new Error(`ไม่ได้จำลอง SQL: ${sql.slice(0, 60)}`);
  });
}

describe("GraphQL", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe("สิทธิ์และการตรวจคำขอ", () => {
    test("ไม่มี token ตอบ 401", async () => {
      const res = await request(app).post("/graphql").send({ query: "{ categories { id } }" });

      expect(res.status).toBe(401);
    });

    test.each([
      [{}, "ไม่มี query"],
      [{ query: "   " }, "query ว่าง"],
      [{ query: 123 }, "query ไม่ใช่ข้อความ"],
      [{ query: "{ categories { id } }", variables: [1] }, "variables เป็น array"],
      [{ query: "{ categories { id } }", variables: "x" }, "variables เป็นข้อความ"],
    ])("คำขอไม่ถูกต้อง (%j) ตอบ 400 BAD_REQUEST: %s", async (body) => {
      const res = await as(app, admin).post("/graphql").send(body);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("BAD_REQUEST");
    });

    test("ไวยากรณ์ผิดตอบ 400 GRAPHQL_PARSE_FAILED", async () => {
      const res = await gql(admin, "{ books { ");

      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("GRAPHQL_PARSE_FAILED");
    });

    test("ฟิลด์ที่ไม่มีในสคีมาตอบ 400 GRAPHQL_VALIDATION_FAILED", async () => {
      const res = await gql(admin, "{ nope }");

      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("คำถามซ้อนลึกเกินกำหนดถูกปฏิเสธก่อนรัน", async () => {
      const res = await gql(
        admin,
        "{ books { items { author { books { author { books { title } } } } } } }",
      );

      expect(res.status).toBe(400);
      expect(res.body.errors[0].extensions.code).toBe("QUERY_TOO_DEEP");
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe("queryDepth", () => {
    const depth = (q) => queryDepth(parse(q));

    test("นับชั้นของ field", () => {
      expect(depth("{ categories { id } }")).toBe(2);
      expect(depth("{ books { items { author { name } } } }")).toBe(4);
    });

    test("นับรวม inline fragment และ fragment spread", () => {
      expect(depth("{ books { items { ... on Book { author { name } } } } }")).toBe(4);
      expect(
        depth("{ books { items { ...F } } } fragment F on Book { author { books { title } } }"),
      ).toBe(5);
    });

    test("fragment ที่ไม่มีอยู่ไม่ทำให้พัง และ fragment วนซ้ำไม่ทำให้ลูปไม่รู้จบ", () => {
      expect(depth("{ books { items { ...Missing } } }")).toBe(2);
      expect(depth("{ books { items { ...A } } } fragment A on Book { author { ...A } }")).toBe(3);
    });

    test("ขีดจำกัดคือ 5 ชั้น", () => {
      expect(MAX_DEPTH).toBe(5);
    });
  });

  describe("Query", () => {
    test("books: เลือกเฉพาะฟิลด์ที่ต้องการ พร้อม pagination", async () => {
      mockDb([
        [/COUNT\(\*\)/, [[{ total: 7 }]]],
        [/FROM books b/, [[bookRow(1), bookRow(2)]]],
      ]);

      const res = await gql(user, "{ books(limit: 2) { items { id title } pagination { total totalPages } } }");

      expect(res.status).toBe(200);
      expect(res.body.data.books.items).toEqual([
        { id: "1", title: "Book 1" },
        { id: "2", title: "Book 2" },
      ]);
      expect(res.body.data.books.pagination).toEqual({ total: 7, totalPages: 4 });
    });

    test("books: แปลง argument เป็นตัวกรอง การเรียง และการแบ่งหน้าแบบ parameterized", async () => {
      mockDb([
        [/COUNT\(\*\)/, [[{ total: 0 }]]],
        [/FROM books b/, [[]]],
      ]);

      await gql(
        user,
        `query($s: String) {
          books(search: $s, authorId: 2, categoryId: 3, availableOnly: true,
                sortBy: PRICE, order: DESC, page: 2, limit: 5) { items { id } }
        }`,
        { s: "Harry" },
      );

      const [sql, params] = pool.query.mock.calls.at(-1);
      expect(sql).toContain("ORDER BY b.price DESC");
      expect(sql).toContain("b.available_copies > 0");
      expect(params).toEqual(["%Harry%", "%Harry%", 2, 3, 5, 5]);
    });

    test("books: author และ categories ของทุกเล่มถูกรวมเป็น query เดียว (ไม่เกิด N+1)", async () => {
      mockDb([
        [/COUNT\(\*\)/, [[{ total: 3 }]]],
        [/FROM books b/, [[bookRow(1, 1), bookRow(2, 2), bookRow(3, 1)]]],
        [
          /FROM authors WHERE author_id IN/,
          [[{ author_id: 1, name: "A1" }, { author_id: 2, name: "A2" }]],
        ],
        [
          /FROM book_categories bc JOIN categories/,
          [[{ book_id: 1, category_id: 5, name: "C5" }, { book_id: 3, category_id: 6, name: "C6" }]],
        ],
      ]);

      const res = await gql(user, "{ books { items { title author { name } categories { name } } } }");

      expect(res.body.data.books.items).toEqual([
        { title: "Book 1", author: { name: "A1" }, categories: [{ name: "C5" }] },
        { title: "Book 2", author: { name: "A2" }, categories: [] },
        { title: "Book 3", author: { name: "A1" }, categories: [{ name: "C6" }] },
      ]);

      const sqls = pool.query.mock.calls.map(([sql]) => sql);
      expect(sqls.filter((s) => /FROM authors WHERE/.test(s))).toHaveLength(1);
      expect(sqls.filter((s) => /FROM book_categories bc/.test(s))).toHaveLength(1);
      // ไอดีผู้แต่งที่ซ้ำกัน (1 สองเล่ม) ถูกรวมเป็นค่าเดียว
      const authorParams = pool.query.mock.calls.find(([s]) => /FROM authors WHERE/.test(s))[1];
      expect(authorParams).toEqual([[1, 2]]);
    });

    test("book(id): พบ และไม่พบได้ null", async () => {
      mockDb([
        [/WHERE b.book_id = \?/, (sql, params) => [params[0] === "1" ? [bookRow(1)] : []]],
        [/WHERE bc\.book_id = \?/, [[]]],
        [/FROM authors WHERE author_id IN/, [[{ author_id: 1, name: "A1", nationality: "Thai", birth_year: 1970 }]]],
        [/WHERE bc.book_id IN/, [[]]],
      ]);

      const found = await gql(user, '{ book(id: "1") { title price availableCopies author { name nationality birthYear } } }');
      const missing = await gql(user, '{ book(id: "99") { title } }');

      expect(found.body.data.book).toEqual({
        title: "Book 1",
        price: 250,
        availableCopies: 2,
        author: { name: "A1", nationality: "Thai", birthYear: 1970 },
      });
      expect(missing.body.data.book).toBeNull();
    });

    test("book: ราคาที่เป็น null ตอบ null", async () => {
      mockDb([
        [/WHERE b.book_id = \?/, [[bookRow(1, 1, { price: null, published_year: null })]]],
        [/WHERE bc\.book_id = \?/, [[]]],
      ]);

      const res = await gql(user, '{ book(id: "1") { price publishedYear } }');

      expect(res.body.data.book).toEqual({ price: null, publishedYear: null });
    });

    test("authors: พร้อมหนังสือของแต่ละคนแบบรวม query", async () => {
      mockDb([
        [/FROM authors ORDER BY name/, [[{ author_id: 1, name: "A1" }, { author_id: 2, name: "A2", nationality: "UK", birth_year: 1900 }]]],
        [
          /FROM books WHERE author_id IN/,
          [[bookRow(1, 1), bookRow(2, 1), bookRow(3, 2)]],
        ],
      ]);

      const res = await gql(user, "{ authors { name nationality birthYear books { title } } }");

      expect(res.body.data.authors).toEqual([
        { name: "A1", nationality: null, birthYear: null, books: [{ title: "Book 1" }, { title: "Book 2" }] },
        { name: "A2", nationality: "UK", birthYear: 1900, books: [{ title: "Book 3" }] },
      ]);
      expect(pool.query.mock.calls.filter(([s]) => /FROM books WHERE author_id IN/.test(s))).toHaveLength(1);
    });

    test("author(id): พบและไม่พบ (null)", async () => {
      mockDb([
        [/FROM authors WHERE author_id IN/, (sql, params) => [params[0].includes(1) ? [{ author_id: 1, name: "A1" }] : []]],
      ]);

      const found = await gql(user, '{ author(id: "1") { name } }');
      const missing = await gql(user, '{ author(id: "9") { name } }');

      expect(found.body.data.author).toEqual({ name: "A1" });
      expect(missing.body.data.author).toBeNull();
    });

    test("categories", async () => {
      mockDb([[/FROM categories ORDER BY name/, [[{ category_id: 1, name: "X" }]]]]);

      const res = await gql(user, "{ categories { id name } }");

      expect(res.body.data.categories).toEqual([{ id: "1", name: "X" }]);
    });

    test("operationName เลือกการทำงานเมื่อมีหลาย operation", async () => {
      mockDb([[/FROM categories ORDER BY name/, [[{ category_id: 1, name: "X" }]]]]);

      const res = await gql(
        user,
        "query A { categories { name } } query B { categories { id } }",
        undefined,
        "B",
      );

      expect(res.body.data.categories).toEqual([{ id: "1" }]);
    });

    test("ฐานข้อมูลล่ม: ตอบ INTERNAL_SERVER_ERROR ทั่วไป ไม่เปิดเผยรายละเอียด", async () => {
      pool.query.mockRejectedValue(new Error("secret: connect ECONNREFUSED 10.0.0.5"));

      const res = await gql(user, "{ categories { id } }");

      expect(res.status).toBe(200);
      expect(res.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(res.body)).not.toContain("secret");
    });
  });

  describe("Mutation", () => {
    const input = '{ title: "T", isbn: "9780000000009", authorId: 1, categoryIds: [1] }';

    function mockConnection() {
      const conn = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      pool.getConnection.mockResolvedValue(conn);
      return conn;
    }

    const detailRoutes = [
      [/WHERE b.book_id = \?/, [[bookRow(10, 1, { title: "T" })]]],
      [/WHERE bc\.book_id = \?/, [[]]],
      [/WHERE bc.book_id IN/, [[{ book_id: 10, category_id: 1, name: "C1" }]]],
    ];

    test.each([
      ["createBook", `mutation { createBook(input: ${input}) { id } }`],
      ["updateBook", `mutation { updateBook(id: "1", input: ${input}) { id } }`],
      ["deleteBook", 'mutation { deleteBook(id: "1") { success } }'],
      ["createAuthor", 'mutation { createAuthor(input: { name: "A" }) { id } }'],
      ["createCategory", 'mutation { createCategory(name: "X") { id } }'],
    ])("%s: user ทั่วไปถูกปฏิเสธ (FORBIDDEN) และไม่แตะฐานข้อมูล", async (_name, query) => {
      const res = await gql(user, query);

      expect(res.body.errors[0].extensions.code).toBe("FORBIDDEN");
      expect(pool.query).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });

    test("createBook: admin เพิ่มได้ และได้ข้อมูลกลับตามฟิลด์ที่ขอ", async () => {
      const conn = mockConnection();
      conn.query.mockResolvedValueOnce([{ insertId: 10 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockDb(detailRoutes);

      const res = await gql(admin, `mutation { createBook(input: ${input}) { id title categories { name } } }`);

      expect(res.body.data.createBook).toEqual({ id: "10", title: "T", categories: [{ name: "C1" }] });
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.query.mock.calls[0][1]).toEqual(["T", "9780000000009", 1, null, 0]);
    });

    test("createBook: ข้อมูลไม่ถูกต้องใช้กฎเดียวกับ REST (VALIDATION_ERROR พร้อม details)", async () => {
      const res = await gql(admin, 'mutation { createBook(input: { title: "", isbn: "1", authorId: 1 }) { id } }');

      expect(res.body.errors[0].extensions.code).toBe("VALIDATION_ERROR");
      expect(res.body.errors[0].extensions.details[0].field).toBe("title");
      expect(pool.getConnection).not.toHaveBeenCalled();
    });

    test("createBook: ISBN ซ้ำ -> CONFLICT และ authorId ไม่มีอยู่ -> BAD_REFERENCE", async () => {
      const conn = mockConnection();
      conn.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
      const dup = await gql(admin, `mutation { createBook(input: ${input}) { id } }`);

      conn.query.mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "ER_NO_REFERENCED_ROW_2" }));
      const ref = await gql(admin, `mutation { createBook(input: ${input}) { id } }`);

      expect(dup.body.errors[0].extensions.code).toBe("CONFLICT");
      expect(ref.body.errors[0].extensions.code).toBe("BAD_REFERENCE");
      expect(conn.rollback).toHaveBeenCalledTimes(2);
    });

    test("updateBook: แก้ไขได้ และไม่พบตอบ NOT_FOUND", async () => {
      const conn = mockConnection();
      conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
      mockDb(detailRoutes);

      const ok = await gql(admin, `mutation { updateBook(id: "10", input: ${input}) { id title } }`);
      expect(ok.body.data.updateBook).toEqual({ id: "10", title: "T" });

      conn.query.mockReset();
      conn.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const missing = await gql(admin, `mutation { updateBook(id: "99", input: ${input}) { id } }`);
      expect(missing.body.errors[0].extensions.code).toBe("NOT_FOUND");
    });

    test("deleteBook: สำเร็จ และลบซ้ำได้ success:false (ไม่ใช่ error)", async () => {
      pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 0 }]);

      const first = await gql(admin, 'mutation { deleteBook(id: "5") { success message } }');
      const second = await gql(admin, 'mutation { deleteBook(id: "5") { success message } }');

      expect(first.body.data.deleteBook).toEqual({ success: true, message: "ลบหนังสือ ID 5 แล้ว" });
      expect(second.body.errors).toBeUndefined();
      expect(second.body.data.deleteBook).toEqual({ success: false, message: "ไม่พบหนังสือ ID 5" });
    });

    test("createAuthor และ createCategory", async () => {
      pool.query
        .mockResolvedValueOnce([{ insertId: 4 }])
        .mockResolvedValueOnce([{ insertId: 6 }]);

      const author = await gql(
        admin,
        'mutation { createAuthor(input: { name: " Orwell ", nationality: "UK", birthYear: 1903 }) { id name birthYear } }',
      );
      const category = await gql(admin, 'mutation { createCategory(name: "Dystopia") { id name } }');

      expect(author.body.data.createAuthor).toEqual({ id: "4", name: "Orwell", birthYear: 1903 });
      expect(category.body.data.createCategory).toEqual({ id: "6", name: "Dystopia" });
    });

    test("createAuthor: ชื่อว่างถูกปฏิเสธ", async () => {
      const res = await gql(admin, 'mutation { createAuthor(input: { name: "" }) { id } }');

      expect(res.body.errors[0].extensions.code).toBe("VALIDATION_ERROR");
    });

    test("ล้าง cache รายการผู้แต่งและหมวดหมู่หลังเพิ่ม (อ่านครั้งต่อไปไปที่ฐานข้อมูล)", async () => {
      mockDb([
        [/FROM categories ORDER BY name/, [[{ category_id: 1, name: "X" }]]],
        [/INSERT INTO categories/, [{ insertId: 2 }]],
      ]);

      await gql(user, "{ categories { id } }");
      await gql(user, "{ categories { id } }");
      expect(pool.query.mock.calls.filter(([s]) => /FROM categories ORDER BY/.test(s))).toHaveLength(1);

      await gql(admin, 'mutation { createCategory(name: "Y") { id } }');
      await gql(user, "{ categories { id } }");
      expect(pool.query.mock.calls.filter(([s]) => /FROM categories ORDER BY/.test(s))).toHaveLength(2);
    });
  });

  describe("loader", () => {
    test("ถ้า query ของ loader ล้มเหลว ทุกฟิลด์ที่รอตอบ error และไม่เปิดเผยรายละเอียด", async () => {
      mockDb([
        [/COUNT\(\*\)/, [[{ total: 2 }]]],
        [/FROM books b/, [[bookRow(1, 1), bookRow(2, 2)]]],
        [/FROM authors WHERE author_id IN/, () => { throw new Error("boom internal"); }],
      ]);

      const res = await gql(user, "{ books { items { title author { name } } } }");

      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain("boom internal");
    });
  });
});
