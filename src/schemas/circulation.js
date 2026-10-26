const { z } = require("zod");

const memberSchema = z.object({
  name: z
    .string({ required_error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง" })
    .trim()
    .min(1, "กรุณาระบุชื่อและอีเมลให้ถูกต้อง")
    .max(100, "ชื่อต้องยาวไม่เกิน 100 ตัวอักษร"),
  email: z
    .string({ required_error: "กรุณาระบุชื่อและอีเมลให้ถูกต้อง" })
    .trim()
    .email("กรุณาระบุชื่อและอีเมลให้ถูกต้อง")
    .max(150, "อีเมลต้องยาวไม่เกิน 150 ตัวอักษร"),
  phone: z
    .string()
    .trim()
    .max(30, "เบอร์โทรต้องยาวไม่เกิน 30 ตัวอักษร")
    .nullish()
    .catch(null),
});

const dateText = (label) =>
  z
    .string({ invalid_type_error: `${label} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`)
    .refine(
      (value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      },
      `${label} ไม่ใช่วันที่ที่มีอยู่จริง`,
    );

// รหัสที่ส่งมาเป็นตัวเลขหรือข้อความตัวเลขก็ได้ (ผู้ใช้ทั่วไปไม่ต้องส่ง member_id)
const id = (label) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z
      .number({
        required_error: `${label} ต้องเป็นจำนวนเต็มบวก`,
        invalid_type_error: `${label} ต้องเป็นจำนวนเต็มบวก`,
      })
      .int(`${label} ต้องเป็นจำนวนเต็มบวก`)
      .positive(`${label} ต้องเป็นจำนวนเต็มบวก`),
  );

// ตรวจข้ามฟิลด์ด้วย superRefine: วันกำหนดคืนต้องไม่ก่อนวันที่ยืม (ถ้าไม่ส่ง loan_date ใช้วันนี้)
const loanSchema = z
  .object({
    book_id: id("book_id"),
    member_id: id("member_id").optional().nullable().or(z.literal("")),
    loan_date: dateText("loan_date").optional(),
    due_date: dateText("due_date"),
  })
  .superRefine((loan, ctx) => {
    const loanDate = loan.loan_date || new Date().toISOString().slice(0, 10);

    if (loan.due_date < loanDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["due_date"],
        message: "วันกำหนดคืนต้องไม่ก่อนวันที่ยืม",
      });
    }
  });

module.exports = { memberSchema, loanSchema };
