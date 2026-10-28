// ทดสอบการยืมพร้อมกันกับระบบจริง (ต้องเปิดระบบและฐานข้อมูลก่อน)
//   node scripts/concurrency-test.js
// ตัวแปร: BASE_URL (ค่าเริ่มต้น http://localhost:8000), ADMIN_USERNAME, ADMIN_PASSWORD
// ทดสอบ 2 เรื่อง: (1) หนังสือเหลือ 1 เล่ม ยิงยืมจาก 20 สมาชิกพร้อมกัน ต้องสำเร็จเพียง 1
//                (2) สมาชิกคนเดียวยืม 8 เล่มพร้อมกัน ต้องสำเร็จไม่เกินเพดาน (MAX_ACTIVE_LOANS)
// ข้อมูลทดสอบถูกคืน/ลบเมื่อจบ (หนังสือและสมาชิกที่เคยยืมจะถูกเก็บเป็นประวัติแบบ soft delete)
const BASE = process.env.BASE_URL || "http://localhost:8000";
const MAX = Number(process.env.MAX_ACTIVE_LOANS) || 5;
const stamp = Date.now();
let token;
let failures = 0;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ไม่มี body */
  }
  return { status: res.status, data };
}

function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures += 1;
}

async function createBook(n) {
  const r = await api("POST", "/api/books", {
    title: `Concurrency Test ${stamp}-${n}`,
    isbn: `CT${stamp}${n}`.slice(0, 20),
    author_id: 1,
  });
  return r.data.data.book_id;
}

async function createMember(n) {
  const r = await api("POST", "/api/members", { name: `CT Member ${n}`, email: `ct${stamp}-${n}@example.com` });
  return r.data.member_id;
}

const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const loan = (book_id, member_id) => api("POST", "/api/loans", { book_id, member_id, due_date: due });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || "admin",
      password: process.env.ADMIN_PASSWORD || "Admin@1234",
    }),
  });
  token = (await login.json()).data?.token;
  if (!token) throw new Error("เข้าสู่ระบบ admin ไม่สำเร็จ ตรวจ ADMIN_PASSWORD");

  const loans = [];
  const books = [];
  const members = [];

  // ---- (1) หนังสือ 1 เล่ม 20 สมาชิก ----
  const lastCopy = await createBook(0);
  books.push(lastCopy);
  const many = [];
  for (let i = 0; i < 20; i += 1) many.push(await createMember(`a${i}`));
  members.push(...many);

  const results = await Promise.all(many.map((m) => loan(lastCopy, m)));
  const okLoans = results.filter((r) => r.status === 201);
  const full = results.filter((r) => r.status === 409);
  loans.push(...okLoans.map((r) => r.data.loan_id));
  check("เล่มสุดท้าย: ยืมสำเร็จเพียง 1 จาก 20 คำขอพร้อมกัน", okLoans.length === 1, `สำเร็จ ${okLoans.length}`);
  check("คำขอที่เหลือได้ 409 (หนังสือหมด) ทั้งหมด", full.length === 19, `409 = ${full.length}`);
  const detail = await api("GET", `/api/books/${lastCopy}`);
  check("available_copies = 0 (ไม่ติดลบ)", detail.data.data.available_copies === 0, `ได้ ${detail.data.data.available_copies}`);

  // ---- (2) สมาชิกคนเดียว ยืม 8 เล่มพร้อมกัน ----
  const solo = await createMember("solo");
  members.push(solo);
  const eight = [];
  for (let i = 1; i <= 8; i += 1) eight.push(await createBook(i));
  books.push(...eight);

  const r2 = await Promise.all(eight.map((b) => loan(b, solo)));
  const ok2 = r2.filter((r) => r.status === 201);
  const limited = r2.filter((r) => r.status === 409 && r.data.code === "LOAN_LIMIT_REACHED");
  loans.push(...ok2.map((r) => r.data.loan_id));
  check(`สมาชิกคนเดียว 8 คำขอพร้อมกัน: สำเร็จ ${MAX} เล่มพอดี (เพดาน)`, ok2.length === MAX, `สำเร็จ ${ok2.length}`);
  check("ที่เหลือถูกปฏิเสธด้วย LOAN_LIMIT_REACHED", limited.length === 8 - MAX, `ปฏิเสธ ${limited.length}`);

  // ---- เก็บกวาด ----
  for (const id of loans) await api("PUT", `/api/loans/${id}/return`);
  for (const b of books) await api("DELETE", `/api/books/${b}`);
  for (const m of members) await api("DELETE", `/api/members/${m}`);
  console.log(`\nเก็บกวาดแล้ว: คืน ${loans.length} รายการ, ลบหนังสือ ${books.length} เล่ม, สมาชิก ${members.length} คน`);
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nผ่านทั้งหมด" : `\nไม่ผ่าน ${failures} ข้อ`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("ผิดพลาด:", err.message);
    process.exit(2);
  });
