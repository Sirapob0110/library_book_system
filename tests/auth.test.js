// tests/auth.test.js - ทดสอบ register / login / me และสิทธิ์ตามบทบาทของ Book API
jest.mock("../src/db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

jest.mock("../src/services/external-api", () => ({
  lookupBookByIsbn: jest.fn(),
}));

const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { as, admin, user, tokenOf } = require("./helpers/auth");
const app = require("../src/index");
const pool = require("../src/db");

const SECRET = process.env.JWT_SECRET;

describe("Authentication (Book API)", () => {
  let conn;

  beforeEach(() => {
    jest.resetAllMocks();
    conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(conn);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const validRegister = {
    username: "newuser",
    password: "Passw0rd!",
    name: "New User",
    email: "new@example.com",
    phone: "0812345678",
  };

  describe("POST /api/auth/register", () => {
    test("สมัครสำเร็จ: สร้างสมาชิกและผู้ใช้บทบาท user ในธุรกรรมเดียว", async () => {
      conn.query
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([{ insertId: 5 }]);

      const res = await request(app).post("/api/auth/register").send(validRegister);

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        user_id: 5,
        username: "newuser",
        role: "user",
        member_id: 7,
      });
      expect(conn.beginTransaction).toHaveBeenCalled();
      expect(conn.commit).toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
      // ไม่ส่งรหัสผ่านหรือ hash กลับไปในผลลัพธ์
      expect(JSON.stringify(res.body)).not.toMatch(/Passw0rd|\$2[aby]\$/);
    });

    test("เก็บรหัสผ่านเป็น bcrypt hash ไม่ใช่ข้อความจริง", async () => {
      conn.query
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([{ insertId: 5 }]);

      await request(app).post("/api/auth/register").send(validRegister);

      const [, params] = conn.query.mock.calls[1];
      expect(params[1]).not.toBe(validRegister.password);
      expect(await bcrypt.compare(validRegister.password, params[1])).toBe(true);
    });

    test("ไม่ยอมให้ผู้สมัครกำหนดบทบาทเอง (ส่ง role: admin มาก็ได้ user)", async () => {
      conn.query
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([{ insertId: 5 }]);

      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, role: "admin" });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe("user");
      const [sql] = conn.query.mock.calls[1];
      expect(sql).toContain("'user'");
      expect(sql).not.toContain("admin");
    });

    test.each([
      ["username สั้นเกินไป", { username: "ab" }],
      ["username มีอักขระที่ไม่อนุญาต", { username: "a b!" }],
      ["password สั้นกว่า 8 ตัวอักษร", { password: "short" }],
      ["password ยาวเกิน 72 ตัวอักษร", { password: "x".repeat(73) }],
      ["ชื่อสั้นเกินไป", { name: "A" }],
      ["อีเมลไม่ถูกต้อง", { email: "abc" }],
      ["phone ไม่ใช่ข้อความ", { phone: 12345 }],
    ])("400: %s", async (_label, patch) => {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ ...validRegister, ...patch });

      expect(res.status).toBe(400);
      expect(pool.getConnection).not.toHaveBeenCalled();
    });

    test("400 เมื่อไม่ส่งข้อมูลเลย", async () => {
      const res = await request(app).post("/api/auth/register");
      expect(res.status).toBe(400);
    });

    test("409 และ rollback เมื่อ username หรืออีเมลซ้ำ", async () => {
      conn.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));

      const res = await request(app).post("/api/auth/register").send(validRegister);

      expect(res.status).toBe(409);
      expect(conn.rollback).toHaveBeenCalled();
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalled();
    });

    test("500 และ rollback เมื่อฐานข้อมูลผิดพลาด", async () => {
      conn.query.mockRejectedValueOnce(new Error("db down"));

      const res = await request(app).post("/api/auth/register").send(validRegister);

      expect(res.status).toBe(500);
      expect(conn.rollback).toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/login", () => {
    const row = (password) => ({
      user_id: 2,
      username: "somchai",
      password_hash: bcrypt.hashSync(password, 4),
      role: "user",
      member_id: 1,
      name: "สมชาย ใจดี",
    });

    test("เข้าสู่ระบบสำเร็จ: ได้ token ที่มีบทบาทและ member_id ถูกต้อง", async () => {
      pool.query.mockResolvedValueOnce([[row("User@1234")]]);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "somchai", password: "User@1234" });

      expect(res.status).toBe(200);
      expect(res.body.data.user).toEqual({
        user_id: 2,
        username: "somchai",
        role: "user",
        member_id: 1,
        name: "สมชาย ใจดี",
      });

      const payload = jwt.verify(res.body.data.token, SECRET);
      expect(payload).toMatchObject({ sub: 2, username: "somchai", role: "user", member_id: 1 });
      expect(payload.exp).toBeGreaterThan(payload.iat);
      // ใน token และผลลัพธ์ต้องไม่มี hash ของรหัสผ่าน
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash|\$2[aby]\$/);
    });

    test("401 เมื่อรหัสผ่านผิด", async () => {
      pool.query.mockResolvedValueOnce([[row("User@1234")]]);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "somchai", password: "wrong-password" });

      expect(res.status).toBe(401);
      expect(res.body.data).toBeUndefined();
    });

    test("401 เมื่อไม่พบ username (ข้อความเหมือนรหัสผ่านผิด ไม่บอกว่ามีผู้ใช้นี้หรือไม่)", async () => {
      pool.query.mockResolvedValueOnce([[row("User@1234")]]).mockResolvedValueOnce([[]]);

      const wrongPw = await request(app)
        .post("/api/auth/login")
        .send({ username: "somchai", password: "nope" });
      const noUser = await request(app)
        .post("/api/auth/login")
        .send({ username: "ghost", password: "nope" });

      expect(noUser.status).toBe(401);
      expect(noUser.body.message).toBe(wrongPw.body.message);
    });

    test.each([
      ["ไม่ส่งข้อมูล", {}],
      ["ไม่ส่ง password", { username: "somchai" }],
      ["ไม่ส่ง username", { password: "x" }],
      ["ชนิดข้อมูลผิด", { username: { $ne: "" }, password: { $ne: "" } }],
    ])("400: %s", async (_label, body) => {
      const res = await request(app).post("/api/auth/login").send(body);

      expect(res.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("500 เมื่อฐานข้อมูลผิดพลาด", async () => {
      pool.query.mockRejectedValueOnce(new Error("db down"));

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "somchai", password: "User@1234" });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/auth/me และการตรวจ token", () => {
    test("คืนข้อมูลผู้ใช้จาก token", async () => {
      const res = await as(app, user).get("/api/auth/me");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        user_id: 2,
        username: "somchai",
        role: "user",
        member_id: 1,
      });
    });

    test.each([
      ["ไม่แนบ token", undefined],
      ["ไม่ใช่รูปแบบ Bearer", "Basic abc"],
      ["token ที่ไม่ใช่ JWT", "Bearer not-a-jwt"],
      ["token ที่ลงลายเซ็นด้วยความลับอื่น (ปลอมบทบาท admin)", `Bearer ${jwt.sign({ sub: 9, role: "admin" }, "attacker-secret")}`],
    ])("401: %s", async (_label, header) => {
      const req = request(app).get("/api/auth/me");
      const res = await (header ? req.set("Authorization", header) : req);

      expect(res.status).toBe(401);
    });

    test("401 เมื่อ token หมดอายุ พร้อมข้อความให้เข้าสู่ระบบใหม่", async () => {
      const expired = jwt.sign({ sub: 2, role: "user" }, SECRET, { expiresIn: -10 });

      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("หมดอายุ");
    });
  });

  describe("สิทธิ์ตามบทบาทของ Book API", () => {
    const readRoutes = [
      "/api/books",
      "/api/books/1",
      "/api/books/1/external-info",
      "/api/authors",
      "/api/authors/1/books",
      "/api/categories",
    ];
    const adminRoutes = [
      ["post", "/api/books"],
      ["put", "/api/books/1"],
      ["delete", "/api/books/1"],
      ["post", "/api/authors"],
      ["post", "/api/categories"],
    ];

    test.each(readRoutes)("GET %s: 401 เมื่อไม่ได้เข้าสู่ระบบ", async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    test.each(readRoutes)("GET %s: user ผ่านการตรวจสิทธิ์ (ไม่ใช่ 401/403)", async (url) => {
      pool.query.mockResolvedValue([[]]);
      const res = await as(app, user).get(url);
      expect([401, 403]).not.toContain(res.status);
    });

    test.each(adminRoutes)("%s %s: 401 เมื่อไม่ได้เข้าสู่ระบบ", async (method, url) => {
      const res = await request(app)[method](url).send({});
      expect(res.status).toBe(401);
    });

    test.each(adminRoutes)("%s %s: 403 เมื่อเป็น user และไม่แตะฐานข้อมูล", async (method, url) => {
      const res = await as(app, user)[method](url).send({});

      expect(res.status).toBe(403);
      expect(pool.query).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });

    test.each(adminRoutes)("%s %s: admin ผ่านการตรวจสิทธิ์ (ไม่ใช่ 401/403)", async (method, url) => {
      pool.query.mockResolvedValue([[]]);
      const res = await as(app, admin)[method](url).send({});
      expect([401, 403]).not.toContain(res.status);
    });

    test("token ของ user ที่แก้ role เป็น admin โดยไม่มีความลับ ใช้ไม่ได้", async () => {
      const [h, , s] = tokenOf(user).split(".");
      const forged = Buffer.from(JSON.stringify({ sub: 2, role: "admin", member_id: 1 })).toString("base64url");

      const res = await request(app)
        .post("/api/authors")
        .set("Authorization", `Bearer ${h}.${forged}.${s}`)
        .send({ name: "X" });

      expect(res.status).toBe(401);
    });
  });
});
