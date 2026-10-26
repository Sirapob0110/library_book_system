const { z } = require("zod");

// ข้อความตรงกับที่ระบบใช้เดิม เพื่อให้ Frontend และเอกสารไม่ต้องเปลี่ยน
const requiredText = (label, max) =>
  z
    .string({
      required_error: `${label} จำเป็นต้องระบุ`,
      invalid_type_error: `${label} จำเป็นต้องระบุ`,
    })
    .trim()
    .min(1, `${label} จำเป็นต้องระบุ`)
    .max(max, `${label} ต้องยาวไม่เกิน ${max} ตัวอักษร`);

const integer = (label) =>
  z.number({ invalid_type_error: `${label} ต้องเป็นจำนวนเต็ม` }).int(
    `${label} ต้องเป็นจำนวนเต็ม`,
  );

const bookSchema = z.object({
  title: requiredText("title", 200),
  isbn: requiredText("isbn", 20),
  author_id: z
    .number({
      required_error: "author_id ต้องเป็นจำนวนเต็ม",
      invalid_type_error: "author_id ต้องเป็นจำนวนเต็ม",
    })
    .int("author_id ต้องเป็นจำนวนเต็ม")
    .positive("author_id ต้องเป็นจำนวนเต็มบวก"),
  published_year: integer("published_year")
    .min(1, "published_year ต้องอยู่ระหว่าง 1 ถึง 9999")
    .max(9999, "published_year ต้องอยู่ระหว่าง 1 ถึง 9999")
    .nullish(),
  price: z
    .number({ invalid_type_error: "price ต้องเป็นตัวเลขที่ไม่ติดลบ" })
    .min(0, "price ต้องเป็นตัวเลขที่ไม่ติดลบ")
    .optional(),
  category_ids: z
    .array(
      z.number({ invalid_type_error: "category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม" }).int(
        "category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม",
      ),
      { invalid_type_error: "category_ids ต้องเป็นอาร์เรย์ของจำนวนเต็ม" },
    )
    .optional(),
});

const authorSchema = z.object({
  name: requiredText("name", 150),
  nationality: z
    .string({ invalid_type_error: "nationality ต้องเป็นข้อความ" })
    .trim()
    .max(80, "nationality ต้องยาวไม่เกิน 80 ตัวอักษร")
    .nullish(),
  birth_year: integer("birth_year")
    .min(1, "birth_year ต้องอยู่ระหว่าง 1 ถึง 9999")
    .max(9999, "birth_year ต้องอยู่ระหว่าง 1 ถึง 9999")
    .nullish(),
});

const categorySchema = z.object({
  name: requiredText("name", 100),
});

module.exports = { bookSchema, authorSchema, categorySchema };
