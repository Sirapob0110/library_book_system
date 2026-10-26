// ตัวกลางตรวจข้อมูลที่รับเข้ามา (Lab 12): ใช้ zod ตรวจ req.body ก่อนเข้า handler
// ถ้าไม่ผ่านตอบ 400 พร้อม code VALIDATION_ERROR และรายการ details ราย field
// ถ้าผ่านจะแทน req.body ด้วยข้อมูลที่ผ่านการ parse (trim แล้ว ตัดฟิลด์ที่ไม่รู้จักทิ้ง)

function formatIssues(zodError) {
  return zodError.issues.map((issue) => ({
    field: issue.path.join(".") || "(body)",
    message: issue.message,
  }));
}

function validationResponse(res, details) {
  const message = details[0].message;

  // ใส่ทั้ง message และ error เพราะสองบริการตอบรูปแบบต่างกันมาแต่เดิม
  return res.status(400).json({
    success: false,
    message,
    error: message,
    code: "VALIDATION_ERROR",
    details,
  });
}

function validateBody(schema) {
  return (req, res, next) => {
    // body ที่ไม่ใช่ JSON object (เช่น ไม่ส่งมาเลย) ให้ถือเป็น object ว่างเพื่อให้ได้ข้อความรายฟิลด์
    const input =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};

    const result = schema.safeParse(input);

    if (!result.success) {
      return validationResponse(res, formatIssues(result.error));
    }

    req.body = result.data;
    next();
  };
}

module.exports = { validateBody, formatIssues, validationResponse };
