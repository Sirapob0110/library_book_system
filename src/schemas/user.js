const { z } = require("zod");

const registerSchema = z.object({
  username: z
    .string({ required_error: "username จำเป็นต้องระบุ" })
    .regex(
      /^[A-Za-z0-9_]{3,30}$/,
      "username ต้องยาว 3-30 ตัวอักษร ใช้ได้เฉพาะ A-Z a-z 0-9 และ _",
    ),
  password: z
    .string({ required_error: "password ต้องยาว 8-72 ตัวอักษร" })
    .min(8, "password ต้องยาว 8-72 ตัวอักษร")
    .max(72, "password ต้องยาว 8-72 ตัวอักษร"),
  name: z
    .string({ required_error: "name ต้องมีอย่างน้อย 2 ตัวอักษร" })
    .trim()
    .min(2, "name ต้องมีอย่างน้อย 2 ตัวอักษร")
    .max(100, "name ต้องยาวไม่เกิน 100 ตัวอักษร"),
  email: z
    .string({ required_error: "email ไม่ถูกต้อง" })
    .trim()
    .email("email ไม่ถูกต้อง")
    .max(150, "email ต้องยาวไม่เกิน 150 ตัวอักษร"),
  phone: z
    .string({ invalid_type_error: "phone ต้องเป็นข้อความ" })
    .trim()
    .max(30, "phone ต้องยาวไม่เกิน 30 ตัวอักษร")
    .nullish(),
});

const loginSchema = z.object({
  username: z
    .string({ required_error: "กรุณาระบุ username และ password" })
    .min(1, "กรุณาระบุ username และ password"),
  password: z
    .string({ required_error: "กรุณาระบุ username และ password" })
    .min(1, "กรุณาระบุ username และ password"),
});

const passwordRule = registerSchema.shape.password;

const forgotPasswordSchema = z.object({
  identifier: z
    .string({ required_error: "กรุณาระบุ username หรืออีเมล" })
    .trim()
    .min(1, "กรุณาระบุ username หรืออีเมล")
    .max(150, "ข้อมูลยาวเกินไป"),
});

const resetPasswordSchema = z.object({
  token: z
    .string({ required_error: "กรุณาระบุ token" })
    .min(20, "token ไม่ถูกต้อง")
    .max(200, "token ไม่ถูกต้อง"),
  password: passwordRule,
});

module.exports = { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, passwordRule };
