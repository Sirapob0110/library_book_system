import { useEffect, useState } from "react";
import { dateOnly, fineText } from "./format";
import Modal from "./components/Modal";

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
  const [view, setView] = useState("books"); // books | authors | categories
  const [bookModal, setBookModal] = useState(false);
  const [authorModal, setAuthorModal] = useState(false);
  const [search, setSearch] = useState("");

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
    setBookModal(false);
  }

  function openAddBook() {
    setBookForm(EMPTY_BOOK);
    setEditingBookId(null);
    setBookModal(true);
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
      setBookModal(true);
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

    if (added) {
      setAuthorForm(EMPTY_AUTHOR);
      setAuthorModal(false);
    }
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
  const keyword = search.trim().toLowerCase();
  const visibleBooks = keyword
    ? books.filter((book) =>
        `${book.title} ${book.author_name || ""} ${book.isbn || ""}`
          .toLowerCase()
          .includes(keyword),
      )
    : books;

  const views = [
    ["books", "หนังสือ", total],
    ["authors", "ผู้แต่ง", authors.length],
    ["categories", "หมวดหมู่", categories.length],
  ];

  return (
    <section className="panel catalog">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CATALOG MANAGEMENT</p>
          <h2>จัดการข้อมูลหนังสือ</h2>
        </div>
      </div>

      <div className="segmented" role="tablist">
        {views.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={view === key ? "active" : ""}
            onClick={() => setView(key)}
          >
            {label} <span className="seg-count">{count}</span>
          </button>
        ))}
      </div>

      {view === "books" && (
        <>
          <div className="toolbar">
            <input
              type="search"
              className="search-input"
              placeholder="ค้นหาชื่อหนังสือ ผู้แต่ง หรือ ISBN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="ค้นหาหนังสือ"
            />
            <button
              type="button"
              className="primary-button"
              onClick={openAddBook}
              disabled={loading}
            >
              + เพิ่มหนังสือ
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>ชื่อหนังสือ</th>
                  <th>ผู้แต่ง</th>
                  <th>คงเหลือ</th>
                  <th aria-label="จัดการ"></th>
                </tr>
              </thead>
              <tbody>
                {visibleBooks.map((book) => {
                  const out = Number(book.available_copies) <= 0;
                  return (
                    <tr key={book.book_id}>
                      <td className="muted">{book.book_id}</td>
                      <td className="title-cell">{book.title}</td>
                      <td>{book.author_name || "-"}</td>
                      <td>
                        <span className={out ? "stock out" : "stock"}>
                          {book.available_copies}/{book.total_copies}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-action"
                            disabled={loading}
                            onClick={() => startEditBook(book)}
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            className="icon-action danger"
                            disabled={loading}
                            onClick={() => deleteBook(book)}
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleBooks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-row">
                      {keyword ? "ไม่พบหนังสือที่ค้นหา" : "ยังไม่มีหนังสือ"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > books.length && (
            <p className="hint">
              แสดง {books.length} เล่มแรกจากทั้งหมด {total} เล่ม
            </p>
          )}
        </>
      )}

      {view === "authors" && (
        <>
          <div className="toolbar">
            <p className="hint toolbar-note">
              ผู้แต่งทั้งหมด {authors.length} คน
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => setAuthorModal(true)}
              disabled={loading}
            >
              + เพิ่มผู้แต่ง
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ชื่อผู้แต่ง</th>
                  <th>สัญชาติ</th>
                  <th>ปีเกิด</th>
                </tr>
              </thead>
              <tbody>
                {authors.map((author) => (
                  <tr key={author.author_id}>
                    <td className="title-cell">{author.name}</td>
                    <td>{author.nationality || "-"}</td>
                    <td>{author.birth_year || "-"}</td>
                  </tr>
                ))}
                {authors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      ยังไม่มีผู้แต่ง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "categories" && (
        <>
          <form className="inline-add" onSubmit={addCategory}>
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              required
              maxLength={100}
              placeholder="ชื่อหมวดหมู่ใหม่"
              aria-label="ชื่อหมวดหมู่ใหม่"
            />
            <button className="primary-button" disabled={loading} type="submit">
              + เพิ่มหมวดหมู่
            </button>
          </form>

          <div className="chip-list">
            {categories.map((category) => (
              <span className="chip" key={category.category_id}>
                {category.name}
              </span>
            ))}
            {categories.length === 0 && (
              <p className="empty">ยังไม่มีหมวดหมู่</p>
            )}
          </div>
        </>
      )}

      {bookModal && (
        <Modal
          title={editing ? `แก้ไขหนังสือ #${editingBookId}` : "เพิ่มหนังสือ"}
          onClose={resetBookForm}
        >
          <form className="modal-form" onSubmit={saveBook}>
            <label className="span-2">
              ชื่อหนังสือ *
              <input
                value={bookForm.title}
                onChange={(e) =>
                  setBookForm({ ...bookForm, title: e.target.value })
                }
                required
                maxLength={200}
                autoFocus
              />
            </label>

            <label>
              ISBN *
              <input
                value={bookForm.isbn}
                onChange={(e) =>
                  setBookForm({ ...bookForm, isbn: e.target.value })
                }
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
                onChange={(e) =>
                  setBookForm({ ...bookForm, price: e.target.value })
                }
              />
            </label>

            <fieldset className="category-picker span-2">
              <legend>หมวดหมู่</legend>
              {categories.length === 0 && (
                <span className="hint">
                  ยังไม่มีหมวดหมู่ (เพิ่มได้ที่แท็บ "หมวดหมู่")
                </span>
              )}
              {categories.map((category) => (
                <label key={category.category_id} className="pill">
                  <input
                    type="checkbox"
                    checked={bookForm.category_ids.includes(
                      category.category_id,
                    )}
                    onChange={() => toggleCategory(category.category_id)}
                  />
                  <span>{category.name}</span>
                </label>
              ))}
            </fieldset>

            <div className="modal-actions span-2">
              <button
                className="cancel-button"
                type="button"
                onClick={resetBookForm}
                disabled={loading}
              >
                ยกเลิก
              </button>
              <button
                className="primary-button"
                disabled={loading}
                type="submit"
              >
                {editing ? "บันทึกการแก้ไข" : "เพิ่มหนังสือ"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {authorModal && (
        <Modal title="เพิ่มผู้แต่ง" onClose={() => setAuthorModal(false)}>
          <form className="modal-form" onSubmit={addAuthor}>
            <label className="span-2">
              ชื่อผู้แต่ง *
              <input
                value={authorForm.name}
                onChange={(e) =>
                  setAuthorForm({ ...authorForm, name: e.target.value })
                }
                required
                maxLength={150}
                autoFocus
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

            <div className="modal-actions span-2">
              <button
                className="cancel-button"
                type="button"
                onClick={() => setAuthorModal(false)}
                disabled={loading}
              >
                ยกเลิก
              </button>
              <button
                className="primary-button"
                disabled={loading}
                type="submit"
              >
                เพิ่มผู้แต่ง
              </button>
            </div>
          </form>
        </Modal>
      )}
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
