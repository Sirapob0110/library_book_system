USE library_book_system;

INSERT INTO authors (name, nationality) VALUES
  ('ทมยันตี', 'ไทย'),
  ('ปราบดา หยุ่น', 'ไทย'),
  ('George Orwell', 'อังกฤษ'),
  ('Haruki Murakami', 'ญี่ปุ่น');

INSERT INTO categories (name) VALUES
  ('นวนิยาย'),
  ('วิทยาศาสตร์'),
  ('เทคโนโลยี'),
  ('ประวัติศาสตร์');

INSERT INTO books (title, isbn, published_year, author_id, category_id, total_copies, available_copies) VALUES
  ('คู่กรรม', '9789740201001', 1987, 1, 1, 5, 5),
  ('ความน่าจะเป็น', '9789740202002', 2000, 2, 1, 3, 3),
  ('1984', '9780451524935', 1949, 3, 1, 4, 4),
  ('Norwegian Wood', '9784061860182', 1987, 4, 1, 2, 2),
  ('Sapiens: A Brief History of Humankind', '9780062316097', 2011, 3, 4, 3, 3);

INSERT INTO members (name, email, phone) VALUES
  ('สมชาย ใจดี', 'somchai@example.com', '0812345678'),
  ('สมหญิง รักเรียน', 'somying@example.com', '0898765432'),
  ('วิชัย ตั้งใจ', 'wichai@example.com', '0855551234');

-- ตัวอย่างรายการยืม: บางรายการยังไม่คืน (return_date เป็น NULL) เพื่อทดสอบ overdue
INSERT INTO loans (book_id, member_id, loan_date, due_date, return_date) VALUES
  (1, 1, '2026-08-01', '2026-08-15', '2026-08-10'),
  (3, 1, '2026-08-05', '2026-08-19', NULL),
  (2, 2, '2026-07-20', '2026-08-03', NULL);

-- ปรับ available_copies ให้สอดคล้องกับรายการที่ยังไม่คืน (id 3, 2 ยังถูกยืมอยู่)
UPDATE books SET available_copies = available_copies - 1 WHERE id IN (3, 2);
