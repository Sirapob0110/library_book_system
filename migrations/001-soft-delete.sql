-- migrations/001-soft-delete.sql
-- เพิ่มคอลัมน์ deleted_at ให้ books และ members (การลบแบบเก็บร่องรอย)
-- สำหรับฐานข้อมูลที่สร้างไว้ก่อนหน้านี้ — ข้อมูลเดิมไม่หาย (schema.sql ฉบับใหม่มีคอลัมน์นี้อยู่แล้ว)
-- รันครั้งเดียว: mysql -u root --default-character-set=utf8mb4 book_system < migrations/001-soft-delete.sql
-- ถ้ารันซ้ำจะได้ error "Duplicate column name" ซึ่งไม่เป็นอันตราย (แสดงว่ามีคอลัมน์แล้ว)
ALTER TABLE books   ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE members ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
