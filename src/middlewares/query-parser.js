// อ่านพารามิเตอร์ page / limit / sort / order จาก query string (Lab 7)
// ค่าที่ไม่ถูกต้องจะถูกแทนด้วยค่าเริ่มต้น ไม่ทำให้เกิด error และไม่เคยนำข้อความจากผู้ใช้ไปต่อใน SQL

function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parsePagination(query, { defaultLimit = 10, maxLimit = 100 } = {}) {
  const page = Math.max(toInt(query.page) ?? 1, 1);
  const limit = Math.min(Math.max(toInt(query.limit) ?? defaultLimit, 1), maxLimit);

  return { page, limit, offset: (page - 1) * limit };
}

// allowed: { ชื่อที่รับจากผู้ใช้: ชื่อคอลัมน์จริงใน SQL } (allowlist)
function parseSort(query, allowed, defaultKey) {
  const key = Object.hasOwn(allowed, query.sort) ? query.sort : defaultKey;
  const order = String(query.order).toLowerCase() === "desc" ? "DESC" : "ASC";

  return { sort: key, column: allowed[key], order };
}

function buildPagination({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

module.exports = { parsePagination, parseSort, buildPagination };
