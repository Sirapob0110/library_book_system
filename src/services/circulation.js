// ชั้นข้อมูลของสมาชิกและการยืม-คืน (Circulation Service)
// ที่นี่มี SQL, transaction และกฎธุรกิจ ส่วน handler ใน src/circulation/index.js แปลงคำขอ/คำตอบเท่านั้น
const db = require("../db");
const cache = require("../cache");

const { ServiceError } = require("./errors");

// กติกาห้องสมุด (ปรับได้ด้วยตัวแปรสภาพแวดล้อม)
const maxActiveLoans = () => Number(process.env.MAX_ACTIVE_LOANS) || 5; // ยืมค้างได้พร้อมกันสูงสุดต่อคน
const finePerDay = () => {
  const raw = process.env.FINE_PER_DAY;
  const value = raw === undefined || raw === "" ? 5 : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 5;
}; // ค่าปรับต่อวันที่เกินกำหนด (บาท) คำนวณจากวันที่ ไม่ได้เก็บในฐานข้อมูล

// ค่าปรับ = จำนวนวันที่เกินกำหนด × อัตราต่อวัน (ไม่ติดลบ)
function withFine(row, daysOverdue) {
  const days = Math.max(0, Number(daysOverdue) || 0);
  return { ...row, days_overdue: days, fine_amount: days * finePerDay() };
}

async function listMembers() {
  const [members] = await db.query(
    `SELECT member_id, name, email, phone
       FROM members
       WHERE deleted_at IS NULL
       ORDER BY member_id DESC`,
  );
  return members;
}

async function createMember(member) {
  const [result] = await db.query(
    `INSERT INTO members (name, email, phone)
       VALUES (?, ?, ?)`,
    [member.name, member.email, member.phone],
  );
  return result.insertId;
}

// คืน null ถ้าไม่พบสมาชิก
async function updateMember(memberId, member) {
  const [existing] = await db.query(
    `SELECT member_id
       FROM members
       WHERE member_id = ? AND deleted_at IS NULL`,
    [memberId],
  );

  if (existing.length === 0) return null;

  await db.query(
    `UPDATE members
       SET name = ?, email = ?, phone = ?
       WHERE member_id = ?`,
    [member.name, member.email, member.phone, memberId],
  );

  const [rows] = await db.query(
    `SELECT member_id, name, email, phone
       FROM members
       WHERE member_id = ?`,
    [memberId],
  );
  return rows[0];
}

