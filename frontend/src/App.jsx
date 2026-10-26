import { useEffect, useRef, useState } from "react";
import "./App.css";

// อ่าน API URLs จาก Environment Variables ของ Vite
function getApiUrl(value, name) {
  const url = value?.trim();

  if (!url) {
    throw new Error(
      `ไม่พบ ${name} กรุณาตั้งค่าในไฟล์ frontend/.env.local แล้วเริ่ม Vite ใหม่`,
    );
  }

  return url.replace(/\/+$/, "");
}

const BOOK_API = getApiUrl(
  import.meta.env.VITE_BOOK_API_URL,
  "VITE_BOOK_API_URL",
);

const CIRCULATION_API = getApiUrl(
  import.meta.env.VITE_CIRCULATION_API_URL,
  "VITE_CIRCULATION_API_URL",
);

const VALID_TABS = ["books", "members", "borrow", "history"];

// วันนี้ตามเวลาเครื่องผู้ใช้ รูปแบบ YYYY-MM-DD (ไม่ใช้ toISOString เพราะเป็นเวลา UTC
// ทำให้ช่วงเที่ยงคืนถึง 07:00 ของไทยได้วันที่เมื่อวาน)
function getToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getSavedTab() {
  try {
    const savedTab = localStorage.getItem("library_active_tab");
    return VALID_TABS.includes(savedTab) ? savedTab : "books";
  } catch {
    return "books";
  }
}

