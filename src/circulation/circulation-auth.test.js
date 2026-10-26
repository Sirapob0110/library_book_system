// ทดสอบสิทธิ์ตามบทบาทของ Circulation Service (admin / user / ไม่ได้เข้าสู่ระบบ)
jest.mock("../db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const request = require("supertest");
const { as, admin, user, otherUser } = require("../../tests/helpers/auth");
const db = require("../db");
const app = require("./index");

describe("Circulation Service: สิทธิ์ตามบทบาท", () => {
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const allRoutes = [
    ["get", "/api/members"],
    ["post", "/api/members"],
    ["put", "/api/members/1"],
    ["delete", "/api/members/1"],
    ["get", "/api/members/1/loans"],
    ["get", "/api/loans/overdue"],
    ["post", "/api/loans"],
    ["put", "/api/loans/1/return"],
  ];
  const adminOnlyRoutes = [
    ["get", "/api/members"],
    ["post", "/api/members"],
    ["put", "/api/members/1"],
    ["delete", "/api/members/1"],
    ["get", "/api/loans/overdue"],
  ];

  test("/health เปิดให้เรียกได้โดยไม่ต้องเข้าสู่ระบบ", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  test.each(allRoutes)("%s %s: 401 เมื่อไม่ได้เข้าสู่ระบบ", async (method, url) => {
    const res = await request(app)[method](url).send({});

    expect(res.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test.each(adminOnlyRoutes)("%s %s: 403 เมื่อเป็น user และไม่แตะฐานข้อมูล", async (method, url) => {
    const res = await as(app, user)[method](url).send({});

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  describe("GET /api/members/:id/loans", () => {
    test("user ดูประวัติของตัวเองได้", async () => {
      db.query.mockResolvedValueOnce([[{ member_id: 1, name: "สมชาย" }]]).mockResolvedValueOnce([[]]);

      const res = await as(app, user).get("/api/members/1/loans");

      expect(res.status).toBe(200);
    });

    test("user ดูประวัติของสมาชิกคนอื่นไม่ได้ (403)", async () => {
      const res = await as(app, user).get("/api/members/2/loans");

      expect(res.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    test("admin ดูประวัติของใครก็ได้", async () => {
      db.query.mockResolvedValueOnce([[{ member_id: 2, name: "สมหญิง" }]]).mockResolvedValueOnce([[]]);

      const res = await as(app, admin).get("/api/members/2/loans");

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/loans", () => {
    const loanBody = { book_id: 1, loan_date: "2026-10-20", due_date: "2026-10-30" };

    function mockSuccessfulLoan() {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ book_id: 1, total_copies: 3, available_copies: 2 }]])
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
    }

    test("user ยืมในนามสมาชิกของตัวเองได้ โดยไม่ต้องส่ง member_id", async () => {
      mockSuccessfulLoan();

      const res = await as(app, user).post("/api/loans").send(loanBody);

      expect(res.status).toBe(201);
      // ตรวจว่าใช้ member_id ของผู้ใช้ที่ล็อกอิน (1) ตอนตรวจสมาชิก
      expect(connection.query.mock.calls[0][1]).toEqual([1]);
      expect(connection.commit).toHaveBeenCalled();
    });

    test("user ส่ง member_id ของตัวเองมาได้", async () => {
      mockSuccessfulLoan();

      const res = await as(app, user).post("/api/loans").send({ ...loanBody, member_id: 1 });

      expect(res.status).toBe(201);
    });

    test("user ยืมในนามสมาชิกคนอื่นไม่ได้ (403) และไม่เริ่มธุรกรรม", async () => {
      const res = await as(app, user).post("/api/loans").send({ ...loanBody, member_id: 2 });

      expect(res.status).toBe(403);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test("admin ยืมให้สมาชิกคนใดก็ได้", async () => {
      mockSuccessfulLoan();

      const res = await as(app, admin).post("/api/loans").send({ ...loanBody, member_id: 2 });

      expect(res.status).toBe(201);
      expect(connection.query.mock.calls[0][1]).toEqual([2]);
    });
  });

  describe("PUT /api/loans/:id/return", () => {
    const openLoan = { loan_id: 1, book_id: 2, member_id: 1, return_date: null };

    function mockSuccessfulReturn() {
      connection.query
        .mockResolvedValueOnce([[openLoan]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
    }

    test("เจ้าของรายการยืมคืนหนังสือได้", async () => {
      mockSuccessfulReturn();

      const res = await as(app, user).put("/api/loans/1/return");

      expect(res.status).toBe(200);
      expect(connection.commit).toHaveBeenCalled();
    });

    test("user คืนรายการยืมของคนอื่นไม่ได้ (403) rollback และไม่แก้ข้อมูล", async () => {
      connection.query.mockResolvedValueOnce([[openLoan]]);

      const res = await as(app, otherUser).put("/api/loans/1/return");

      expect(res.status).toBe(403);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.query).toHaveBeenCalledTimes(1);
    });

    test("admin คืนแทนสมาชิกคนใดก็ได้", async () => {
      mockSuccessfulReturn();

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.status).toBe(200);
    });
  });
});
