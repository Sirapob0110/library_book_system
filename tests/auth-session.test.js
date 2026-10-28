// ทดสอบเซสชันแบบ access token + refresh token (cookie httpOnly), การเพิกถอน, ลืม/ตั้งรหัสผ่านใหม่
jest.mock("../src/db", () => ({ query: jest.fn(), getConnection: jest.fn() }));
jest.mock("../src/services/external-api", () => ({ lookupBookByIsbn: jest.fn() }));
jest.mock("../src/services/mailer", () => ({ sendPasswordReset: jest.fn() }));

const crypto = require("crypto");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("./helpers/auth"); // ตั้ง JWT_SECRET สำหรับทดสอบ
const app = require("../src/index");
const pool = require("../src/db");
const { sendPasswordReset } = require("../src/services/mailer");

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const RAW = "r".repeat(43); // รูปแบบเหมือน token จริง (base64url 43 ตัว)
const userRow = { user_id: 2, username: "somchai", role: "user", member_id: 1, name: "สมชาย" };

// จำลองฐานข้อมูลตามชนิดคำสั่ง SQL (ไม่ผูกกับลำดับการเรียก)
function mockSql(routes) {
  const calls = [];
  const impl = async (sql, params) => {
    calls.push({ sql, params });
    for (const [pattern, result] of routes) {
      if (pattern.test(sql)) return typeof result === "function" ? result(params) : result;
    }
    return [[]];
  };
  return { calls, impl };
}

