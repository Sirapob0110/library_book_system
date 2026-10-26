import { useEffect, useState } from "react";

const PAGE_SIZE = 10;

const SORT_OPTIONS = [
  ["id", "ลำดับ (ID)"],
  ["title", "ชื่อหนังสือ"],
  ["published_year", "ปีที่พิมพ์"],
  ["price", "ราคา"],
  ["available_copies", "จำนวนคงเหลือ"],
];

// รายการหนังสือแบบค้นหา เรียง กรอง และแบ่งหน้า (ประมวลผลที่ Backend: GET /api/books)
export default function BookBrowser({ request, bookApi, dataVersion, showStatus }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // ค่าค้นหาที่ผ่านการหน่วงเวลาแล้ว
  const [sort, setSort] = useState("id");
  const [order, setOrder] = useState("asc");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], pagination: null });
  const [busy, setBusy] = useState(false);

  // หน่วงการค้นหา 300 ms เพื่อไม่ยิง API ทุกตัวอักษรที่พิมพ์
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setBusy(true);

      try {
        const params = new URLSearchParams({ page, limit: PAGE_SIZE, sort, order });
        if (query) params.set("q", query);
        if (availableOnly) params.set("available", "true");

        const data = await request(`${bookApi}/api/books?${params}`);

        if (!cancelled) {
          setResult({
            items: Array.isArray(data.data) ? data.data : [],
            pagination: data.pagination || null,
          });
        }
      } catch (err) {
        if (!cancelled) showStatus("error", err.message || "โหลดรายการหนังสือไม่สำเร็จ");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // โหลดใหม่เมื่อเงื่อนไขเปลี่ยน หรือเมื่อ Dashboard รีเฟรชข้อมูล (dataVersion)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, sort, order, availableOnly, dataVersion]);

  const { items, pagination } = result;
  const first = pagination && pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const last = first > 0 ? first + items.length - 1 : 0;

  function changeFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CATALOG SERVICE</p>
          <h2>รายการหนังสือ</h2>
        </div>

        <span className="count">{pagination ? pagination.total : 0} รายการ</span>
      </div>

      <div className="book-toolbar">
        <label>
          ค้นหา
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ชื่อหนังสือหรือผู้แต่ง"
            maxLength={100}
          />
        </label>

        <label>
          เรียงตาม
          <select value={sort} onChange={(e) => changeFilter(setSort)(e.target.value)}>
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          ลำดับ
          <select value={order} onChange={(e) => changeFilter(setOrder)(e.target.value)}>
            <option value="asc">น้อยไปมาก</option>
            <option value="desc">มากไปน้อย</option>
          </select>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => changeFilter(setAvailableOnly)(e.target.checked)}
          />
          เฉพาะเล่มที่ยืมได้
        </label>
      </div>

      {items.length === 0 && !busy ? (
        <p className="empty">
          ไม่พบหนังสือที่ตรงเงื่อนไข หากมีข้อผิดพลาดจะแสดงข้อความด้านบน
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
              {items.map((book) => (
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

      {pagination && pagination.total > 0 && (
        <div className="pager">
          <span>
            แสดง {first}–{last} จาก {pagination.total}
          </span>

          <div>
            <button
              type="button"
              className="cancel-button"
              disabled={busy || pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
            >
              ← ก่อนหน้า
            </button>

            <span className="pager-page">
              หน้า {pagination.page} / {pagination.totalPages}
            </span>

            <button
              type="button"
              className="cancel-button"
              disabled={busy || pagination.page >= pagination.totalPages}
              onClick={() => setPage(pagination.page + 1)}
            >
              ถัดไป →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
