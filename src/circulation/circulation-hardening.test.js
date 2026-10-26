// Circulation Service: การตรวจข้อมูลด้วย zod, รูปแบบ error, ขนาด payload, ล้าง cache และ rate limit (Lab 4, 7, 12)
jest.mock("../db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const request = require("supertest");
const { as, admin } = require("../../tests/helpers/auth");
const db = require("../db");
const cache = require("../cache");
const app = require("./index");

describe("Circulation Service: ความปลอดภัยและการตรวจข้อมูล", () => {
  let connection;

  beforeEach(() => {
    jest.resetAllMocks();
    connection = {
      query: jest.fn(),
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(connection);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  describe("รูปแบบ error และ header", () => {
    test("route ที่ไม่มีตอบ 404 รูปแบบมาตรฐาน", async () => {
      const res = await as(app, admin).get("/api/nothing");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("ROUTE_NOT_FOUND");
    });

    test("ข้อมูลเกิน 10KB ตอบ 413 และไม่แตะฐานข้อมูล", async () => {
      const res = await as(app, admin)
        .post("/api/members")
        .send({ name: "x".repeat(15000), email: "a@b.co" });

      expect(res.status).toBe(413);
      expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
      expect(db.query).not.toHaveBeenCalled();
    });

    test("JSON ผิดรูปแบบตอบ 400 พร้อมข้อความเดิมในฟิลด์ error", async () => {
      const res = await as(app, admin)
        .post("/api/members")
        .set("Content-Type", "application/json")
        .send('{"name": ');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("รูปแบบ JSON ไม่ถูกต้อง");
      expect(res.body.code).toBe("INVALID_JSON");
    });

    test("มี header ของ helmet และไม่เปิดเผย X-Powered-By", async () => {
      const res = await request(app).get("/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });

    test("CORS ไม่อนุญาต origin แปลกปลอม", async () => {
      const res = await request(app).get("/health").set("Origin", "http://malicious-site.example.com");

      expect(res.headers["access-control-allow-origin"]).not.toBe("http://malicious-site.example.com");
    });
  });

  describe("สมาชิก: ตรวจด้วย zod", () => {
    test("name เป็น object ถูกปฏิเสธ (type confusion)", async () => {
      const res = await as(app, admin)
        .post("/api/members")
        .send({ name: { $ne: null }, email: "a@b.co" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details[0].field).toBe("name");
      expect(db.query).not.toHaveBeenCalled();
    });

    test("อีเมลไม่ถูกต้องระบุ field ใน details", async () => {
      const res = await as(app, admin).post("/api/members").send({ name: "A", email: "nope" });

      expect(res.body.details.map((d) => d.field)).toEqual(["email"]);
      expect(res.body.error).toBe("กรุณาระบุชื่อและอีเมลให้ถูกต้อง");
    });

    test("ตัดช่องว่าง ตัดฟิลด์แปลกปลอม และแปลง phone ว่างเป็น null ก่อนบันทึก", async () => {
      db.query.mockResolvedValueOnce([{ insertId: 9 }]);

      const res = await as(app, admin)
        .post("/api/members")
        .send({ name: "  สมชาย  ", email: " s@b.co ", phone: "   ", role: "admin", member_id: 999 });

      expect(res.status).toBe(201);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ["สมชาย", "s@b.co", null]);
    });

    test("phone ที่ไม่ใช่ข้อความถูกละเลย (บันทึกเป็น null)", async () => {
      db.query.mockResolvedValueOnce([{ insertId: 9 }]);

      await as(app, admin).post("/api/members").send({ name: "A", email: "a@b.co", phone: 12345 });

      expect(db.query).toHaveBeenCalledWith(expect.any(String), ["A", "a@b.co", null]);
    });
  });

  describe("การยืม: ตรวจข้ามฟิลด์ด้วย superRefine", () => {
    const base = { book_id: 2, member_id: 1 };

    test("วันกำหนดคืนก่อนวันที่ยืมถูกปฏิเสธที่ field due_date", async () => {
      const res = await as(app, admin)
        .post("/api/loans")
        .send({ ...base, loan_date: "2026-10-20", due_date: "2026-10-10" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual([
        { field: "due_date", message: "วันกำหนดคืนต้องไม่ก่อนวันที่ยืม" },
      ]);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test("ไม่ส่ง loan_date: ใช้วันนี้เทียบ วันกำหนดคืนในอดีตถูกปฏิเสธ", async () => {
      const res = await as(app, admin).post("/api/loans").send({ ...base, due_date: "2000-01-01" });

      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe("due_date");
    });

    test("วันที่ที่ไม่มีจริง (30 กุมภาพันธ์) และรูปแบบผิดถูกปฏิเสธ", async () => {
      const fake = await as(app, admin)
        .post("/api/loans")
        .send({ ...base, due_date: "2030-02-30" });
      const format = await as(app, admin)
        .post("/api/loans")
        .send({ ...base, due_date: "30/10/2030" });

      expect(fake.status).toBe(400);
      expect(fake.body.details[0].message).toContain("ไม่ใช่วันที่ที่มีอยู่จริง");
      expect(format.status).toBe(400);
      expect(format.body.details[0].message).toContain("YYYY-MM-DD");
    });

    test("book_id ที่ไม่ใช่ตัวเลขถูกปฏิเสธ แต่ข้อความตัวเลข '2' ยอมรับ", async () => {
      const bad = await as(app, admin)
        .post("/api/loans")
        .send({ book_id: "abc", member_id: 1, due_date: "2030-01-01" });
      expect(bad.status).toBe(400);
      expect(bad.body.details[0].field).toBe("book_id");

      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ book_id: 2, total_copies: 3, available_copies: 2 }]])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const good = await as(app, admin)
        .post("/api/loans")
        .send({ book_id: "2", member_id: "1", due_date: "2030-01-01" });
      expect(good.status).toBe(201);
      expect(good.body.book_id).toBe(2);
    });

    test("ไม่ส่ง due_date ตอบ 400 ระบุ field", async () => {
      const res = await as(app, admin).post("/api/loans").send(base);

      expect(res.status).toBe(400);
      expect(res.body.details.map((d) => d.field)).toContain("due_date");
    });
  });

  describe("ล้าง cache รายการหนังสือเมื่อจำนวนคงเหลือเปลี่ยน", () => {
    test("ยืมสำเร็จล้าง prefix books:", async () => {
      const invalidate = jest.spyOn(cache, "invalidate").mockResolvedValue(undefined);
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ book_id: 2, total_copies: 3, available_copies: 2 }]])
        .mockResolvedValueOnce([{ insertId: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await as(app, admin).post("/api/loans").send({ book_id: 2, member_id: 1, due_date: "2030-01-01" });

      expect(invalidate).toHaveBeenCalledWith("books:");
    });

    test("คืนสำเร็จล้าง prefix books:", async () => {
      const invalidate = jest.spyOn(cache, "invalidate").mockResolvedValue(undefined);
      connection.query
        .mockResolvedValueOnce([[{ loan_id: 5, book_id: 2, member_id: 1, return_date: null }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).put("/api/loans/5/return");

      expect(res.status).toBe(200);
      expect(invalidate).toHaveBeenCalledWith("books:");
    });

    test("ยืมไม่สำเร็จ (หนังสือหมด) ไม่ล้าง cache", async () => {
      const invalidate = jest.spyOn(cache, "invalidate").mockResolvedValue(undefined);
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ book_id: 2, total_copies: 3, available_copies: 0 }]]);

      const res = await as(app, admin)
        .post("/api/loans")
        .send({ book_id: 2, member_id: 1, due_date: "2030-01-01" });

      expect(res.status).toBe(409);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe("จำกัดจำนวนคำขอ", () => {
    test("เกินโควตาทั่วไปตอบ 429 พร้อม header RateLimit (ยกเว้น /health)", async () => {
      process.env.RATE_LIMIT_MAX = "3";
      let isolated;
      jest.isolateModules(() => {
        isolated = require("./index");
      });
      delete process.env.RATE_LIMIT_MAX;

      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await request(isolated).get("/api/members")).status);

      expect(statuses).toEqual([401, 401, 401, 429, 429]);

      const blocked = await request(isolated).get("/api/members");
      expect(blocked.body.code).toBe("TOO_MANY_REQUESTS");
      expect(blocked.headers.ratelimit).toMatch(/remaining=0/);
      expect((await request(isolated).get("/health")).status).toBe(200);
    });
  });
});
