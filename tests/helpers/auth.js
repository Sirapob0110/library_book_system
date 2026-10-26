// ตัวช่วยทดสอบ: สร้าง token และเรียก API พร้อม header Authorization
const request = require("supertest");
// ตั้งความลับสำหรับทดสอบก่อนโหลด src/auth (ไม่ขึ้นกับไฟล์ .env ของผู้รัน)
process.env.JWT_SECRET = "test-secret";

const { signToken } = require("../../src/auth");

const admin = { user_id: 1, username: "admin", role: "admin", member_id: null };
const user = { user_id: 2, username: "somchai", role: "user", member_id: 1 };
const otherUser = { user_id: 3, username: "somying", role: "user", member_id: 2 };

const tokenOf = (u) => signToken(u);

// as(app, admin).get("/api/books") = request(app).get(...).set("Authorization", ...)
function as(app, who) {
  const agent = request(app);
  const withAuth = (req) => (who ? req.set("Authorization", `Bearer ${tokenOf(who)}`) : req);

  return {
    get: (url) => withAuth(agent.get(url)),
    post: (url) => withAuth(agent.post(url)),
    put: (url) => withAuth(agent.put(url)),
    delete: (url) => withAuth(agent.delete(url)),
  };
}

module.exports = { admin, user, otherUser, tokenOf, as };
