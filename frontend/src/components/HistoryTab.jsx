import { OverdueLoans } from "../AdminCatalog";
import { CIRCULATION_API } from "../api";
import { dateOnly, fineText } from "../format";

// แท็บประวัติการยืม / คืนหนังสือ (แสดงค่าปรับของรายการที่เกินกำหนด)
export default function HistoryTab({
  isAdmin,
  members,
  selectedMemberId,
  onSelectMember,
  loans,
  loading,
  onReturn,
  request,
  showStatus,
}) {
  return (
    <section className="panel">
      <p className="eyebrow">LOAN HISTORY</p>
      <h2>{isAdmin ? "ประวัติการยืมและคืน" : "ประวัติการยืมของฉัน"}</h2>

      {isAdmin && (
        <label className="history-select">
          เลือกสมาชิก
          <select
            value={selectedMemberId}
            onChange={(e) => onSelectMember(e.target.value)}
          >
            <option value="">เลือกสมาชิกเพื่อดูประวัติ</option>

            {members.map((member) => (
              <option key={member.member_id} value={member.member_id}>
                #{member.member_id} — {member.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {isAdmin && (
        <OverdueLoans
          request={request}
          circulationApi={CIRCULATION_API}
          loading={loading}
          showStatus={showStatus}
        />
      )}

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
                <th>ค่าปรับ</th>
                <th>จัดการ</th>
              </tr>
            </thead>

            <tbody>
              {loans.map((loan) => (
                <tr key={loan.loan_id}>
                  <td>{loan.loan_id}</td>
                  <td>{loan.title}</td>
                  <td>{dateOnly(loan.loan_date)}</td>
                  <td>{dateOnly(loan.due_date)}</td>
                  <td>
                    {loan.return_date ? (
                      <span className="returned">คืนแล้ว</span>
                    ) : (
                      <span className="borrowed">กำลังยืม</span>
                    )}
                  </td>
                  <td className="fine-cell">{fineText(loan) || "—"}</td>
                  <td>
                    {!loan.return_date && (
                      <button
                        className="return-button"
                        disabled={loading}
                        onClick={() => onReturn(loan.loan_id)}
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
            ? isAdmin
              ? "สมาชิกคนนี้ยังไม่มีประวัติการยืม"
              : "คุณยังไม่มีประวัติการยืม"
            : "เลือกสมาชิกเพื่อดูประวัติการยืม"}
        </p>
      )}
    </section>

  );
}
