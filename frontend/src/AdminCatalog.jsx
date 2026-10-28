import { useEffect, useState } from "react";
import { dateOnly, fineText } from "./format";

const EMPTY_BOOK = {
  title: "",
  isbn: "",
  author_id: "",
  published_year: "",
  price: "",
  category_ids: [],
};

const EMPTY_AUTHOR = { name: "", nationality: "", birth_year: "" };

// แปลงข้อความจากช่องกรอกเป็นจำนวนเต็ม (ว่าง = null)
function toInt(value) {
  const text = String(value).trim();
  return text === "" ? null : Number(text);
}

// จัดการหนังสือ ผู้แต่ง และหมวดหมู่ (เฉพาะ admin: Backend ตรวจสิทธิ์ซ้ำทุกคำขอ)
export default function AdminCatalog({
  request,
  bookApi,
  books,
  total,
  loading,
  setLoading,
  showStatus,
  reloadBooks,
}) {
  const [authors, setAuthors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [bookForm, setBookForm] = useState(EMPTY_BOOK);
  const [editingBookId, setEditingBookId] = useState(null);
  const [authorForm, setAuthorForm] = useState(EMPTY_AUTHOR);
  const [categoryName, setCategoryName] = useState("");

  async function loadAuthors() {
    const result = await request(`${bookApi}/api/authors`);
    setAuthors(Array.isArray(result.data) ? result.data : []);
  }

  async function loadCategories() {
    const result = await request(`${bookApi}/api/categories`);
    setCategories(Array.isArray(result.data) ? result.data : []);
  }

  useEffect(() => {
    Promise.all([loadAuthors(), loadCategories()]).catch((err) =>
      showStatus("error", err.message || "โหลดผู้แต่ง/หมวดหมู่ไม่สำเร็จ"),
    );
    // โหลดครั้งเดียวตอนเปิดแท็บ
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // รันงานที่เรียก API พร้อมสถานะ loading และข้อความสำเร็จ/ผิดพลาด
  async function run(task, successText, failText) {
    setLoading(true);

    try {
      const custom = await task();
      showStatus("success", typeof custom === "string" ? custom : successText);
      return true;
    } catch (err) {
      showStatus("error", err.message || failText);
      return false;
    } finally {
      setLoading(false);
    }
  }

  function resetBookForm() {
    setBookForm(EMPTY_BOOK);
    setEditingBookId(null);
  }

  function buildBookPayload() {
    const year = toInt(bookForm.published_year);
    const price = String(bookForm.price).trim();

    return {
      title: bookForm.title.trim(),
      isbn: bookForm.isbn.trim(),
      author_id: Number(bookForm.author_id),
      published_year: year,
      price: price === "" ? 0 : Number(price),
      category_ids: bookForm.category_ids,
    };
  }

  async function saveBook(event) {
    event.preventDefault();

    const editing = editingBookId !== null;
    const url = editing
      ? `${bookApi}/api/books/${encodeURIComponent(editingBookId)}`
      : `${bookApi}/api/books`;

    const saved = await run(
      async () => {
        await request(url, {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(buildBookPayload()),
        });
        await reloadBooks();
      },
      editing ? "แก้ไขหนังสือสำเร็จ" : "เพิ่มหนังสือสำเร็จ",
      editing ? "แก้ไขหนังสือไม่สำเร็จ" : "เพิ่มหนังสือไม่สำเร็จ",
    );

    if (saved) resetBookForm();
  }

  // ดึงรายละเอียดเต็ม (รวมหมวดหมู่) ของเล่มที่จะแก้ไขมาใส่ฟอร์ม
  async function startEditBook(book) {
    setLoading(true);

    try {
      const result = await request(
        `${bookApi}/api/books/${encodeURIComponent(book.book_id)}`,
      );
      const detail = result.data;

      setEditingBookId(detail.book_id);
      setBookForm({
        title: detail.title || "",
        isbn: detail.isbn || "",
        author_id: String(detail.author_id),
        published_year:
          detail.published_year != null ? String(detail.published_year) : "",
        price: detail.price != null ? String(detail.price) : "",
        category_ids: (detail.categories || []).map((c) => c.category_id),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showStatus("error", err.message || "โหลดข้อมูลหนังสือไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function deleteBook(book) {
    const confirmed = window.confirm(
      `คุณต้องการลบหนังสือ "${book.title}" (ID: ${book.book_id}) ใช่หรือไม่?`,
    );

    if (!confirmed) return;

    const deleted = await run(
      async () => {
        const result = await request(
          `${bookApi}/api/books/${encodeURIComponent(book.book_id)}`,
          { method: "DELETE" },
        );
        await reloadBooks();
        // หนังสือที่มีประวัติการยืมจะถูกเก็บเข้าคลัง (ซ่อน) แทนการลบจริง
        return result.archived
          ? `เก็บหนังสือ "${book.title}" เข้าคลังแล้ว (มีประวัติการยืม จึงไม่ลบถาวร)`
          : undefined;
      },
      `ลบหนังสือ "${book.title}" สำเร็จ`,
      "ลบหนังสือไม่สำเร็จ",
    );

    if (deleted && editingBookId === book.book_id) resetBookForm();
  }

  function toggleCategory(categoryId) {
    setBookForm((previous) => ({
      ...previous,
      category_ids: previous.category_ids.includes(categoryId)
        ? previous.category_ids.filter((id) => id !== categoryId)
        : [...previous.category_ids, categoryId],
    }));
  }

  async function addAuthor(event) {
    event.preventDefault();

    const added = await run(
      async () => {
        await request(`${bookApi}/api/authors`, {
          method: "POST",
          body: JSON.stringify({
            name: authorForm.name.trim(),
            nationality: authorForm.nationality.trim() || null,
            birth_year: toInt(authorForm.birth_year),
          }),
        });
        await loadAuthors();
      },
      "เพิ่มผู้แต่งสำเร็จ",
      "เพิ่มผู้แต่งไม่สำเร็จ",
    );

    if (added) setAuthorForm(EMPTY_AUTHOR);
  }

  async function addCategory(event) {
    event.preventDefault();

    const added = await run(
      async () => {
        await request(`${bookApi}/api/categories`, {
          method: "POST",
          body: JSON.stringify({ name: categoryName.trim() }),
        });
        await loadCategories();
      },
      "เพิ่มหมวดหมู่สำเร็จ",
      "เพิ่มหมวดหมู่ไม่สำเร็จ",
    );

    if (added) setCategoryName("");
  }

  const editing = editingBookId !== null;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CATALOG MANAGEMENT</p>
          <h2>จัดการหนังสือ ผู้แต่ง และหมวดหมู่</h2>
        </div>

        <span className="count">{total} เล่ม</span>
      </div>

      <h3>{editing ? `แก้ไขหนังสือ #${editingBookId}` : "เพิ่มหนังสือ"}</h3>

      <form className="form-grid" onSubmit={saveBook}>
        <label>
          ชื่อหนังสือ *
          <input
            value={bookForm.title}
            onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
            required
            maxLength={200}
          />
        </label>

        <label>
          ISBN *
          <input
            value={bookForm.isbn}
            onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
            required
            maxLength={20}
            placeholder="เช่น 9780140449136"
          />
        </label>

        <label>
          ผู้แต่ง *
          <select
            value={bookForm.author_id}
            onChange={(e) =>
              setBookForm({ ...bookForm, author_id: e.target.value })
            }
            required
          >
            <option value="">เลือกผู้แต่ง</option>
            {authors.map((author) => (
              <option key={author.author_id} value={author.author_id}>
                {author.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          ปีที่พิมพ์
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            value={bookForm.published_year}
            onChange={(e) =>
              setBookForm({ ...bookForm, published_year: e.target.value })
            }
          />
        </label>

        <label>
          ราคา (บาท)
          <input
            type="number"
            min={0}
            step="0.01"
            value={bookForm.price}
            onChange={(e) => setBookForm({ ...bookForm, price: e.target.value })}
          />
        </label>

        <fieldset className="category-picker">
          <legend>หมวดหมู่</legend>
          {categories.length === 0 && <span className="hint">ยังไม่มีหมวดหมู่</span>}
          {categories.map((category) => (
            <label key={category.category_id} className="check">
              <input
                type="checkbox"
                checked={bookForm.category_ids.includes(category.category_id)}
                onChange={() => toggleCategory(category.category_id)}
              />
              {category.name}
            </label>
          ))}
        </fieldset>

        <div className="member-form-actions">
          <button className="primary-button" disabled={loading} type="submit">
            {editing ? "บันทึกการแก้ไข" : "+ เพิ่มหนังสือ"}
          </button>

          {editing && (
            <button
              className="cancel-button"
              type="button"
              onClick={resetBookForm}
              disabled={loading}
            >
              ยกเลิก
            </button>
          )}
        </div>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>ชื่อหนังสือ</th>
              <th>ผู้แต่ง</th>
              <th>คงเหลือ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {books.map((book) => (
              <tr key={book.book_id}>
                <td>{book.book_id}</td>
                <td>{book.title}</td>
                <td>{book.author_name || "-"}</td>
                <td>
                  {book.available_copies}/{book.total_copies}
                </td>
                <td>
                  <div className="member-actions">
                    <button
                      type="button"
                      className="edit-button"
                      disabled={loading}
                      onClick={() => startEditBook(book)}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="delete-button"
                      disabled={loading}
                      onClick={() => deleteBook(book)}
                    >
                      ลบ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > books.length && (
        <p className="hint">แสดง {books.length} เล่มแรกจากทั้งหมด {total} เล่ม</p>
      )}

      <h3>ผู้แต่ง ({authors.length})</h3>

      <form className="form-grid" onSubmit={addAuthor}>
        <label>
          ชื่อผู้แต่ง *
          <input
            value={authorForm.name}
            onChange={(e) =>
              setAuthorForm({ ...authorForm, name: e.target.value })
            }
            required
            maxLength={150}
          />
        </label>

        <label>
          สัญชาติ
          <input
            value={authorForm.nationality}
            onChange={(e) =>
              setAuthorForm({ ...authorForm, nationality: e.target.value })
            }
            maxLength={80}
          />
        </label>

        <label>
          ปีเกิด
          <input
            type="number"
            min={1}
            max={9999}
            step={1}
            value={authorForm.birth_year}
            onChange={(e) =>
              setAuthorForm({ ...authorForm, birth_year: e.target.value })
            }
          />
        </label>

        <div className="member-form-actions">
          <button className="primary-button" disabled={loading} type="submit">
            + เพิ่มผู้แต่ง
          </button>
        </div>
      </form>

      <p className="hint">
        {authors.map((a) => a.name).join(" · ") || "ยังไม่มีผู้แต่ง"}
      </p>

      <h3>หมวดหมู่ ({categories.length})</h3>

      <form className="form-grid" onSubmit={addCategory}>
        <label>
          ชื่อหมวดหมู่ *
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            required
            maxLength={100}
          />
        </label>

        <div className="member-form-actions">
          <button className="primary-button" disabled={loading} type="submit">
            + เพิ่มหมวดหมู่
          </button>
        </div>
      </form>

      <p className="hint">
        {categories.map((c) => c.name).join(" · ") || "ยังไม่มีหมวดหมู่"}
      </p>
    </section>
  );
}

// รายการยืมเกินกำหนด (เฉพาะ admin)
export function OverdueLoans({ request, circulationApi, loading, showStatus }) {
  const [overdue, setOverdue] = useState(null);

  async function loadOverdue() {
    try {
      const result = await request(`${circulationApi}/api/loans/overdue`);
      setOverdue(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      showStatus("error", err.message || "โหลดรายการเกินกำหนดไม่สำเร็จ");
    }
  }

  return (
    <div className="overdue-box">
      <h3>รายการยืมเกินกำหนด</h3>

      <button
        type="button"
        className="refresh-button"
        disabled={loading}
        onClick={loadOverdue}
      >
        {overdue === null ? "ตรวจรายการเกินกำหนด" : "↻ โหลดใหม่"}
      </button>

      {overdue !== null &&
        (overdue.length === 0 ? (
          <p className="empty">ไม่มีรายการเกินกำหนด</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loan ID</th>
                  <th>สมาชิก</th>
                  <th>หนังสือ</th>
                  <th>กำหนดคืน</th>
                  <th>ค่าปรับ</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((loan) => (
                  <tr key={loan.loan_id}>
                    <td>{loan.loan_id}</td>
                    <td>{loan.member_name}</td>
                    <td>{loan.title}</td>
                    <td>{dateOnly(loan.due_date)}</td>
                    <td>{fineText(loan) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
