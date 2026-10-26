// ทดสอบชั้น cache (Lab 7): แบบหน่วยความจำ (TTL, ล้างตาม prefix, จำกัดขนาด) และแบบ Redis (จำลอง client)
jest.mock("redis", () => ({ createClient: jest.fn() }));

const { createClient } = require("redis");

function loadCache() {
  let cache;
  jest.isolateModules(() => {
    cache = require("../src/cache");
  });
  return cache;
}

function fakeRedis(overrides = {}) {
  const store = new Map();

  return {
    isReady: true,
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(async (key) => store.get(key) ?? null),
    set: jest.fn(async (key, value) => void store.set(key, value)),
    del: jest.fn(async (keys) => keys.forEach((k) => store.delete(k))),
    scanIterator: jest.fn(async function* ({ MATCH }) {
      const prefix = MATCH.slice(0, -1);
      for (const key of store.keys()) if (key.startsWith(prefix)) yield key;
    }),
    quit: jest.fn().mockResolvedValue(undefined),
    store,
    ...overrides,
  };
}

describe("cache ในหน่วยความจำ", () => {
  let cache;

  beforeEach(() => {
    jest.useFakeTimers();
    cache = loadCache();
    jest.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.REDIS_URL;
  });

  afterEach(async () => {
    await cache.closeCache();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("ไม่ตั้ง REDIS_URL: ใช้หน่วยความจำ และ isShared เป็น false", async () => {
    await cache.connectCache();

    expect(cache.isShared()).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  test("เก็บและอ่านค่าได้ ค่าที่ไม่มีคืน null", async () => {
    await cache.set("k", { a: 1 }, 60);

    expect(await cache.get("k")).toEqual({ a: 1 });
    expect(await cache.get("missing")).toBeNull();
  });

  test("ค่าหมดอายุตาม TTL", async () => {
    await cache.set("k", "v", 60);

    jest.advanceTimersByTime(59_000);
    expect(await cache.get("k")).toBe("v");

    jest.advanceTimersByTime(2_000);
    expect(await cache.get("k")).toBeNull();
  });

  test("ล้างเฉพาะ key ที่ขึ้นต้นด้วย prefix", async () => {
    await cache.set("books:a", 1, 60);
    await cache.set("books:b", 2, 60);
    await cache.set("authors:all", 3, 60);

    await cache.invalidate("books:");

    expect(await cache.get("books:a")).toBeNull();
    expect(await cache.get("books:b")).toBeNull();
    expect(await cache.get("authors:all")).toBe(3);
  });

  test("invalidate ด้วย prefix ว่างล้างทั้งหมด", async () => {
    await cache.set("a", 1, 60);
    await cache.set("b", 2, 60);

    await cache.invalidate("");

    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBeNull();
  });

  test("remember: ครั้งแรกเรียก loader (database) ครั้งต่อไปอ่านจาก cache", async () => {
    const loader = jest.fn().mockResolvedValue([1, 2, 3]);

    const first = await cache.remember("list", 60, loader);
    const second = await cache.remember("list", 60, loader);

    expect(first).toEqual({ value: [1, 2, 3], source: "database" });
    expect(second).toEqual({ value: [1, 2, 3], source: "cache" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("remember: หลังหมดอายุเรียก loader ใหม่", async () => {
    const loader = jest.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");

    await cache.remember("k", 10, loader);
    jest.advanceTimersByTime(11_000);
    const again = await cache.remember("k", 10, loader);

    expect(again).toEqual({ value: "new", source: "database" });
  });

  test("remember: ถ้า loader ล้มเหลวไม่เก็บอะไรใน cache และส่งต่อ error", async () => {
    await expect(cache.remember("k", 10, () => Promise.reject(new Error("db down")))).rejects.toThrow(
      "db down",
    );
    expect(await cache.get("k")).toBeNull();
  });

  test("จำกัดขนาด: เกิน 500 รายการลบรายการเก่าสุดทิ้ง", async () => {
    for (let i = 0; i < 501; i += 1) await cache.set(`k${i}`, i, 600);

    expect(await cache.get("k0")).toBeNull();
    expect(await cache.get("k500")).toBe(500);
    expect(await cache.get("k1")).toBe(1);
  });

  test("จำกัดขนาด: ล้างรายการที่หมดอายุก่อนจะลบรายการที่ยังใช้ได้", async () => {
    for (let i = 0; i < 500; i += 1) await cache.set(`old${i}`, i, 1);
    jest.advanceTimersByTime(2_000);

    await cache.set("fresh", "x", 60);

    expect(await cache.get("fresh")).toBe("x");
  });

  test("closeCache ล้างข้อมูลและปิดได้แม้ไม่ได้เชื่อม Redis", async () => {
    await cache.set("k", 1, 60);
    await cache.closeCache();

    expect(await cache.get("k")).toBeNull();
  });
});

describe("cache แบบ Redis", () => {
  let cache;
  let redis;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env.REDIS_URL = "redis://localhost:6379";
    redis = fakeRedis();
    createClient.mockReturnValue(redis);
    cache = loadCache();
    await cache.connectCache();
  });

  afterEach(async () => {
    delete process.env.REDIS_URL;
    await cache.closeCache();
    jest.restoreAllMocks();
  });

  test("เชื่อมต่อสำเร็จ: isShared เป็น true และตั้งค่า client ตามที่กำหนด", () => {
    expect(cache.isShared()).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: "redis://localhost:6379" }),
    );
    expect(redis.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  test("reconnectStrategy ลองใหม่ 2 ครั้งแล้วหยุด", () => {
    const { socket } = createClient.mock.calls[0][0];

    expect(socket.reconnectStrategy(0)).toBe(200);
    expect(socket.reconnectStrategy(1)).toBe(200);
    expect(socket.reconnectStrategy(2)).toBeInstanceOf(Error);
  });

  test("handler ของ event error บันทึก log ไม่ throw", () => {
    const handler = redis.on.mock.calls.find(([event]) => event === "error")[1];

    expect(() => handler(new Error("boom"))).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  test("set เก็บเป็น JSON พร้อม TTL (EX) และ get แปลงกลับ", async () => {
    await cache.set("k", { a: [1, 2] }, 60);

    expect(redis.set).toHaveBeenCalledWith("k", '{"a":[1,2]}', { EX: 60 });
    expect(await cache.get("k")).toEqual({ a: [1, 2] });
    expect(await cache.get("none")).toBeNull();
  });

  test("invalidate ลบ key ตาม prefix ด้วย SCAN + DEL", async () => {
    await cache.set("books:1", 1, 60);
    await cache.set("books:2", 2, 60);
    await cache.set("authors:all", 3, 60);

    await cache.invalidate("books:");

    expect(redis.del).toHaveBeenCalledWith(["books:1", "books:2"]);
    expect(await cache.get("authors:all")).toBe(3);
  });

  test("invalidate ไม่เรียก DEL เมื่อไม่มี key ที่ตรง", async () => {
    await cache.invalidate("nothing:");

    expect(redis.del).not.toHaveBeenCalled();
  });

  test("invalidate รองรับ SCAN ที่คืน key เป็นกลุ่ม", async () => {
    redis.scanIterator = jest.fn(async function* () {
      yield ["books:1", "books:2"];
    });

    await cache.invalidate("books:");

    expect(redis.del).toHaveBeenCalledWith(["books:1", "books:2"]);
  });

  test("Redis ผิดพลาดตอน get: ถือเป็น cache miss ไม่ throw", async () => {
    redis.get.mockRejectedValue(new Error("conn lost"));

    expect(await cache.get("k")).toBeNull();
    const { source } = await cache.remember("k", 10, async () => "fromDb");
    expect(source).toBe("database");
  });

  test("Redis ผิดพลาดตอน set และ invalidate: ไม่ throw", async () => {
    redis.set.mockRejectedValue(new Error("x"));
    redis.scanIterator = jest.fn(() => {
      throw new Error("scan failed");
    });

    await expect(cache.set("k", 1, 10)).resolves.toBeUndefined();
    await expect(cache.invalidate("books:")).resolves.toBeUndefined();
  });

  test("closeCache ปิดการเชื่อมต่อ และกลับไปเป็น cache ในหน่วยความจำ", async () => {
    await cache.closeCache();

    expect(redis.quit).toHaveBeenCalled();
    expect(cache.isShared()).toBe(false);
  });

  test("closeCache ไม่ throw แม้ quit ล้มเหลว", async () => {
    redis.quit.mockRejectedValue(new Error("already closed"));

    await expect(cache.closeCache()).resolves.toBeUndefined();
  });
});

describe("เชื่อมต่อ Redis ไม่ได้", () => {
  test("ใช้หน่วยความจำแทนและแจ้งเตือน ระบบไม่ล้ม", async () => {
    jest.resetAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    process.env.REDIS_URL = "redis://nowhere:6379";
    createClient.mockReturnValue(fakeRedis({ connect: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) }));
    const cache = loadCache();

    await cache.connectCache();
    await cache.set("k", 1, 60);

    expect(cache.isShared()).toBe(false);
    expect(await cache.get("k")).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ใช้ cache ในหน่วยความจำแทน"));

    delete process.env.REDIS_URL;
    jest.restoreAllMocks();
  });
});
