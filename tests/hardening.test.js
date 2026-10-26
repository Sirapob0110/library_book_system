// ทดสอบความปลอดภัยและความทนทานของ Book API: header, CORS, รูปแบบ error, ขนาด payload,
// การตรวจข้อมูลด้วย zod, cache ของผู้แต่ง/หมวดหมู่, และ rate limit (Lab 4, 7, 12)
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
const pool = require("../src/db");
const cache = require("../src/cache");

describe("Book API: ความปลอดภัยและ error ที่สม่ำเสมอ (Lab 4)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("ส่ง security header ของ helmet และไม่เปิดเผย X-Powered-By", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: "book-api", status: "ok" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("CORS อนุญาตเฉพาะ origin ของหน้าเว็บ", async () => {
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:5173");
    const evil = await request(app)
      .get("/health")
      .set("Origin", "http://malicious-site.example.com");

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(evil.headers["access-control-allow-origin"]).not.toBe("http://malicious-site.example.com");
  });

  test("preflight ประกาศ method ที่อนุญาตรวมถึง PATCH", async () => {
    const res = await request(app)
      .options("/api/books")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "PATCH");

    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  test("route ที่ไม่มีตอบ 404 รูปแบบมาตรฐาน (ROUTE_NOT_FOUND)", async () => {
    const res = await request(app).get("/api/no-such-route");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "ไม่พบเส้นทางที่เรียก",
      error: "ไม่พบเส้นทางที่เรียก",
      code: "ROUTE_NOT_FOUND",
    });
  });

  test("ข้อมูลเกิน 10KB ตอบ 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await as(app, admin)
      .post("/api/books")
      .send({ title: "x".repeat(15000), isbn: "1", author_id: 1 });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("JSON ที่ผิดรูปแบบตอบ 400 INVALID_JSON", async () => {
    const res = await as(app, admin)
      .post("/api/books")
      .set("Content-Type", "application/json")
      .send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_JSON");
  });

  test("ฐานข้อมูลล่มตอนเปิดการเชื่อมต่อ: ตอบ 500 ทั่วไป ไม่ค้างและไม่เปิดเผยรายละเอียดภายใน", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    pool.getConnection.mockRejectedValue(new Error("secret db password in message"));

    const res = await as(app, admin)
      .post("/api/books")
      .send({ title: "A", isbn: "1", author_id: 1 });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(res.body.success).toBe(false);
    log.mockRestore();
  });
});

describe("Book API: ตรวจข้อมูลด้วย zod (Lab 12)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("ตอบ VALIDATION_ERROR พร้อมรายการ details ราย field", async () => {
    const res = await as(app, admin).post("/api/books").send({ price: -5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe(res.body.details[0].message);
    expect(res.body.error).toBe(res.body.message);

    const fields = res.body.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["title", "isbn", "author_id", "price"]));
  });

  test("type confusion: name เป็น object ถูกปฏิเสธ (Lab 4 ข้อ 3.5)", async () => {
    const res = await as(app, admin).post("/api/authors").send({ name: { $gt: "" } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].field).toBe("name");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("ชื่อยาวเกินกำหนดถูกปฏิเสธ", async () => {
    const res = await as(app, admin).post("/api/categories").send({ name: "ก".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("name");
  });

  test("ตัดช่องว่างหน้าหลังของข้อความก่อนบันทึก", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 7 }]);

    const res = await as(app, admin).post("/api/categories").send({ name: "  นิยาย  " });

    expect(res.status).toBe(201);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["นิยาย"]);
  });

  test("ตัดฟิลด์ที่ไม่รู้จักทิ้ง (กัน mass assignment)", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 7 }]);

    await as(app, admin)
      .post("/api/authors")
      .send({ name: "A", birth_year: 1980, author_id: 999, role: "admin" });

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ["A", null, 1980]);
  });

  test("ปีที่พิมพ์ต้องอยู่ในช่วง 1-9999", async () => {
    const res = await as(app, admin)
      .post("/api/books")
      .send({ title: "A", isbn: "1", author_id: 1, published_year: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe("published_year");
  });

  test("ลงทะเบียน: อีเมลไม่ถูกต้องและรหัสผ่านสั้นถูกระบุรายฟิลด์", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ username: "ok_user", password: "short", name: "Test User", email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field).sort()).toEqual(["email", "password"]);
  });

  test("body ที่ไม่ใช่ object (เช่น array) ถูกปฏิเสธด้วย VALIDATION_ERROR", async () => {
    const res = await as(app, admin).post("/api/categories").send([1, 2, 3]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  test("ความพยายาม SQL injection ในข้อความถูกส่งเป็นพารามิเตอร์ ไม่ถูกต่อเป็น SQL", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 8 }]);
    const payload = "x'); DROP TABLE categories; --";

    const res = await as(app, admin).post("/api/categories").send({ name: payload });

    expect(res.status).toBe(201);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toContain("DROP");
    expect(params).toEqual([payload]);
  });
});

