import { useEffect, useRef, useState } from "react";
import "./App.css";
import AdminCatalog from "./AdminCatalog";
import BookBrowser from "./BookBrowser";
import MembersTab from "./components/MembersTab";
import BorrowTab from "./components/BorrowTab";
import HistoryTab from "./components/HistoryTab";
import { BOOK_API, CIRCULATION_API, apiRequest } from "./api";
import { getToday } from "./format";

const VALID_TABS = ["books", "catalog", "members", "borrow", "history"];

function getSavedTab() {
  try {
    const savedTab = localStorage.getItem("library_active_tab");
    return VALID_TABS.includes(savedTab) ? savedTab : "books";
  } catch {
    return "books";
  }
}

export default function Dashboard({ session, onLogout }) {
  const { user } = session;
  const isAdmin = user.role === "admin";
  const ownMemberId = user.member_id != null ? String(user.member_id) : "";

  const [savedTab, setTab] = useState(getSavedTab);
  // user ทั่วไปไม่มีแท็บสมาชิกและแท็บจัดการหนังสือ (เฉพาะ admin)
  const adminTab = savedTab === "members" || savedTab === "catalog";
  const tab = adminTab && !isAdmin ? "books" : savedTab;
  // books: หนังสือสูงสุด 100 เล่มแรก ใช้ในรายการเลือกของฟอร์มยืมและตารางจัดการของ admin
  // (หน้ารายการหนังสือค้นหา/แบ่งหน้าเองที่ BookBrowser)
  const [books, setBooks] = useState([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [dataVersion, setDataVersion] = useState(0); // เพิ่มค่าเมื่อโหลดข้อมูลใหม่ เพื่อให้ BookBrowser โหลดตาม
  const [members, setMembers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(
    isAdmin ? "" : ownMemberId,
  );
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

  // ฟังก์ชันกลางสำหรับเรียก API (แนบ access token, ต่ออายุอัตโนมัติเมื่อได้ 401)
  const request = apiRequest;

  // โหลดหนังสือจาก Catalog Service
  async function loadBooks() {
    const result = await request(`${BOOK_API}/api/books?limit=100`);

    const bookList = Array.isArray(result)
      ? result
      : Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.books)
          ? result.books
          : [];

    setBooks(bookList);
    setBookTotal(result.pagination?.total ?? bookList.length);
    setDataVersion((version) => version + 1);
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
      const results = await Promise.allSettled([
        loadBooks(),
        isAdmin ? loadMembers() : loadLoans(ownMemberId),
      ]);

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
  // โหลดครั้งเดียวต่อการเข้าสู่ระบบ เพราะ Dashboard ถูกสร้างใหม่ทุกครั้งที่ผู้ใช้เปลี่ยน
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    refreshData();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
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
      const result = await request(
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

      showStatus(
        "success",
        result.archived
          ? `ลบสมาชิก "${member.name}" แล้ว (เก็บประวัติการยืมไว้ และปิดบัญชีผู้ใช้)`
          : `ลบสมาชิก "${member.name}" สำเร็จ`,
      );
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

      const memberIdForLoan = isAdmin ? loanForm.member_id : ownMemberId;

      if (!loanForm.book_id || !memberIdForLoan || !loanForm.due_date) {
        throw new Error("กรุณากรอกข้อมูลการยืมให้ครบถ้วน");
      }

      if (loanForm.due_date < today) {
        throw new Error("วันกำหนดคืนต้องไม่เป็นวันที่ผ่านมาแล้ว");
      }

      await request(`${CIRCULATION_API}/api/loans`, {
        method: "POST",
        body: JSON.stringify({
          book_id: Number(loanForm.book_id),
          member_id: Number(memberIdForLoan),
          loan_date: today,
          due_date: loanForm.due_date,
        }),
      });

      const memberId = memberIdForLoan;

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
      const returned = await request(
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

      showStatus(
        "success",
        returned.fine_amount > 0
          ? `คืนหนังสือสำเร็จ (เกินกำหนด ${returned.days_overdue} วัน ค่าปรับ ${returned.fine_amount} บาท)`
          : "คืนหนังสือสำเร็จ",
      );
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

        <div className="hero-actions">
          <div className="user-chip">
            <strong>{user.name || user.username}</strong>
            <span className={isAdmin ? "role-badge admin" : "role-badge"}>
              {isAdmin ? "ผู้ดูแลระบบ (admin)" : "สมาชิก (user)"}
            </span>
          </div>

          <button
            className="refresh-button"
            onClick={refreshData}
            disabled={loading}
          >
            ↻ รีเฟรชข้อมูล
          </button>

          <button className="cancel-button" onClick={() => onLogout()}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <section className="status-row">
        <div className="status-card">
          <span>หนังสือที่โหลดได้</span>
          <strong>{bookTotal}</strong>
        </div>

        {isAdmin ? (
          <div className="status-card">
            <span>สมาชิกทั้งหมด</span>
            <strong>{members.length}</strong>
          </div>
        ) : (
          <div className="status-card">
            <span>รายการที่กำลังยืม</span>
            <strong>{loans.filter((loan) => !loan.return_date).length}</strong>
          </div>
        )}

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

        {isAdmin && (
          <button
            className={tab === "catalog" ? "active" : ""}
            onClick={() => setTab("catalog")}
          >
            จัดการหนังสือ
          </button>
        )}

        {isAdmin && (
          <button
            className={tab === "members" ? "active" : ""}
            onClick={() => setTab("members")}
          >
            สมาชิก
          </button>
        )}

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
        <BookBrowser
          request={request}
          bookApi={BOOK_API}
          dataVersion={dataVersion}
          showStatus={showStatus}
        />
      )}

      {/* จัดการหนังสือ ผู้แต่ง หมวดหมู่ (admin) */}
      {tab === "catalog" && isAdmin && (
        <AdminCatalog
          request={request}
          bookApi={BOOK_API}
          books={books}
          total={bookTotal}
          loading={loading}
          setLoading={setLoading}
          showStatus={showStatus}
          reloadBooks={loadBooks}
        />
      )}

      {/* จัดการสมาชิก */}
      {tab === "members" && isAdmin && (
        <MembersTab
          members={members}
          memberForm={memberForm}
          setMemberForm={setMemberForm}
          editingMemberId={editingMemberId}
          loading={loading}
          onSubmit={editingMemberId !== null ? updateMember : addMember}
          onCancel={resetMemberForm}
          onEdit={startEditMember}
          onDelete={deleteMember}
        />
      )}

      {/* ยืมหนังสือ */}
      {tab === "borrow" && (
        <BorrowTab
          books={books}
          members={members}
          isAdmin={isAdmin}
          user={user}
          ownMemberId={ownMemberId}
          loanForm={loanForm}
          setLoanForm={setLoanForm}
          today={today}
          loading={loading}
          onSubmit={borrowBook}
        />
      )}

      {/* ประวัติและคืนหนังสือ */}
      {tab === "history" && (
        <HistoryTab
          isAdmin={isAdmin}
          members={members}
          selectedMemberId={selectedMemberId}
          onSelectMember={showLoans}
          loans={loans}
          loading={loading}
          onReturn={returnBook}
          request={request}
          showStatus={showStatus}
        />
      )}

      <footer>
        <span>LibraryHub · Phase 3 Integration</span>
        <span>Catalog :3000 · Circulation :3001</span>
      </footer>
    </main>
  );
}