// ลบสมาชิก: ถ้ายังมีหนังสือค้างอยู่ปฏิเสธ (409) ถ้ามีประวัติการยืมเก็บแถวไว้และตั้ง deleted_at
// (ปิดบัญชีผู้ใช้ทันที) ถ้าไม่เคยยืมเลยลบจริง คืน { archived } หรือ null ถ้าไม่พบ
async function deleteMember(memberId) {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [members] = await connection.query(
      "SELECT member_id FROM members WHERE member_id = ? AND deleted_at IS NULL FOR UPDATE",
      [memberId],
    );

    if (members.length === 0) {
      await connection.rollback();
      return null;
    }

    const [counts] = await connection.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(return_date IS NULL), 0) AS active
       FROM loans WHERE member_id = ?`,
      [memberId],
    );
    const { total, active } = counts[0];

    if (Number(active) > 0) {
      await connection.rollback();
      throw new ServiceError(409, "สมาชิกยังมีหนังสือที่ยืมอยู่ ต้องคืนให้ครบก่อนจึงลบได้", {
        code: "MEMBER_HAS_ACTIVE_LOANS",
      });
    }

    if (Number(total) > 0) {
      await connection.query("DELETE FROM users WHERE member_id = ?", [memberId]);
      await connection.query("UPDATE members SET deleted_at = NOW() WHERE member_id = ?", [memberId]);
      await connection.commit();
      return { archived: true };
    }

    await connection.query("DELETE FROM members WHERE member_id = ?", [memberId]);
    await connection.commit();
    return { archived: false };
  } catch (error) {
    if (connection && !(error instanceof ServiceError)) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Delete member rollback error:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

// คืน null ถ้าไม่พบสมาชิก
async function getMemberLoans(memberId) {
  const [members] = await db.query(
    `SELECT member_id, name
       FROM members
       WHERE member_id = ?`,
    [memberId],
  );

  if (members.length === 0) return null;

  const [loans] = await db.query(
    `SELECT
         l.loan_id,
         l.book_id,
         b.title,
         l.loan_date,
         l.due_date,
         l.return_date,
         DATEDIFF(COALESCE(l.return_date, CURDATE()), l.due_date) AS days_late
       FROM loans l
       JOIN books b ON b.book_id = l.book_id
       WHERE l.member_id = ?
       ORDER BY l.loan_id DESC`,
    [memberId],
  );

  return {
    member: members[0],
    loans: loans.map(({ days_late, ...row }) => withFine(row, days_late)),
  };
}

async function listOverdueLoans() {
  const [loans] = await db.query(
    `SELECT
         l.loan_id,
         l.member_id,
         m.name AS member_name,
         l.book_id,
         b.title,
         l.loan_date,
         l.due_date,
         DATEDIFF(CURDATE(), l.due_date) AS days_late
       FROM loans l
       JOIN members m ON m.member_id = l.member_id
       JOIN books b ON b.book_id = l.book_id
       WHERE l.due_date < CURDATE()
         AND l.return_date IS NULL
       ORDER BY l.due_date ASC`,
  );
  return loans.map(({ days_late, ...row }) => withFine(row, days_late));
}

// ยืมหนังสือใน transaction เดียว: ล็อกแถวหนังสือ ตรวจจำนวนคงเหลือ เพิ่มรายการ แล้วลดจำนวน
async function createLoan({ bookId, memberId, loanDate, dueDate }) {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // ล็อกแถวสมาชิกก่อน เพื่อให้การนับเล่มที่ค้างอยู่ต่อคนเป็นลำดับเดียวกัน (กันยืมพร้อมกันหลายเล่มจนเกินเพดาน)
    const [members] = await connection.query(
      "SELECT member_id FROM members WHERE member_id = ? AND deleted_at IS NULL FOR UPDATE",
      [memberId],
    );

    if (members.length === 0) {
      await connection.rollback();
      throw new ServiceError(404, "ไม่พบสมาชิก");
    }

    const [active] = await connection.query(
      "SELECT COUNT(*) AS n FROM loans WHERE member_id = ? AND return_date IS NULL",
      [memberId],
    );

    if (Number(active[0].n) >= maxActiveLoans()) {
      await connection.rollback();
      throw new ServiceError(
        409,
        `ยืมหนังสือค้างอยู่ครบ ${maxActiveLoans()} เล่มแล้ว กรุณาคืนก่อนยืมเพิ่ม`,
        { code: "LOAN_LIMIT_REACHED" },
      );
    }

    const [books] = await connection.query(
      `SELECT book_id, total_copies, available_copies
       FROM books
       WHERE book_id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [bookId],
    );

    if (books.length === 0) {
      await connection.rollback();
      throw new ServiceError(404, "ไม่พบหนังสือ");
    }

    if (Number(books[0].available_copies) <= 0) {
      await connection.rollback();
      throw new ServiceError(409, "หนังสือหมด ไม่มีเล่มให้ยืม");
    }

    const [result] = await connection.query(
      `INSERT INTO loans (book_id, member_id, loan_date, due_date)
       VALUES (?, ?, ?, ?)`,
      [bookId, memberId, loanDate, dueDate],
    );

    await connection.query(
      `UPDATE books
       SET available_copies = available_copies - 1
       WHERE book_id = ?`,
      [bookId],
    );

    await connection.commit();
    // จำนวนคงเหลือเปลี่ยนแล้ว ล้าง cache รายการหนังสือของ Book API (ใช้ได้เมื่อสองบริการใช้ Redis ร่วมกัน)
    await cache.invalidate("books:");

    return result.insertId;
  } catch (error) {
    if (connection && !(error instanceof ServiceError)) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Loan rollback error:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

// คืนหนังสือ: actor คือผู้เรียก (user คืนได้เฉพาะรายการของตัวเอง)
async function returnLoan(loanId, actor) {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [loans] = await connection.query(
      `SELECT loan_id, book_id, member_id, return_date,
              DATEDIFF(CURDATE(), due_date) AS days_late
       FROM loans
       WHERE loan_id = ?
       FOR UPDATE`,
      [loanId],
    );

    if (loans.length === 0) {
      await connection.rollback();
      throw new ServiceError(404, "ไม่พบรายการยืม");
    }

    if (actor.role !== "admin" && loans[0].member_id !== actor.member_id) {
      await connection.rollback();
      throw new ServiceError(403, "คืนได้เฉพาะรายการยืมของตัวเอง", { kind: "deny" });
    }

    if (loans[0].return_date) {
      await connection.rollback();
      throw new ServiceError(409, "หนังสือรายการนี้ถูกคืนแล้ว");
    }

    await connection.query(
      `UPDATE loans
       SET return_date = CURDATE()
       WHERE loan_id = ?`,
      [loanId],
    );

    await connection.query(
      `UPDATE books
       SET available_copies =
         LEAST(total_copies, available_copies + 1)
       WHERE book_id = ?`,
      [loans[0].book_id],
    );

    await connection.commit();
    await cache.invalidate("books:");

    return withFine({}, loans[0].days_late);
  } catch (error) {
    if (connection && !(error instanceof ServiceError)) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Return rollback error:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  ServiceError,
  maxActiveLoans,
  finePerDay,
  listMembers,
  createMember,
  updateMember,
  deleteMember,
  getMemberLoans,
  listOverdueLoans,
  createLoan,
  returnLoan,
};
