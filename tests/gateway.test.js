// ทดสอบ API Gateway (Lab 13): ตรวจ token, เลือกบริการปลายทาง, ส่งต่อคำขอ/คำตอบ และตอบ 503 เมื่อบริการล่ม
jest.mock("axios");

const axios = require("axios");
const request = require("supertest");
const { tokenOf, admin, user } = require("./helpers/auth");
const app = require("../src/gateway/index");

const BOOK = "http://localhost:3000";
const CIRC = "http://localhost:3001";
const bearer = (who) => `Bearer ${tokenOf(who)}`;
const upstream = (status, data, headers = {}) => ({ status, data, headers });

describe("API Gateway", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe("การตรวจ token ที่ Gateway", () => {
    test.each([
      ["/api/books"],
      ["/api/authors"],
      ["/api/categories"],
      ["/api/members"],
      ["/api/loans/overdue"],
      ["/api/auth/me"],
    ])("%s ไม่มี token ตอบ 401 และไม่เรียกบริการปลายทาง", async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(401);
      expect(axios.request).not.toHaveBeenCalled();
    });

    test("token ที่ไม่ถูกต้องตอบ 401", async () => {
      const res = await request(app).get("/api/books").set("Authorization", "Bearer garbage");

      expect(res.status).toBe(401);
      expect(axios.request).not.toHaveBeenCalled();
    });

    test("login และสมัครสมาชิกเรียกได้โดยไม่ต้องมี token", async () => {
      axios.request.mockResolvedValue(upstream(200, { success: true, data: { token: "t" } }));

      const login = await request(app).post("/api/auth/login").send({ username: "a", password: "b" });
      const register = await request(app).post("/api/auth/register").send({ username: "a" });

      expect(login.status).toBe(200);
      expect(register.status).toBe(200);
      expect(axios.request).toHaveBeenCalledTimes(2);
    });
  });

  describe("การส่งต่อคำขอ", () => {
    test("เส้นทางหนังสือ ผู้แต่ง หมวดหมู่ และ auth ไป Book API", async () => {
      axios.request.mockResolvedValue(upstream(200, { success: true, data: [] }));

      for (const path of ["/api/books", "/api/authors", "/api/categories", "/api/auth/me"]) {
        await request(app).get(path).set("Authorization", bearer(admin));
      }

      const urls = axios.request.mock.calls.map(([config]) => config.url);
      expect(urls).toEqual([
        `${BOOK}/api/books`,
        `${BOOK}/api/authors`,
        `${BOOK}/api/categories`,
        `${BOOK}/api/auth/me`,
      ]);
    });

    test("เส้นทางสมาชิกและการยืมไป Circulation Service", async () => {
      axios.request.mockResolvedValue(upstream(200, { data: [] }));

      await request(app).get("/api/members").set("Authorization", bearer(admin));
      await request(app).get("/api/members/1/loans").set("Authorization", bearer(user));
      await request(app).get("/api/loans/overdue").set("Authorization", bearer(admin));

      const urls = axios.request.mock.calls.map(([config]) => config.url);
      expect(urls).toEqual([
        `${CIRC}/api/members`,
        `${CIRC}/api/members/1/loans`,
        `${CIRC}/api/loans/overdue`,
      ]);
    });

    test("ส่งต่อ query string, Authorization, body, method และ IP ผู้เรียก", async () => {
      axios.request.mockResolvedValue(upstream(201, { message: "ok" }));
      const token = bearer(admin);

      await request(app)
        .post("/api/loans?x=1")
        .set("Authorization", token)
        .set("X-Forwarded-For", "203.0.113.9")
        .send({ book_id: 1, member_id: 1, due_date: "2030-01-01" });

      const [config] = axios.request.mock.calls[0];
      expect(config.method).toBe("POST");
      expect(config.url).toBe(`${CIRC}/api/loans?x=1`);
      expect(config.data).toEqual({ book_id: 1, member_id: 1, due_date: "2030-01-01" });
      expect(config.headers.Authorization).toBe(token);
      expect(config.headers["Content-Type"]).toContain("application/json");
      expect(config.headers["X-Forwarded-For"]).toBe("203.0.113.9");
      expect(config.timeout).toBe(3000);
    });

    test("DELETE และ GET ไม่ส่ง body ไปปลายทาง", async () => {
      axios.request.mockResolvedValue(upstream(200, { success: true }));

      await request(app).delete("/api/books/1").set("Authorization", bearer(admin));

      expect(axios.request.mock.calls[0][0].data).toBeUndefined();
    });

    test("ส่งต่อสถานะและเนื้อหาจากปลายทางตามเดิม (รวม 4xx)", async () => {
      axios.request.mockResolvedValue(upstream(409, { success: false, message: "ข้อมูลซ้ำ" }));

      const res = await request(app).post("/api/books").set("Authorization", bearer(admin)).send({});

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ success: false, message: "ข้อมูลซ้ำ" });
    });

    test("ส่งต่อ header ที่เกี่ยวข้อง (X-Cache, RateLimit) แต่ไม่ส่ง header อื่นของปลายทาง", async () => {
      axios.request.mockResolvedValue(
        upstream(
          429,
          { success: false },
          { "x-cache": "HIT", ratelimit: "limit=5, remaining=0, reset=900", "x-secret": "no" },
        ),
      );

      const res = await request(app).get("/api/books").set("Authorization", bearer(admin));

      expect(res.status).toBe(429);
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(res.headers.ratelimit).toContain("remaining=0");
      expect(res.headers["x-secret"]).toBeUndefined();
    });

    test("ตัวอักษร HTML จากปลายทางถูกส่งต่อเป็นข้อความ", async () => {
      axios.request.mockResolvedValue(upstream(502, "<h1>Bad gateway</h1>"));

      const res = await request(app).get("/api/books").set("Authorization", bearer(admin));

      expect(res.status).toBe(502);
      expect(res.text).toContain("Bad gateway");
    });
  });

  describe("เมื่อบริการปลายทางมีปัญหา", () => {
    test("เชื่อมต่อไม่ได้ ตอบ 503 SERVICE_UNAVAILABLE และ Gateway ยังทำงานต่อ", async () => {
      axios.request.mockRejectedValue(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));

      const res = await request(app).get("/api/books").set("Authorization", bearer(admin));

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("SERVICE_UNAVAILABLE");
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("ไม่สามารถติดต่อบริการปลายทาง");

      axios.request.mockResolvedValue(upstream(200, { ok: 1 }));
      const again = await request(app).get("/api/books").set("Authorization", bearer(admin));
      expect(again.status).toBe(200);
    });

    test("ปลายทางตอบช้าเกินกำหนด ตอบ 503 พร้อมข้อความเรื่องตอบช้า", async () => {
      axios.request.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));

      const res = await request(app).get("/api/members").set("Authorization", bearer(admin));

      expect(res.status).toBe(503);
      expect(res.body.message).toContain("ตอบช้า");
    });
  });

  describe("health และเส้นทางที่ไม่มี", () => {
    test("/health รวมสถานะของทั้งสองบริการ (ไม่ต้องมี token)", async () => {
      axios.get.mockResolvedValue({ data: { status: "ok" } });

      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: "api-gateway",
        status: "ok",
        upstream: { "book-api": "ok", "circulation-service": "ok" },
      });
    });

    test("/health ตอบ 503 เมื่อบริการใดบริการหนึ่งล่ม", async () => {
      axios.get
        .mockResolvedValueOnce({ data: { status: "ok" } })
        .mockRejectedValueOnce(new Error("down"));

      const res = await request(app).get("/health");

      expect(res.status).toBe(503);
      expect(res.body.upstream["circulation-service"]).toBe("down");
    });

    test("/health ตอบ error เมื่อบริการตอบสถานะไม่ใช่ ok", async () => {
      axios.get.mockResolvedValue({ data: { status: "starting" } });

      const res = await request(app).get("/health");

      expect(res.status).toBe(503);
      expect(res.body.upstream["book-api"]).toBe("error");
    });

    test("เส้นทางที่ Gateway ไม่รู้จักตอบ 404 รูปแบบมาตรฐาน", async () => {
      const res = await request(app).get("/api/unknown").set("Authorization", bearer(admin));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("ROUTE_NOT_FOUND");
      expect(axios.request).not.toHaveBeenCalled();
    });

    test("ข้อมูลเกิน 10KB ถูกปฏิเสธที่ Gateway ก่อนส่งต่อ", async () => {
      const res = await request(app)
        .post("/api/books")
        .set("Authorization", bearer(admin))
        .send({ title: "x".repeat(15000) });

      expect(res.status).toBe(413);
      expect(axios.request).not.toHaveBeenCalled();
    });
  });
});
