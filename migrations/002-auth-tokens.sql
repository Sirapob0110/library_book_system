-- migrations/002-auth-tokens.sql
-- เพิ่มตารางสำหรับ refresh token (ออกจากระบบ/เพิกถอนได้) และการรีเซ็ตรหัสผ่าน
-- สำหรับฐานข้อมูลที่สร้างไว้ก่อนหน้านี้ — ข้อมูลเดิมไม่หาย (schema.sql ฉบับใหม่มีตารางเหล่านี้อยู่แล้ว)
-- รันครั้งเดียว: mysql -u root --default-character-set=utf8mb4 book_system < migrations/002-auth-tokens.sql
-- ถ้ารันซ้ำจะไม่เกิดผลเสีย (ใช้ IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash CHAR(64) NOT NULL,          -- sha256 ของ token (ไม่เก็บ token จริง)
  family_id  CHAR(36) NOT NULL,          -- ทุก token ที่ต่อกันจากการ login ครั้งเดียว (ใช้เพิกถอนทั้งชุดเมื่อพบการใช้ซ้ำ)
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  KEY idx_refresh_family (family_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  reset_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash CHAR(64) NOT NULL,          -- sha256 ของ token ที่ส่งให้ผู้ใช้
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reset_hash (token_hash),
  KEY idx_reset_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