const cookieOf = (res, name = "refresh_token") =>
  (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${name}=`));
const valueOf = (cookie) => decodeURIComponent(cookie.split(";")[0].split("=")[1]);

const tokenRow = (over = {}) => ({
  token_id: 9,
  user_id: 2,
  family_id: "fam-1",
  revoked: 0,
  recently_revoked: 0,
  expired: 0,
  ...over,
});

beforeEach(() => {
  pool.query.mockReset();
  pool.getConnection.mockReset();
  sendPasswordReset.mockReset();
  jest.spyOn(console, "error").mockImplementation((...a) => process.stderr.write("ERR "+a.map(String).join(" ")+"\n"));
});
afterEach(() => jest.restoreAllMocks());

describe("เข้าสู่ระบบ: ออก access token และ refresh token", () => {
  const login = () => request(app).post("/api/auth/login").send({ username: "somchai", password: "User@1234" });
  const loginDb = () =>
    mockSql([
      [/FROM users u/, [[{ ...userRow, password_hash: bcrypt.hashSync("User@1234", 4) }]]],
      [/INSERT INTO refresh_tokens/, [{ affectedRows: 1 }]],
      [/DELETE FROM refresh_tokens/, [{ affectedRows: 0 }]],
    ]);

  test("access token อยู่ใน JSON (อายุ 15 นาที) ส่วน refresh token อยู่ใน cookie เท่านั้น", async () => {
    const db = loginDb();
    pool.query.mockImplementation(db.impl);

    const res = await login();
    const cookie = cookieOf(res);

    expect(res.status).toBe(200);
    expect(res.body.data.expires_in).toBe(900);
    expect(jwt.verify(res.body.data.token, process.env.JWT_SECRET)).toMatchObject({ sub: 2, role: "user" });
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(JSON.stringify(res.body)).not.toContain(valueOf(cookie));
  });

  test("ฐานข้อมูลเก็บเฉพาะ sha256 ของ refresh token ไม่เก็บตัวจริง", async () => {
    const db = loginDb();
    pool.query.mockImplementation(db.impl);

    const res = await login();
    const raw = valueOf(cookieOf(res));
    const insert = db.calls.find((c) => /INSERT INTO refresh_tokens/.test(c.sql));

    expect(insert.params[1]).toBe(sha(raw));
    expect(JSON.stringify(db.calls.map((c) => c.params))).not.toContain(raw);
  });

  test("cookie มี Secure เมื่อรันแบบ production หรือตั้ง COOKIE_SECURE=true", async () => {
    const db = loginDb();
    pool.query.mockImplementation(db.impl);
    process.env.COOKIE_SECURE = "true";

    const res = await login();
    delete process.env.COOKIE_SECURE;

    expect(cookieOf(res)).toMatch(/Secure/i);
  });

  test("รหัสผ่านผิด: ไม่ออก cookie", async () => {
    pool.query.mockImplementation(mockSql([[/FROM users u/, [[{ ...userRow, password_hash: bcrypt.hashSync("other", 4) }]]]]).impl);

    const res = await login();

    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("POST /api/auth/refresh", () => {
  const refresh = (cookie = `refresh_token=${RAW}`) => request(app).post("/api/auth/refresh").set("Cookie", cookie);
  const okRoutes = (row = tokenRow()) => [
    [/FROM refresh_tokens WHERE token_hash/, [[row]]],
    [/UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE token_id/, [{ affectedRows: 1 }]],
    [/DELETE FROM refresh_tokens/, [{ affectedRows: 0 }]],
    [/INSERT INTO refresh_tokens/, [{ affectedRows: 1 }]],
    [/FROM users u/, [[userRow]]],
  ];

  test("สำเร็จ: ได้ access token ใหม่ + refresh token ใหม่ (หมุนเวียน) และเพิกถอนตัวเก่า", async () => {
    const db = mockSql(okRoutes());
    pool.query.mockImplementation(db.impl);

    const res = await refresh();
    const next = valueOf(cookieOf(res));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ user_id: 2, role: "user" });
    expect(jwt.verify(res.body.data.token, process.env.JWT_SECRET).sub).toBe(2);
    expect(next).not.toBe(RAW);
    expect(db.calls.find((c) => /WHERE token_hash/.test(c.sql)).params[1]).toBe(sha(RAW));
    expect(db.calls.some((c) => /SET revoked_at = NOW\(\) WHERE token_id/.test(c.sql) && c.params[0] === 9)).toBe(true);
    const insert = db.calls.find((c) => /INSERT INTO refresh_tokens/.test(c.sql));
    expect(insert.params).toEqual([2, sha(next), "fam-1", 7]); // ชุดเดิม (family) อายุ 7 วัน
  });

  test("ไม่มี cookie: 401 INVALID_REFRESH_TOKEN โดยไม่เรียกฐานข้อมูล", async () => {
    const res = await request(app).post("/api/auth/refresh");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_REFRESH_TOKEN");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([["สั้นเกินไป", "abc"], ["ยาวผิดปกติ", "x".repeat(500)]])("cookie %s: 401 ไม่เรียกฐานข้อมูล", async (_n, value) => {
    const res = await refresh(`refresh_token=${value}`);

    expect(res.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("ไม่พบ token ในฐานข้อมูล: 401 และสั่งล้าง cookie", async () => {
    pool.query.mockImplementation(mockSql([[/FROM refresh_tokens WHERE token_hash/, [[]]]]).impl);

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(cookieOf(res)).toMatch(/refresh_token=;/);
  });

  test("token หมดอายุ: 401", async () => {
    pool.query.mockImplementation(mockSql(okRoutes(tokenRow({ expired: 1 }))).impl);

    expect((await refresh()).status).toBe(401);
  });

  test("ใช้ token ที่ถูกใช้ไปแล้วซ้ำ (นานกว่าช่วงแข่งกัน): 401 และเพิกถอนทั้งชุด", async () => {
    const db = mockSql([
      ...okRoutes(tokenRow({ revoked: 1, recently_revoked: 0 })),
      [/WHERE family_id/, [{ affectedRows: 3 }]],
    ]);
    pool.query.mockImplementation(db.impl);

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(db.calls.some((c) => /WHERE family_id/.test(c.sql) && c.params[0] === "fam-1")).toBe(true);
    expect(db.calls.some((c) => /INSERT INTO refresh_tokens/.test(c.sql))).toBe(false);
  });

  test("ใช้ซ้ำภายในช่วงแข่งกัน (เช่น สองแท็บ): 409 REFRESH_CONFLICT ไม่เพิกถอนทั้งชุด", async () => {
    const db = mockSql(okRoutes(tokenRow({ revoked: 1, recently_revoked: 1 })));
    pool.query.mockImplementation(db.impl);

    const res = await refresh();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REFRESH_CONFLICT");
    expect(db.calls.some((c) => /WHERE family_id/.test(c.sql))).toBe(false);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  test("คำขออื่นชิงใช้ token ไปก่อนระหว่างตรวจ (UPDATE ได้ 0 แถว): 409 และไม่ออก token ใหม่", async () => {
    const routes = okRoutes();
    routes[1] = [/SET revoked_at = NOW\(\) WHERE token_id/, [{ affectedRows: 0 }]];
    const db = mockSql(routes);
    pool.query.mockImplementation(db.impl);

    const res = await refresh();

    expect(res.status).toBe(409);
    expect(db.calls.some((c) => /INSERT INTO refresh_tokens/.test(c.sql))).toBe(false);
  });

  test("ผู้ใช้ถูกลบไปแล้ว: 401 และล้าง cookie", async () => {
    const routes = okRoutes();
    routes[4] = [/FROM users u/, [[]]];
    pool.query.mockImplementation(mockSql(routes).impl);

    const res = await refresh();

    expect(res.status).toBe(401);
    expect(cookieOf(res)).toMatch(/refresh_token=;/);
  });

  test("ฐานข้อมูลล้มเหลว: 500 ไม่เปิดเผยรายละเอียด", async () => {
    pool.query.mockRejectedValue(new Error("secret db detail"));

    const res = await refresh();

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret db detail");
  });

  test("Origin ที่ไม่ใช่หน้าเว็บของเรา: 403 UNTRUSTED_ORIGIN ไม่แตะฐานข้อมูล", async () => {
    const res = await refresh().set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UNTRUSTED_ORIGIN");
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("Origin ของหน้าเว็บเราผ่านได้ และตอบ CORS แบบรับ cookie (credentials)", async () => {
    pool.query.mockImplementation(mockSql(okRoutes()).impl);

    const res = await refresh().set("Origin", "http://localhost:5173");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("POST /api/auth/logout", () => {
  test("เพิกถอนทั้งชุดและล้าง cookie", async () => {
    const db = mockSql([
      [/SELECT family_id FROM refresh_tokens/, [[{ family_id: "fam-1" }]]],
      [/WHERE family_id/, [{ affectedRows: 2 }]],
    ]);
    pool.query.mockImplementation(db.impl);

    const res = await request(app).post("/api/auth/logout").set("Cookie", `refresh_token=${RAW}`);

    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/refresh_token=;/);
    expect(db.calls.find((c) => /WHERE family_id/.test(c.sql)).params[0]).toBe("fam-1");
  });

  test("ไม่มี cookie ก็ไม่ error (เรียกซ้ำได้)", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("Origin แปลกปลอม: 403", async () => {
    const res = await request(app).post("/api/auth/logout").set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/forgot-password", () => {
  const ask = (identifier) => request(app).post("/api/auth/forgot-password").send({ identifier });

  test("พบบัญชี: สร้าง token (เก็บเฉพาะ hash), ส่งให้ mailer, ตอบ 202 โดยไม่เปิดเผย token", async () => {
    const db = mockSql([
      [/FROM users u/, [[{ user_id: 2, username: "somchai" }]]],
      [/UPDATE password_resets/, [{ affectedRows: 0 }]],
      [/INSERT INTO password_resets/, [{ affectedRows: 1 }]],
    ]);
    pool.query.mockImplementation(db.impl);

    const res = await ask("somchai@example.com");
    const sent = sendPasswordReset.mock.calls[0][0];
    const insert = db.calls.find((c) => /INSERT INTO password_resets/.test(c.sql));

    expect(res.status).toBe(202);
    expect(sent).toMatchObject({ username: "somchai", expiresMinutes: 30 });
    expect(insert.params[1]).toBe(sha(sent.token));
    expect(JSON.stringify(res.body)).not.toContain(sent.token);
    expect(db.calls.find((c) => /FROM users u/.test(c.sql)).params).toEqual(["somchai@example.com", "somchai@example.com"]);
  });

  test("ไม่พบบัญชี: ตอบเหมือนกันทุกประการ (กันการไล่เดา) และไม่สร้าง token/ส่งอะไร", async () => {
    const found = mockSql([
      [/FROM users u/, [[{ user_id: 2, username: "somchai" }]]],
      [/INSERT INTO password_resets/, [{ affectedRows: 1 }]],
    ]);
    pool.query.mockImplementation(found.impl);
    const a = await ask("somchai");

    pool.query.mockReset();
    sendPasswordReset.mockReset();
    const none = mockSql([[/FROM users u/, [[]]]]);
    pool.query.mockImplementation(none.impl);
    const b = await ask("ghost");

    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(sendPasswordReset).not.toHaveBeenCalled();
    expect(none.calls.some((c) => /INSERT INTO password_resets/.test(c.sql))).toBe(false);
  });

  test.each([["ไม่ส่งข้อมูล", {}], ["ว่าง", { identifier: "  " }], ["ชนิดผิด", { identifier: { $ne: "" } }]])(
    "400: %s",
    async (_n, body) => {
      const res = await request(app).post("/api/auth/forgot-password").send(body);

      expect(res.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  test("ฐานข้อมูลล้มเหลว: 500", async () => {
    pool.query.mockRejectedValue(new Error("db down"));

    expect((await ask("somchai")).status).toBe(500);
  });
});

describe("POST /api/auth/reset-password", () => {
  let conn;
  const TOKEN = "t".repeat(43);
  const reset = (body) => request(app).post("/api/auth/reset-password").send(body);

  beforeEach(() => {
    conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    pool.getConnection.mockResolvedValue(conn);
  });

  test("สำเร็จ: เปลี่ยนรหัสผ่านเป็น bcrypt hash, ใช้ token แล้ว และเพิกถอนทุกเซสชันของผู้ใช้", async () => {
    conn.query
      .mockResolvedValueOnce([[{ reset_id: 5, user_id: 2 }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    const res = await reset({ token: TOKEN, password: "NewPassw0rd!" });
    const sqls = conn.query.mock.calls.map((c) => c[0]);

    expect(res.status).toBe(200);
    expect(conn.query.mock.calls[0][1]).toEqual([sha(TOKEN)]);
    expect(conn.query.mock.calls[0][0]).toMatch(/used_at IS NULL AND expires_at > NOW\(\)/);
    const update = conn.query.mock.calls.find((c) => /UPDATE users SET password_hash/.test(c[0]));
    expect(update[1][0]).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.compareSync("NewPassw0rd!", update[1][0])).toBe(true);
    expect(update[1][1]).toBe(2);
    expect(sqls.some((q) => /UPDATE password_resets SET used_at/.test(q))).toBe(true);
    expect(sqls.some((q) => /UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE user_id/.test(q))).toBe(true);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  test("token ไม่ถูกต้อง/ใช้แล้ว/หมดอายุ: 400 INVALID_RESET_TOKEN และไม่แก้รหัสผ่าน", async () => {
    conn.query.mockResolvedValueOnce([[]]);

    const res = await reset({ token: TOKEN, password: "NewPassw0rd!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_RESET_TOKEN");
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test.each([
    ["รหัสผ่านสั้นเกินไป", { token: "t".repeat(43), password: "short" }],
    ["token สั้นเกินไป", { token: "abc", password: "NewPassw0rd!" }],
    ["ไม่ส่งข้อมูล", {}],
  ])("400 ก่อนแตะฐานข้อมูล: %s", async (_n, body) => {
    const res = await reset(body);

    expect(res.status).toBe(400);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  test("ล้มเหลวกลางทาง: rollback และ 500", async () => {
    conn.query.mockResolvedValueOnce([[{ reset_id: 5, user_id: 2 }]]).mockRejectedValueOnce(new Error("db"));

    const res = await reset({ token: TOKEN, password: "NewPassw0rd!" });

    expect(res.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });
});

describe("จำกัดจำนวนครั้งของลืมรหัสผ่าน", () => {
  test("เกินโควตา (RESET_RATE_LIMIT_MAX) ตอบ 429", async () => {
    process.env.RESET_RATE_LIMIT_MAX = "2";
    let isolated;
    jest.isolateModules(() => {
      jest.doMock("../src/db", () => ({ query: jest.fn().mockResolvedValue([[]]), getConnection: jest.fn() }));
      jest.doMock("../src/services/external-api", () => ({ lookupBookByIsbn: jest.fn() }));
      jest.doMock("../src/services/mailer", () => ({ sendPasswordReset: jest.fn() }));
      isolated = require("../src/index");
      require("../src/db").query.mockResolvedValue([[]]);
    });
    delete process.env.RESET_RATE_LIMIT_MAX;

    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await request(isolated).post("/api/auth/forgot-password").send({ identifier: "x" }); if (r.status === 500) process.stderr.write(JSON.stringify(r.body)+"\n"); codes.push(r.status);
    }

    expect(codes).toEqual([202, 202, 429]);
  });
});
