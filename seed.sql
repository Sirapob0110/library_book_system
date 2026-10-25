USE book_system;
INSERT INTO authors (name, nationality, birth_year) VALUES
('เสกสรรค์ ประเสริฐกุล','Thai',1949),
('Haruki Murakami','Japanese',1949),
('J.K. Rowling','British',1965),
('ทมยันตี','Thai',1937);
INSERT INTO categories (name) VALUES ('นวนิยาย'),('แฟนตาซี'),('สารคดี'),('วรรณกรรมเยาวชน');
INSERT INTO books (title, isbn, author_id, published_year, price) VALUES
('นอร์วีเจียนวูด','9780099448822',2,1987,295.00),
('1Q84','9780099549302',2,2009,450.00),
('Harry Potter and the Philosopher''s Stone','9780747532699',3,1997,320.00),
('Harry Potter and the Chamber of Secrets','9780747538493',3,1998,330.00),
('คู่กรรม','9789742350001',4,1965,250.00),
('บันทึกจากลูกผู้ชาย','9789742350123',1,2003,180.00);
INSERT INTO book_categories (book_id, category_id) VALUES
(1,1),(2,1),(2,2),(3,1),(3,2),(3,4),(4,1),(4,2),(4,4),(5,1),(6,3);