describe("Book API: cache ผู้แต่งและหมวดหมู่ (Lab 7)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test("ผู้แต่ง: ครั้งแรกอ่านจากฐานข้อมูล ครั้งต่อไปอ่านจาก cache (ไม่เรียกฐานข้อมูลซ้ำ)", async () => {
    const authors = [{ author_id: 1, name: "A", nationality: null, birth_year: null }];
    pool.query.mockResolvedValueOnce([authors]);

    const first = await as(app, admin).get("/api/authors");
    const second = await as(app, admin).get("/api/authors");

    expect(first.body.source).toBe("database");
    expect(first.headers["x-cache"]).toBe("MISS");
    expect(second.body.source).toBe("cache");
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.body.data).toEqual(authors);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test("เพิ่มผู้แต่งแล้วล้าง cache รายการผู้แต่ง", async () => {
    pool.query
      .mockResolvedValueOnce([[{ author_id: 1, name: "A" }]])
      .mockResolvedValueOnce([{ insertId: 2 }])
      .mockResolvedValueOnce([[{ author_id: 1, name: "A" }, { author_id: 2, name: "B" }]]);

    await as(app, admin).get("/api/authors");
    await as(app, admin).post("/api/authors").send({ name: "B" });
    const after = await as(app, admin).get("/api/authors");

    expect(after.body.source).toBe("database");
    expect(after.body.data).toHaveLength(2);
  });

  test("หมวดหมู่: cache แล้วล้างเมื่อเพิ่มหมวดหมู่", async () => {
    pool.query
      .mockResolvedValueOnce([[{ category_id: 1, name: "X" }]])
      .mockResolvedValueOnce([{ insertId: 2 }])
      .mockResolvedValueOnce([[{ category_id: 1, name: "X" }, { category_id: 2, name: "Y" }]]);

    const first = await as(app, admin).get("/api/categories");
    const hit = await as(app, admin).get("/api/categories");
    await as(app, admin).post("/api/categories").send({ name: "Y" });
    const after = await as(app, admin).get("/api/categories");

    expect(first.body.source).toBe("database");
    expect(hit.body.source).toBe("cache");
    expect(after.body.source).toBe("database");
    expect(after.body.data).toHaveLength(2);
  });

  test("ผู้ใช้ที่ไม่ได้เข้าสู่ระบบไม่ได้ข้อมูลจาก cache (ยังต้องมี token)", async () => {
    pool.query.mockResolvedValue([[{ author_id: 1, name: "A" }]]);
    await as(app, admin).get("/api/authors");

    const res = await request(app).get("/api/authors");

    expect(res.status).toBe(401);
  });

  test("เพิ่ม/แก้ไข/ลบหนังสือล้าง cache รายการหนังสือ (prefix books:)", async () => {
    const invalidate = jest.spyOn(cache, "invalidate");
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(conn);
    const book = { title: "T", isbn: "1", author_id: 1 };
    const detail = { book_id: 5, ...book };

    conn.query.mockResolvedValueOnce([{ insertId: 5 }]);
    pool.query.mockResolvedValueOnce([[detail]]).mockResolvedValueOnce([[]]);
    await as(app, admin).post("/api/books").send(book);

    conn.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    pool.query.mockResolvedValueOnce([[detail]]).mockResolvedValueOnce([[]]);
    await as(app, admin).put("/api/books/5").send(book);

    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    await as(app, admin).delete("/api/books/5");

    const prefixes = invalidate.mock.calls.map((c) => c[0]);
    expect(prefixes.filter((p) => p === "books:")).toHaveLength(3);
    invalidate.mockRestore();
  });
});

