// ทดสอบตัวตรวจความปลอดภัยตอนเริ่มระบบ และการส่งลิงก์รีเซ็ตรหัสผ่าน
const bcrypt = require("bcryptjs");
const { findSecurityProblems, runSecurityCheck, DEFAULT_ADMIN_PASSWORD } = require("../src/security-check");
const { sendPasswordReset } = require("../src/services/mailer");

const GOOD = "x".repeat(32);
const poolWith = (rows) => ({ query: jest.fn().mockResolvedValue([rows]) });
const adminDefault = [{ username: "admin", password_hash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 4) }];
const adminChanged = [{ username: "admin", password_hash: bcrypt.hashSync("Another#Strong1", 4) }];

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("findSecurityProblems", () => {
  test.each([[undefined], ["short"], ["dev-only-change-me"], ["change-me-to-a-long-random-string"]])(
    "JWT_SECRET %p ถือว่าไม่ปลอดภัย",
    async (secret) => {
      const problems = await findSecurityProblems(poolWith([]), { JWT_SECRET: secret });
      expect(problems.some((p) => p.includes("JWT_SECRET"))).toBe(true);
    },
  );

  test("secret สุ่มยาวพอ + รหัส admin เปลี่ยนแล้ว: ไม่มีปัญหา", async () => {
    expect(await findSecurityProblems(poolWith(adminChanged), { JWT_SECRET: GOOD })).toEqual([]);
  });

  test("admin ยังใช้รหัสผ่านตัวอย่าง: แจ้งพร้อมวิธีแก้", async () => {
    const problems = await findSecurityProblems(poolWith(adminDefault), { JWT_SECRET: GOOD });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("npm run set-password -- admin");
  });

  test("ฐานข้อมูลยังไม่พร้อม: ข้ามส่วน admin ไม่ throw", async () => {
    const pool = { query: jest.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" })) };
    expect(await findSecurityProblems(pool, { JWT_SECRET: GOOD })).toEqual([]);
  });
});

describe("runSecurityCheck", () => {
  test("production + ปัญหา: ไม่ยอมเริ่มระบบ", async () => {
    await expect(runSecurityCheck(poolWith(adminDefault), { JWT_SECRET: GOOD, NODE_ENV: "production" })).rejects.toThrow(
      /ไม่เริ่มระบบใน production/,
    );
  });

  test("production + ALLOW_INSECURE_DEFAULTS=true: เตือนแต่เริ่มได้", async () => {
    const problems = await runSecurityCheck(poolWith(adminDefault), {
      JWT_SECRET: GOOD,
      NODE_ENV: "production",
      ALLOW_INSECURE_DEFAULTS: "true",
    });
    expect(problems).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });

  test("โหมดพัฒนา: เตือนอย่างเดียว ไม่ throw", async () => {
    await expect(runSecurityCheck(poolWith(adminDefault), { JWT_SECRET: "short", NODE_ENV: "development" })).resolves.toHaveLength(2);
  });

  test("production ที่ตั้งค่าถูกต้อง: ผ่าน", async () => {
    await expect(runSecurityCheck(poolWith(adminChanged), { JWT_SECRET: GOOD, NODE_ENV: "production" })).resolves.toEqual([]);
  });
});

describe("sendPasswordReset (mailer)", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  test("โหมดพัฒนา: พิมพ์ลิงก์ลง log (ไม่ส่งกลับ API)", () => {
    process.env.NODE_ENV = "development";
    process.env.FRONTEND_ORIGIN = "http://localhost:5173";

    expect(sendPasswordReset({ username: "u", token: "TOK", expiresMinutes: 30 })).toBe("console");
    expect(console.log.mock.calls[0][0]).toContain("http://localhost:5173/?reset_token=TOK");
  });

  test("ตอนรันเทสต์: ไม่พิมพ์ token ลง log", () => {
    process.env.NODE_ENV = "test";

    expect(sendPasswordReset({ username: "u", token: "TOK", expiresMinutes: 30 })).toBe("console");
    expect(console.log).not.toHaveBeenCalled();
  });

  test("production ที่ไม่ได้ตั้งช่องทางส่ง: เตือนและไม่พิมพ์ token", () => {
    process.env.NODE_ENV = "production";
    delete process.env.RESET_DELIVERY;

    expect(sendPasswordReset({ username: "u", token: "TOK", expiresMinutes: 30 })).toBe("none");
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain("TOK");
  });

  test("production + RESET_DELIVERY=console: พิมพ์ลง log", () => {
    process.env.NODE_ENV = "production";
    process.env.RESET_DELIVERY = "console";

    expect(sendPasswordReset({ username: "u", token: "TOK", expiresMinutes: 30 })).toBe("console");
  });
});
