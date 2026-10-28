// แท็บจัดการสมาชิก (เฉพาะ admin): ฟอร์มเพิ่ม/แก้ไข และรายการสมาชิก
export default function MembersTab({
  members,
  memberForm,
  setMemberForm,
  editingMemberId,
  loading,
  onSubmit,
  onCancel,
  onEdit,
  onDelete,
}) {
  return (
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
        onSubmit={onSubmit}
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
              onClick={onCancel}
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
                onClick={() => onEdit(member)}
              >
                แก้ไข
              </button>

              <button
                type="button"
                className="delete-button"
                disabled={loading}
                onClick={() => onDelete(member)}
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

  );
}
