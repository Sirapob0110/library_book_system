// ทดสอบ request id และ log JSON: id ไหลจาก Gateway ไปบริการปลายทาง และตอบกลับใน X-Request-Id
jest.mock("axios");
jest.mock("../src/db", () => ({ query: jest.fn(), getConnection: jest.fn() }));

const axios = require("axios");
const request = require("supertest");
const { requestId, requestLogger } = require("../src/middlewares/request-log");
const { errorHandler } = require("../src/middlewares/errors");
const { tokenOf, admin } = require("./helpers/auth");
const gateway = require("../src/gateway/index");
const bookApi = require("../src/index");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request id", () => {
  beforeEach(() => jest.resetAllMocks());

  test("ไม่ส่ง id มา ระบบสร้างให้และตอบใน X-Request-Id", async () => {
    const res = await request(bookApi).get("/health");

    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  test("ส่ง id ที่รูปแบบถูกต้องมา ใช้ id นั้นต่อ", async () => {
    const res = await request(bookApi).get("/health").set("X-Request-Id", "trace-12345678");

    expect(res.headers["x-request-id"]).toBe("trace-12345678");
  });

  test.each([["short"], ["has space in it 123"], ["<script>alert(1)</script>"], ["x".repeat(65)]])(
    "id ที่รูปแบบไม่ปลอดภัย (%s) ถูกแทนด้วย id ใหม่",
    async (bad) => {
      const res = await request(bookApi).get("/health").set("X-Request-Id", bad);

      expect(res.headers["x-request-id"]).toMatch(UUID);
    },
  );

  test("Gateway ส่ง X-Request-Id ต่อให้บริการปลายทางและตอบ id เดียวกันกลับ", async () => {
    axios.request.mockResolvedValue({ status: 200, data: { success: true }, headers: {} });

    const res = await request(gateway)
      .get("/api/books")
      .set("Authorization", `Bearer ${tokenOf(admin)}`)
      .set("X-Request-Id", "client-req-0001");

    expect(res.headers["x-request-id"]).toBe("client-req-0001");
    expect(axios.request.mock.calls[0][0].headers["X-Request-Id"]).toBe("client-req-0001");
  });

  test("Gateway สร้าง id ให้เมื่อผู้เรียกไม่ส่งมา และส่งต่อให้บริการปลายทาง", async () => {
    axios.request.mockResolvedValue({ status: 200, data: {}, headers: {} });

    const res = await request(gateway).get("/api/books").set("Authorization", `Bearer ${tokenOf(admin)}`);
    const forwarded = axios.request.mock.calls[0][0].headers["X-Request-Id"];

    expect(forwarded).toMatch(UUID);
    expect(res.headers["x-request-id"]).toBe(forwarded);
  });
});

describe("log แบบ JSON", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.env.NODE_ENV = "test";
  });

  test("บรรทัด log เป็น JSON มี requestId/path/status และไม่มี query string", async () => {
    const express = require("express");
    const lines = [];
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // เปิด log (ปกติปิดตอนทดสอบ)
    const write = jest.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const app = express();
    app.use(requestId);
    app.use(requestLogger("demo-service"));
    app.get("/x", (req, res) => res.json({ ok: true }));

    await request(app).get("/x?token=secret").set("X-Request-Id", "log-test-0001");
    write.mockRestore();
    process.env.NODE_ENV = prev;

    const entry = JSON.parse(lines.find((l) => l.includes("log-test-0001")));
    expect(entry).toMatchObject({
      level: "info",
      service: "demo-service",
      requestId: "log-test-0001",
      method: "GET",
      path: "/x",
      status: 200,
    });
    expect(typeof entry.durationMs).toBe("number");
    expect(JSON.stringify(entry)).not.toContain("secret");
  });

  test("ข้อผิดพลาด 500 ถูกบันทึกเป็น JSON พร้อม requestId แต่ผู้ใช้ไม่เห็นรายละเอียด", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = { headersSent: false };
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);

    errorHandler(new Error("secret sql detail"), { id: "err-req-0001" }, res, jest.fn());

    const logged = JSON.parse(spy.mock.calls[0][0]);
    expect(logged).toMatchObject({ level: "error", requestId: "err-req-0001", message: "secret sql detail" });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("secret sql detail");
  });
});