describe("Book API: จำกัดจำนวนคำขอ (Lab 12)", () => {
  // โหลด app ใหม่ในพื้นที่แยก พร้อมตั้งโควตาต่ำ เพื่อไม่ให้กระทบเทสต์อื่น
  function freshApp(env) {
    let isolated;
    let db;

    Object.assign(process.env, env);
    jest.isolateModules(() => {
      db = require("../src/db");
      db.query.mockResolvedValue([[]]);
      isolated = require("../src/index");
    });
    Object.keys(env).forEach((key) => delete process.env[key]);

    return { isolated, db };
  }

  test("login ผิดเกินโควตาตอบ 429 พร้อม header RateLimit และ code TOO_MANY_REQUESTS", async () => {
    const { isolated } = freshApp({ AUTH_RATE_LIMIT_MAX: "5" });
    const attempt = () =>
      request(isolated).post("/api/auth/login").send({ username: "admin", password: "wrong" });

    const statuses = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await attempt()).status);

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);

    const blocked = await attempt();
    expect(blocked.body.code).toBe("TOO_MANY_REQUESTS");
    expect(blocked.body.success).toBe(false);
    expect(blocked.headers.ratelimit).toMatch(/limit=5.*remaining=0/);
    expect(blocked.headers["ratelimit-policy"]).toBe("5;w=900");
    expect(blocked.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  test("login ที่สำเร็จไม่นับโควตา (นับเฉพาะครั้งที่ล้มเหลว)", async () => {
    const bcrypt = require("bcryptjs");
    const { isolated, db } = freshApp({ AUTH_RATE_LIMIT_MAX: "2" });
    const hash = bcrypt.hashSync("Right@1234", 4);
    db.query.mockResolvedValue([
      [{ user_id: 1, username: "u", password_hash: hash, role: "user", member_id: 1, name: "U" }],
    ]);

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await request(isolated).post("/api/auth/login").send({ username: "u", password: "Right@1234" }))
          .status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  test("โควตา login แยกจากโควตาทั่วไป: login ถูกบล็อกแล้ว route อื่นยังใช้ได้", async () => {
    const { isolated } = freshApp({ AUTH_RATE_LIMIT_MAX: "1" });
    const bad = () =>
      request(isolated).post("/api/auth/login").send({ username: "a", password: "b" });

    await bad();
    expect((await bad()).status).toBe(429);

    const other = await request(isolated).get("/api/books");
    expect(other.status).toBe(401);
  });

  test("โควตาทั่วไปเกินแล้วทุก route ตอบ 429 (ยกเว้น /health)", async () => {
    const { isolated } = freshApp({ RATE_LIMIT_MAX: "3" });
    const statuses = [];

    for (let i = 0; i < 5; i += 1) statuses.push((await request(isolated).get("/api/books")).status);

    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    expect((await request(isolated).get("/health")).status).toBe(200);
  });

  test("สมัครสมาชิกถี่เกินโควตาตอบ 429", async () => {
    const { isolated } = freshApp({ REGISTER_RATE_LIMIT_MAX: "2" });
    const register = () => request(isolated).post("/api/auth/register").send({});

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await register()).status);

    expect(statuses).toEqual([400, 400, 429]);
  });

  test("ค่าโควตาที่ไม่ใช่จำนวนเต็มบวกถูกละเลย (ใช้ค่าเริ่มต้น)", async () => {
    const { isolated } = freshApp({ AUTH_RATE_LIMIT_MAX: "abc" });
    const res = await request(isolated).post("/api/auth/login").send({ username: "a", password: "b" });

    expect(res.status).toBe(401);
  });
});
