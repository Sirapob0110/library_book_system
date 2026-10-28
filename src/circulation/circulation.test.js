const request = require("supertest");
const { as, admin } = require("../../tests/helpers/auth");

jest.mock("../db", () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require("../db");
const app = require("./index");

describe("Circulation Service", () => {
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();

    connection = {
      query: jest.fn(),
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };

    db.getConnection.mockResolvedValue(connection);
  });

  describe("GET /health", () => {
    test("returns service health", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: "circulation-service",
        status: "ok",
      });
    });
  });

  describe("GET /api/members", () => {
    test("returns members", async () => {
      db.query.mockResolvedValue([
        [{ member_id: 1, name: "Test User", email: "test@example.com" }],
      ]);

      const res = await as(app, admin).get("/api/members");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test("returns 500 when database query fails", async () => {
      db.query.mockRejectedValue(new Error("Database unavailable"));

      const res = await as(app, admin).get("/api/members");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/members", () => {
    test("returns 400 for invalid member data", async () => {
      const res = await as(app, admin)
        .post("/api/members")
        .send({ name: "", email: "invalid-email" });

      expect(res.status).toBe(400);
      expect(db.query).not.toHaveBeenCalled();
    });

    test("creates a member successfully", async () => {
      db.query.mockResolvedValue([{ insertId: 10 }]);

      const res = await as(app, admin).post("/api/members").send({
        name: "  Test User  ",
        email: "test@example.com",
        phone: " 0123456789 ",
      });

      expect(res.status).toBe(201);
      expect(res.body.member_id).toBe(10);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO members"),
        ["Test User", "test@example.com", "0123456789"],
      );
    });

    test("returns 409 for duplicate email", async () => {
      db.query.mockRejectedValue({ code: "ER_DUP_ENTRY" });

      const res = await as(app, admin).post("/api/members").send({
        name: "Test User",
        email: "test@example.com",
      });

      expect(res.status).toBe(409);
    });
  });

  describe("PUT /api/members/:id", () => {
    test("returns 400 for invalid member ID", async () => {
      const res = await as(app, admin).put("/api/members/0").send({
        name: "Test User",
        email: "test@example.com",
      });

      expect(res.status).toBe(400);
    });

    test("returns 404 when member does not exist", async () => {
      db.query.mockResolvedValue([[]]);

      const res = await as(app, admin).put("/api/members/999").send({
        name: "Test User",
        email: "test@example.com",
      });

      expect(res.status).toBe(404);
    });

    test("updates an existing member", async () => {
      db.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([
          [
            {
              member_id: 1,
              name: "Updated User",
              email: "updated@example.com",
              phone: null,
            },
          ],
        ]);

      const res = await as(app, admin).put("/api/members/1").send({
        name: "Updated User",
        email: "updated@example.com",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated User");
    });
  });

  describe("DELETE /api/members/:id", () => {
    // ลบสมาชิกใช้ transaction: ล็อกแถว -> นับการยืม (ทั้งหมด/ค้างอยู่) -> ลบจริงหรือเก็บประวัติ
    const locked = [[{ member_id: 1 }]];
    const counts = (total, active) => [[{ total, active }]];

    test("returns 400 for invalid ID", async () => {
      const res = await as(app, admin).delete("/api/members/abc");

      expect(res.status).toBe(400);
    });

    test("returns 404 when member does not exist (หรือถูกลบไปแล้ว)", async () => {
      connection.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).delete("/api/members/999");

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });

    test("ไม่เคยยืม: ลบจริง (archived=false)", async () => {
      connection.query
        .mockResolvedValueOnce(locked)
        .mockResolvedValueOnce(counts(0, 0))
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).delete("/api/members/1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ member_id: 1, archived: false });
      expect(connection.query.mock.calls[2][0]).toMatch(/DELETE FROM members/);
      expect(connection.commit).toHaveBeenCalled();
    });

    test("มีประวัติการยืมแต่คืนครบแล้ว: เก็บประวัติ ปิดบัญชีผู้ใช้ และตั้ง deleted_at", async () => {
      connection.query
        .mockResolvedValueOnce(locked)
        .mockResolvedValueOnce(counts(3, 0))
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).delete("/api/members/1");

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(connection.query.mock.calls[2][0]).toMatch(/DELETE FROM users WHERE member_id/);
      expect(connection.query.mock.calls[3][0]).toMatch(/UPDATE members SET deleted_at = NOW\(\)/);
      expect(connection.query.mock.calls.some((c) => /DELETE FROM members/.test(c[0]))).toBe(false);
      expect(connection.commit).toHaveBeenCalled();
    });

    test("ยังมีหนังสือค้างอยู่: 409 MEMBER_HAS_ACTIVE_LOANS และไม่แก้ข้อมูล", async () => {
      connection.query.mockResolvedValueOnce(locked).mockResolvedValueOnce(counts(2, 1));

      const res = await as(app, admin).delete("/api/members/1");

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("MEMBER_HAS_ACTIVE_LOANS");
      expect(connection.query).toHaveBeenCalledTimes(2);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
    });

    test("returns 500 และ rollback เมื่อ query ล้มเหลว", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      connection.query.mockResolvedValueOnce(locked).mockRejectedValueOnce(new Error("Database failure"));

      const res = await as(app, admin).delete("/api/members/1");

      expect(res.status).toBe(500);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
      console.error.mockRestore();
    });
  });

  describe("GET /api/members/:id/loans", () => {
    test("returns 400 for invalid member ID", async () => {
      const res = await as(app, admin).get("/api/members/0/loans");

      expect(res.status).toBe(400);
    });

    test("returns 404 when member does not exist", async () => {
      db.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).get("/api/members/99/loans");

      expect(res.status).toBe(404);
    });

    test("returns member loan history", async () => {
      db.query
        .mockResolvedValueOnce([[{ member_id: 1, name: "Test User" }]])
        .mockResolvedValueOnce([
          [{ loan_id: 5, book_id: 2, title: "Test Book" }],
        ]);

      const res = await as(app, admin).get("/api/members/1/loans");

      expect(res.status).toBe(200);
      expect(res.body.member.member_id).toBe(1);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("GET /api/loans/overdue", () => {
    test("returns overdue loans", async () => {
      db.query.mockResolvedValue([
        [{ loan_id: 3, member_id: 1, book_id: 2, title: "Overdue Book" }],
      ]);

      const res = await as(app, admin).get("/api/loans/overdue");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test("returns 500 when database query fails", async () => {
      db.query.mockRejectedValue(new Error("Database unavailable"));

      const res = await as(app, admin).get("/api/loans/overdue");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/loans", () => {
    test("returns 400 when required fields are missing", async () => {
      const res = await as(app, admin).post("/api/loans").send({
        book_id: 1,
        member_id: 1,
      });

      expect(res.status).toBe(400);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test("returns 400 for an invalid date", async () => {
      const res = await as(app, admin).post("/api/loans").send({
        book_id: 1,
        member_id: 1,
        loan_date: "2026-02-30",
        due_date: "2026-03-10",
      });

      expect(res.status).toBe(400);
    });

    test("returns 404 when member does not exist", async () => {
      connection.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).post("/api/loans").send({
        book_id: 1,
        member_id: 99,
        loan_date: "2026-10-20",
        due_date: "2026-10-30",
      });

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });

    test("returns 404 when book does not exist", async () => {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ n: 0 }]]) // นับเล่มที่ค้างอยู่ของสมาชิก
        .mockResolvedValueOnce([[]]);

      const res = await as(app, admin).post("/api/loans").send({
        book_id: 99,
        member_id: 1,
        loan_date: "2026-10-20",
        due_date: "2026-10-30",
      });

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalled();
    });

    test("returns 409 when no copies are available", async () => {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ n: 0 }]]) // นับเล่มที่ค้างอยู่ของสมาชิก
        .mockResolvedValueOnce([
          [{ book_id: 1, total_copies: 2, available_copies: 0 }],
        ]);

      const res = await as(app, admin).post("/api/loans").send({
        book_id: 1,
        member_id: 1,
        loan_date: "2026-10-20",
        due_date: "2026-10-30",
      });

      expect(res.status).toBe(409);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
    });

    test("creates a loan and commits the transaction", async () => {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ n: 0 }]]) // นับเล่มที่ค้างอยู่ของสมาชิก
        .mockResolvedValueOnce([
          [{ book_id: 2, total_copies: 3, available_copies: 2 }],
        ])
        .mockResolvedValueOnce([{ insertId: 15 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).post("/api/loans").send({
        book_id: 2,
        member_id: 1,
        loan_date: "2026-10-20",
        due_date: "2026-10-30",
      });

      expect(res.status).toBe(201);
      expect(res.body.loan_id).toBe(15);
      expect(connection.commit).toHaveBeenCalled();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });

    test("rolls back and releases connection when a query fails", async () => {
      connection.query.mockRejectedValueOnce(new Error("Database failure"));

      const res = await as(app, admin).post("/api/loans").send({
        book_id: 2,
        member_id: 1,
        loan_date: "2026-10-20",
        due_date: "2026-10-30",
      });

      expect(res.status).toBe(500);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });
  });

  describe("PUT /api/loans/:id/return", () => {
    test("returns 400 for invalid loan ID", async () => {
      const res = await as(app, admin).put("/api/loans/abc/return");

      expect(res.status).toBe(400);
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test("returns 404 when loan does not exist", async () => {
      connection.query.mockResolvedValueOnce([[]]);

      const res = await as(app, admin).put("/api/loans/99/return");

      expect(res.status).toBe(404);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });

    test("returns 409 when loan has already been returned", async () => {
      connection.query.mockResolvedValueOnce([
        [{ loan_id: 1, book_id: 2, return_date: "2026-10-20" }],
      ]);

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.status).toBe(409);
      expect(connection.rollback).toHaveBeenCalled();
    });

    test("returns a book and commits the transaction", async () => {
      connection.query
        .mockResolvedValueOnce([
          [{ loan_id: 1, book_id: 2, return_date: null }],
        ])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.status).toBe(200);
      expect(res.body.loan_id).toBe(1);
      expect(connection.commit).toHaveBeenCalled();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });

    test("rolls back and releases connection when return query fails", async () => {
      connection.query.mockRejectedValueOnce(new Error("Database failure"));

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.status).toBe(500);
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    });
  });

  describe("เพดานการยืม, ค่าปรับ และสมาชิกที่ถูกลบ", () => {
    const body = { book_id: 2, member_id: 1, loan_date: "2026-10-20", due_date: "2026-10-30" };
    const prevEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...prevEnv };
    });

    test("ยืมค้างครบ 5 เล่มแล้ว: 409 LOAN_LIMIT_REACHED ไม่ล็อกหนังสือและไม่เพิ่มรายการ", async () => {
      connection.query.mockResolvedValueOnce([[{ member_id: 1 }]]).mockResolvedValueOnce([[{ n: 5 }]]);

      const res = await as(app, admin).post("/api/loans").send(body);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LOAN_LIMIT_REACHED");
      expect(res.body.error).toContain("5");
      expect(connection.query).toHaveBeenCalledTimes(2);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.rollback).toHaveBeenCalled();
    });

    test("ยืมได้เมื่อค้างอยู่ 4 เล่ม (ต่ำกว่าเพดาน) ", async () => {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ n: 4 }]])
        .mockResolvedValueOnce([[{ book_id: 2, total_copies: 3, available_copies: 2 }]])
        .mockResolvedValueOnce([{ insertId: 20 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).post("/api/loans").send(body);

      expect(res.status).toBe(201);
    });

    test("MAX_ACTIVE_LOANS ปรับเพดานได้", async () => {
      process.env.MAX_ACTIVE_LOANS = "2";
      connection.query.mockResolvedValueOnce([[{ member_id: 1 }]]).mockResolvedValueOnce([[{ n: 2 }]]);

      const res = await as(app, admin).post("/api/loans").send(body);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("2");
    });

    test("ล็อกแถวสมาชิกที่ยังไม่ถูกลบ (FOR UPDATE, deleted_at IS NULL) ก่อนนับ", async () => {
      connection.query.mockResolvedValueOnce([[]]);

      await as(app, admin).post("/api/loans").send(body);

      expect(connection.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL FOR UPDATE/);
    });

    test("หนังสือที่ถูกลบแล้วยืมไม่ได้ (404)", async () => {
      connection.query
        .mockResolvedValueOnce([[{ member_id: 1 }]])
        .mockResolvedValueOnce([[{ n: 0 }]])
        .mockResolvedValueOnce([[]]);

      const res = await as(app, admin).post("/api/loans").send(body);

      expect(res.status).toBe(404);
      expect(connection.query.mock.calls[2][0]).toMatch(/deleted_at IS NULL/);
    });

    test("คืนหนังสือที่เกินกำหนด 3 วัน: ค่าปรับ 15 บาท (5 บาท/วัน)", async () => {
      connection.query
        .mockResolvedValueOnce([[{ loan_id: 1, book_id: 2, return_date: null, days_late: 3 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ days_overdue: 3, fine_amount: 15 });
    });

    test("คืนก่อนหรือตรงกำหนด ไม่มีค่าปรับ (วันติดลบนับเป็น 0)", async () => {
      connection.query
        .mockResolvedValueOnce([[{ loan_id: 1, book_id: 2, return_date: null, days_late: -4 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await as(app, admin).put("/api/loans/1/return");

      expect(res.body).toMatchObject({ days_overdue: 0, fine_amount: 0 });
    });

    test("FINE_PER_DAY ปรับอัตราได้ และค่าที่ไม่ถูกต้องใช้ 5", async () => {
      process.env.FINE_PER_DAY = "10";
      db.query.mockResolvedValueOnce([[{ loan_id: 3, title: "B", days_late: 2 }]]);
      const custom = await as(app, admin).get("/api/loans/overdue");
      expect(custom.body.data[0]).toMatchObject({ days_overdue: 2, fine_amount: 20 });

      process.env.FINE_PER_DAY = "abc";
      db.query.mockResolvedValueOnce([[{ loan_id: 3, title: "B", days_late: 2 }]]);
      const invalid = await as(app, admin).get("/api/loans/overdue");
      expect(invalid.body.data[0].fine_amount).toBe(10);
    });

    test("ประวัติการยืมแสดงจำนวนวันที่เกินและค่าปรับ (รายการที่คืนตรงเวลาเป็น 0)", async () => {
      db.query
        .mockResolvedValueOnce([[{ member_id: 1, name: "A" }]])
        .mockResolvedValueOnce([
          [
            { loan_id: 2, title: "Late", return_date: "2026-10-20", days_late: 4 },
            { loan_id: 1, title: "OnTime", return_date: "2026-10-10", days_late: -2 },
          ],
        ]);

      const res = await as(app, admin).get("/api/members/1/loans");

      expect(res.body.data[0]).toMatchObject({ days_overdue: 4, fine_amount: 20 });
      expect(res.body.data[1]).toMatchObject({ days_overdue: 0, fine_amount: 0 });
      expect(res.body.data[0]).not.toHaveProperty("days_late");
    });

    test("รายชื่อสมาชิกและการแก้ไขไม่รวมสมาชิกที่ถูกลบ", async () => {
      db.query.mockResolvedValueOnce([[]]);
      await as(app, admin).get("/api/members");
      expect(db.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);

      db.query.mockResolvedValueOnce([[]]);
      const put = await as(app, admin).put("/api/members/1").send({ name: "Ab", email: "a@b.co" });
      expect(put.status).toBe(404);
      expect(db.query.mock.calls[1][0]).toMatch(/deleted_at IS NULL/);
    });
  });
});
