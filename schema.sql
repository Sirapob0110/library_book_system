CREATE DATABASE IF NOT EXISTS library_book_system
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE library_book_system;

-- ผู้แต่งหนังสือ
CREATE TABLE authors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  nationality VARCHAR(80)
);

-- หมวดหมู่หนังสือ
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- หนังสือ: many-to-one กับ authors และ categories
CREATE TABLE books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  isbn VARCHAR(20) NOT NULL UNIQUE,
  published_year INT,
  author_id INT NOT NULL,
  category_id INT NOT NULL,
  total_copies INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  CHECK (available_copies >= 0 AND available_copies <= total_copies)
);

-- สมาชิกห้องสมุด
CREATE TABLE members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(20)
);

-- รายการยืม-คืน: ตารางเชื่อมความสัมพันธ์ many-to-many ระหว่าง books กับ members
CREATE TABLE loans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  book_id INT NOT NULL,
  member_id INT NOT NULL,
  loan_date DATE NOT NULL,
  due_date DATE NOT NULL,
  return_date DATE NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
