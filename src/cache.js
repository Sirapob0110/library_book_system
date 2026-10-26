// ชั้น cache พร้อม TTL (Lab 7)
// - ตั้ง REDIS_URL แล้วใช้ Redis (ใช้ร่วมกันได้ทุกบริการและทุก instance)
// - ไม่ตั้ง หรือเชื่อมต่อไม่ได้ ใช้ Map ในหน่วยความจำของ process นั้นแทน ระบบยังทำงานได้
// ข้อผิดพลาดของ cache ไม่เคยทำให้คำขอล้มเหลว: ถือว่า cache miss แล้วอ่านจากฐานข้อมูลตามปกติ
const memory = new Map(); // key -> { value, expiresAt }
let client = null; // redis client เมื่อเชื่อมต่อสำเร็จ

const MAX_MEMORY_ENTRIES = 500;

async function connectCache() {
  const url = process.env.REDIS_URL;

  if (!url) {
    console.log("[cache] ไม่ได้ตั้ง REDIS_URL ใช้ cache ในหน่วยความจำ");
    return;
  }

  try {
    const { createClient } = require("redis");
    const redis = createClient({
      url,
      socket: {
        connectTimeout: 2000,
        // ลองใหม่ 2 ครั้งแล้วหยุด ไม่ให้ค้างตอนเริ่มระบบ
        reconnectStrategy: (retries) => (retries >= 2 ? new Error("redis unavailable") : 200),
      },
    });

    redis.on("error", (err) => console.error("[cache] Redis error:", err.message));
    await redis.connect();
    client = redis;
    console.log("[cache] เชื่อมต่อ Redis สำเร็จ");
  } catch (err) {
    client = null;
    console.warn(`[cache] เชื่อมต่อ Redis ไม่ได้ (${err.message}) ใช้ cache ในหน่วยความจำแทน`);
  }
}

// true เมื่อใช้ Redis ซึ่งหลายบริการเห็นข้อมูลชุดเดียวกัน (จำเป็นสำหรับ cache ที่สองบริการต้องล้างร่วมกัน)
function isShared() {
  return client !== null && client.isReady;
}

async function get(key) {
  try {
    if (isShared()) {
      const raw = await client.get(key);
      return raw === null ? null : JSON.parse(raw);
    }
  } catch (err) {
    console.error("[cache] get ล้มเหลว:", err.message);
    return null;
  }

  const entry = memory.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }

  return entry.value;
}

async function set(key, value, ttlSeconds) {
  try {
    if (isShared()) {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    }
  } catch (err) {
    console.error("[cache] set ล้มเหลว:", err.message);
    return;
  }

  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const now = Date.now();
    for (const [k, entry] of memory) if (entry.expiresAt <= now) memory.delete(k);
    if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  }

  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ลบ key ตาม prefix เช่น "books:" ใช้เมื่อข้อมูลต้นทางเปลี่ยน
async function invalidate(prefix) {
  try {
    if (isShared()) {
      const keys = [];
      for await (const found of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
        // redis v4 คืนทีละ key, v5 คืนเป็นกลุ่ม
        if (Array.isArray(found)) keys.push(...found);
        else keys.push(found);
      }
      if (keys.length) await client.del(keys);
      return;
    }
  } catch (err) {
    console.error("[cache] invalidate ล้มเหลว:", err.message);
    return;
  }

  for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
}

// อ่านจาก cache ถ้าไม่มีเรียก loader แล้วเก็บผลไว้ คืน { value, source: "cache" | "database" }
async function remember(key, ttlSeconds, loader) {
  const hit = await get(key);
  if (hit !== null) return { value: hit, source: "cache" };

  const value = await loader();
  await set(key, value, ttlSeconds);
  return { value, source: "database" };
}

async function closeCache() {
  memory.clear();
  if (client) {
    try {
      await client.quit();
    } catch {
      // ปิดอยู่แล้ว
    }
    client = null;
  }
}

module.exports = { connectCache, closeCache, isShared, get, set, invalidate, remember };