function App() {
  const [tab, setTab] = useState(getSavedTab);
  const [books, setBooks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [loading, setLoading] = useState(false);
  const [today] = useState(getToday); // ใช้เป็นวันที่ต่ำสุดของช่องวันกำหนดคืน
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingMemberId, setEditingMemberId] = useState(null);

  const statusTimerRef = useRef(null);

  const [memberForm, setMemberForm] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [loanForm, setLoanForm] = useState({
    book_id: "",
    member_id: "",
    due_date: "",
  });

  // จำหน้าที่เปิดล่าสุด
  useEffect(() => {
    try {
      localStorage.setItem("library_active_tab", tab);
    } catch {
      // เว็บยังทำงานต่อได้หากใช้ localStorage ไม่ได้
    }
  }, [tab]);

  // แสดงข้อความสถานะเป็นเวลา 3 วินาที
  function showStatus(type, text) {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
    }

    if (type === "success") {
      setError("");
      setMessage(text);
    } else {
      setMessage("");
      setError(text);
    }

    statusTimerRef.current = setTimeout(() => {
      setMessage("");
      setError("");
      statusTimerRef.current = null;
    }, 3000);
  }

  // ล้างตัวจับเวลาเมื่อออกจากหน้า
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  // ฟังก์ชันกลางสำหรับเรียก API
  async function request(url, options = {}) {
    let response;

    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new Error(
        "ไม่สามารถเชื่อมต่อ API ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่และ URL ถูกต้อง",
      );
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error ||
          result.message ||
          `API ตอบกลับด้วย HTTP ${response.status}`,
      );
    }

    if (result.success === false) {
      throw new Error(result.error || result.message || "คำขอไม่สำเร็จ");
    }

    return result;
  }

  // โหลดหนังสือจาก Catalog Service
  async function loadBooks() {
    const result = await request(`${BOOK_API}/api/books`);

    const bookList = Array.isArray(result)
      ? result
      : Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.books)
          ? result.books
          : [];

    setBooks(bookList);
  }

  // โหลดสมาชิกจาก Circulation Service
  async function loadMembers() {
    const result = await request(`${CIRCULATION_API}/api/members`);
    const memberList = Array.isArray(result.data) ? result.data : [];

    setMembers(memberList);
    return memberList;
  }

  // โหลดประวัติการยืมของสมาชิก
  async function loadLoans(memberId) {
    if (!memberId) {
      setLoans([]);
      return;
    }

    const result = await request(
      `${CIRCULATION_API}/api/members/${encodeURIComponent(memberId)}/loans`,
    );

    setLoans(Array.isArray(result.data) ? result.data : []);
  }

  // โหลดข้อมูลหนังสือและสมาชิก
  async function refreshData() {
    setLoading(true);

    try {
      const results = await Promise.allSettled([loadBooks(), loadMembers()]);

      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason?.message || "โหลดข้อมูลไม่สำเร็จ");

      if (errors.length > 0) {
        showStatus("error", errors.join(" | "));
        return false;
      }

      return true;
    } catch (err) {
      showStatus("error", err.message || "โหลดข้อมูลไม่สำเร็จ");
      return false;
    } finally {
      setLoading(false);
    }
  }

  // โหลดข้อมูลเมื่อเปิดเว็บ (ดึงข้อมูลจาก API ภายนอกตอน mount จึงต้องตั้ง loading ใน effect)
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    refreshData();
  }, []);

  // รีเซ็ตฟอร์มสมาชิก
  function resetMemberForm() {
    setMemberForm({
      name: "",
      email: "",
      phone: "",
    });

    setEditingMemberId(null);
  }

  // เพิ่มสมาชิก
  async function addMember(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await request(`${CIRCULATION_API}/api/members`, {
        method: "POST",
        body: JSON.stringify({
          name: memberForm.name.trim(),
          email: memberForm.email.trim(),
          phone: memberForm.phone.trim() || null,
        }),
      });

      resetMemberForm();
      await loadMembers();

      showStatus("success", "เพิ่มสมาชิกสำเร็จ");
    } catch (err) {
      showStatus("error", err.message || "เพิ่มสมาชิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // เลือกสมาชิกเพื่อแก้ไข
  function startEditMember(member) {
    setEditingMemberId(member.member_id);

    setMemberForm({
      name: member.name || "",
      email: member.email || "",
      phone: member.phone || "",
    });

    setError("");
    setMessage("");

    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // บันทึกการแก้ไขสมาชิก
  async function updateMember(event) {
    event.preventDefault();

    if (editingMemberId === null) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await request(
        `${CIRCULATION_API}/api/members/${encodeURIComponent(editingMemberId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: memberForm.name.trim(),
            email: memberForm.email.trim(),
            phone: memberForm.phone.trim() || null,
          }),
        },
      );

      resetMemberForm();
      await loadMembers();

      if (selectedMemberId) {
        await loadLoans(selectedMemberId);
      }

      showStatus("success", "แก้ไขข้อมูลสมาชิกสำเร็จ");
    } catch (err) {
      showStatus("error", err.message || "แก้ไขสมาชิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // ลบสมาชิก
  async function deleteMember(member) {
    const confirmed = window.confirm(
      `คุณต้องการลบสมาชิก "${member.name}" (ID: ${member.member_id}) ใช่หรือไม่?`,
    );

    if (!confirmed) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      await request(
        `${CIRCULATION_API}/api/members/${encodeURIComponent(member.member_id)}`,
        { method: "DELETE" },
      );

      if (String(selectedMemberId) === String(member.member_id)) {
        setSelectedMemberId("");
        setLoans([]);
      }

      if (String(loanForm.member_id) === String(member.member_id)) {
        setLoanForm((previous) => ({
          ...previous,
          member_id: "",
        }));
      }

      if (String(editingMemberId) === String(member.member_id)) {
        resetMemberForm();
      }

      await loadMembers();

      showStatus("success", `ลบสมาชิก "${member.name}" สำเร็จ`);
    } catch (err) {
      showStatus("error", err.message || "ลบสมาชิกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // ยืมหนังสือ
  async function borrowBook(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const today = getToday();

      if (!loanForm.book_id || !loanForm.member_id || !loanForm.due_date) {
        throw new Error("กรุณากรอกข้อมูลการยืมให้ครบถ้วน");
      }

      if (loanForm.due_date < today) {
        throw new Error("วันกำหนดคืนต้องไม่เป็นวันที่ผ่านมาแล้ว");
      }

      await request(`${CIRCULATION_API}/api/loans`, {
        method: "POST",
        body: JSON.stringify({
          book_id: Number(loanForm.book_id),
          member_id: Number(loanForm.member_id),
          loan_date: today,
          due_date: loanForm.due_date,
        }),
      });

      const memberId = loanForm.member_id;

      setLoanForm({
        book_id: "",
        member_id: "",
        due_date: "",
      });

      const refreshed = await refreshData();

      if (!refreshed) {
        showStatus(
          "success",
          "ยืมหนังสือสำเร็จ แต่โหลดข้อมูลล่าสุดไม่ครบ กรุณารีเฟรชข้อมูล",
        );
        return;
      }

      if (memberId) {
        setSelectedMemberId(memberId);
        await loadLoans(memberId);
      }

      showStatus("success", "ยืมหนังสือสำเร็จ");
    } catch (err) {
      showStatus("error", err.message || "ยืมหนังสือไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // เลือกสมาชิกเพื่อดูประวัติ
  async function showLoans(memberId) {
    setSelectedMemberId(memberId);
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await loadLoans(memberId);
    } catch (err) {
      showStatus("error", err.message || "โหลดประวัติการยืมไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  // คืนหนังสือ
  async function returnBook(loanId) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await request(
        `${CIRCULATION_API}/api/loans/${encodeURIComponent(loanId)}/return`,
        { method: "PUT" },
      );

      const refreshed = await refreshData();

      if (selectedMemberId) {
        await loadLoans(selectedMemberId);
      }

      if (!refreshed) {
        showStatus(
          "success",
          "คืนหนังสือสำเร็จ แต่โหลดข้อมูลล่าสุดไม่ครบ กรุณารีเฟรชข้อมูล",
        );
        return;
      }

      showStatus("success", "คืนหนังสือสำเร็จ");
    } catch (err) {
      showStatus("error", err.message || "คืนหนังสือไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LIBRARY MANAGEMENT SYSTEM</p>
          <h1>
            Library<span>Hub</span>
          </h1>
          <p className="subtitle">ระบบจัดการหนังสือ สมาชิก และการยืม–คืน</p>
        </div>

        <button
          className="refresh-button"
          onClick={refreshData}
          disabled={loading}
        >
          ↻ รีเฟรชข้อมูล
        </button>
      </header>

      <section className="status-row">
        <div className="status-card">
          <span>หนังสือที่โหลดได้</span>
          <strong>{books.length}</strong>
        </div>

        <div className="status-card">
          <span>สมาชิกทั้งหมด</span>
          <strong>{members.length}</strong>
        </div>

        <div className="status-card">
          <span>สถานะระบบ</span>
          <strong className="online">● API Client</strong>
        </div>
      </section>

      {error && (
        <div className="alert error" role="alert">
          ⚠ {error}
        </div>
      )}

      {message && (
        <div className="alert success" role="status">
          ✓ {message}
        </div>
      )}

      {loading && (
        <div className="loading" role="status">
          กำลังโหลดหรือประมวลผลข้อมูล...
        </div>
      )}

      <nav className="tabs">
        <button
          className={tab === "books" ? "active" : ""}
          onClick={() => setTab("books")}
        >
          หนังสือ
        </button>

        <button
          className={tab === "members" ? "active" : ""}
          onClick={() => setTab("members")}
        >
          สมาชิก
        </button>

        <button
          className={tab === "borrow" ? "active" : ""}
          onClick={() => setTab("borrow")}
        >
          ยืมหนังสือ
        </button>

        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          ประวัติ / คืน
        </button>
      </nav>

      {/* รายการหนังสือ */}
      {tab === "books" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CATALOG SERVICE</p>
              <h2>รายการหนังสือ</h2>
            </div>

            <span className="count">{books.length} รายการ</span>
          </div>

          {books.length === 0 && !loading ? (
            <p className="empty">
              ไม่พบข้อมูลหนังสือ หากมีข้อผิดพลาดจะแสดงข้อความด้านบน
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>ชื่อหนังสือ</th>
                    <th>ผู้แต่ง</th>
                    <th>ปีที่พิมพ์</th>
                    <th>ISBN</th>
                    <th>ราคา</th>
                    <th>จำนวนคงเหลือ</th>
                  </tr>
                </thead>

                <tbody>
                  {books.map((book) => (
                    <tr key={book.book_id}>
                      <td>{book.book_id}</td>
                      <td>{book.title}</td>
                      <td>{book.author_name || "-"}</td>
                      <td>{book.published_year || "-"}</td>
                      <td>{book.isbn || "-"}</td>
                      <td>
                        {book.price != null
                          ? `${Number(book.price).toLocaleString("th-TH")} บาท`
                          : "-"}
                      </td>
                      <td>{book.available_copies ?? "API ไม่ส่งข้อมูล"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* จัดการสมาชิก */}
      {tab === "members" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MEMBER MANAGEMENT</p>
              <h2>สมาชิกห้องสมุด</h2>
            </div>

            <span className="count">{members.length} สมาชิก</span>
          </div>

          <form
            className="form-grid"
            onSubmit={editingMemberId !== null ? updateMember : addMember}
          >
            <label>
              ชื่อสมาชิก *
              <input
                value={memberForm.name}
                onChange={(e) =>
                  setMemberForm({ ...memberForm, name: e.target.value })
                }
                required
                minLength={2}
                placeholder="ชื่อ-นามสกุล"
              />
            </label>

            <label>
              อีเมล *
              <input
                type="email"
                value={memberForm.email}
                onChange={(e) =>
                  setMemberForm({ ...memberForm, email: e.target.value })
                }
                required
                placeholder="name@example.com"
              />
            </label>

            <label>
              เบอร์โทรศัพท์
              <input
                type="tel"
                value={memberForm.phone}
                onChange={(e) =>
                  setMemberForm({ ...memberForm, phone: e.target.value })
                }
                placeholder="08xxxxxxxx"
              />
            </label>

            <div className="member-form-actions">
              <button
                className="primary-button"
                disabled={loading}
                type="submit"
              >
                {editingMemberId !== null ? "บันทึกการแก้ไข" : "+ เพิ่มสมาชิก"}
              </button>

              {editingMemberId !== null && (
                <button
                  className="cancel-button"
                  type="button"
                  onClick={resetMemberForm}
                  disabled={loading}
                >
                  ยกเลิก
                </button>
              )}
            </div>
          </form>

          <h3>สมาชิกทั้งหมด</h3>

          <div className="member-list">
            {members.map((member) => (
              <div className="member-item" key={member.member_id}>
                <div className="avatar">{member.name?.charAt(0) || "M"}</div>

                <div className="member-info">
                  <strong>{member.name}</strong>
                  <p>
                    {member.email} · {member.phone || "ไม่มีเบอร์โทร"}
                  </p>
                  <p>รหัสสมาชิก: {member.member_id}</p>
                </div>

                <div className="member-actions">
                  <button
                    type="button"
                    className="edit-button"
                    disabled={loading}
                    onClick={() => startEditMember(member)}
                  >
                    แก้ไข
                  </button>

                  <button
                    type="button"
                    className="delete-button"
                    disabled={loading}
                    onClick={() => deleteMember(member)}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}

            {members.length === 0 && (
              <p className="empty">ยังไม่มีข้อมูลสมาชิก</p>
            )}
          </div>
        </section>
      )}

      {/* ยืมหนังสือ */}
      {tab === "borrow" && (
        <section className="panel">
          <p className="eyebrow">CIRCULATION SERVICE</p>
          <h2>ยืมหนังสือ</h2>

          <form className="form-grid" onSubmit={borrowBook}>
            <label>
              หนังสือ *
              <select
                value={loanForm.book_id}
                onChange={(e) =>
                  setLoanForm({ ...loanForm, book_id: e.target.value })
                }
                required
              >
                <option value="">เลือกหนังสือ</option>

                {books.map((book) => (
                  <option
                    key={book.book_id}
                    value={book.book_id}
                    disabled={Number(book.available_copies ?? 1) <= 0}
                  >
                    #{book.book_id} — {book.title} (คงเหลือ:{" "}
                    {book.available_copies ?? "ไม่ระบุ"})
                  </option>
                ))}
              </select>
            </label>

            <label>
              สมาชิก *
              <select
                value={loanForm.member_id}
                onChange={(e) =>
                  setLoanForm({ ...loanForm, member_id: e.target.value })
                }
                required
              >
                <option value="">เลือกสมาชิก</option>

                {members.map((member) => (
                  <option key={member.member_id} value={member.member_id}>
                    #{member.member_id} — {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              วันกำหนดคืน *
              <input
                type="date"
                value={loanForm.due_date}
                min={today}
                onChange={(e) =>
                  setLoanForm({ ...loanForm, due_date: e.target.value })
                }
                required
              />
            </label>

            <button
              className="primary-button"
              disabled={loading || books.length === 0 || members.length === 0}
              type="submit"
            >
              ยืนยันการยืม
            </button>
          </form>

          <p className="hint">
            ระบบจะบันทึกการยืมและปรับจำนวนหนังสือในฐานข้อมูล หากหนังสือหมด ระบบ
            API จะปฏิเสธรายการ
          </p>
        </section>
      )}

      {/* ประวัติและคืนหนังสือ */}
      {tab === "history" && (
        <section className="panel">
          <p className="eyebrow">LOAN HISTORY</p>
          <h2>ประวัติการยืมและคืน</h2>

          <label className="history-select">
            เลือกสมาชิก
            <select
              value={selectedMemberId}
              onChange={(e) => showLoans(e.target.value)}
            >
              <option value="">เลือกสมาชิกเพื่อดูประวัติ</option>

              {members.map((member) => (
                <option key={member.member_id} value={member.member_id}>
                  #{member.member_id} — {member.name}
                </option>
              ))}
            </select>
          </label>

          {loans.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Loan ID</th>
                    <th>หนังสือ</th>
                    <th>วันที่ยืม</th>
                    <th>กำหนดคืน</th>
                    <th>สถานะ</th>
                    <th>จัดการ</th>
                  </tr>
                </thead>

                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.loan_id}>
                      <td>{loan.loan_id}</td>
                      <td>{loan.title}</td>
                      <td>{String(loan.loan_date).slice(0, 10)}</td>
                      <td>{String(loan.due_date).slice(0, 10)}</td>
                      <td>
                        {loan.return_date ? (
                          <span className="returned">คืนแล้ว</span>
                        ) : (
                          <span className="borrowed">กำลังยืม</span>
                        )}
                      </td>
                      <td>
                        {!loan.return_date && (
                          <button
                            className="return-button"
                            disabled={loading}
                            onClick={() => returnBook(loan.loan_id)}
                          >
                            คืนหนังสือ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">
              {selectedMemberId
                ? "สมาชิกคนนี้ยังไม่มีประวัติการยืม"
                : "เลือกสมาชิกเพื่อดูประวัติการยืม"}
            </p>
          )}
        </section>
      )}

      <footer>
        <span>LibraryHub · Phase 3 Integration</span>
        <span>Catalog :3000 · Circulation :3001</span>
      </footer>
    </main>
  );
}

export default App;
