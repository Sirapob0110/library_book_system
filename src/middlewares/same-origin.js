// ป้องกันการเรียก endpoint ที่ใช้ cookie (refresh/logout) จากเว็บอื่น (CSRF ชั้นที่สอง นอกเหนือจาก SameSite=Lax)
// ถ้าคำขอมี header Origin ต้องตรงกับต้นทางของหน้าเว็บของเรา (คำขอจาก curl/เซิร์ฟเวอร์ที่ไม่มี Origin ผ่านได้)
function requireTrustedOrigin(req, res, next) {
  const allowed = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  const origin = req.headers.origin;

  if (origin && origin !== allowed) {
    const message = "คำขอนี้มาจากต้นทางที่ไม่ได้รับอนุญาต";
    return res.status(403).json({ success: false, message, error: message, code: "UNTRUSTED_ORIGIN" });
  }

  return next();
}

module.exports = { requireTrustedOrigin };
