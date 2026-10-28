// แท็บยืมหนังสือ
export default function BorrowTab({
  books,
  members,
  isAdmin,
  user,
  ownMemberId,
  loanForm,
  setLoanForm,
  today,
  loading,
  onSubmit,
}) {
  return (
    <section className="panel">
      <p className="eyebrow">CIRCULATION SERVICE</p>
      <h2>ยืมหนังสือ</h2>

      <form className="form-grid" onSubmit={onSubmit}>
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

        {isAdmin ? (
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
        ) : (
          <label>
            ผู้ยืม
            <input
              value={`${user.name || user.username} (สมาชิก #${ownMemberId})`}
              readOnly
            />
          </label>
        )}

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
          disabled={
            loading ||
            books.length === 0 ||
            (isAdmin && members.length === 0)
          }
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

  );
}
