-- schema.sql : ระบบข้อมูลหนังสือ (ต่อจากโครงงานระยะที่ 1)
DROP DATABASE IF EXISTS book_system;
CREATE DATABASE book_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE book_system;

CREATE TABLE authors (
  author_id   INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  nationality VARCHAR(80),
  birth_year  SMALLINT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  CONSTRAINT uq_category_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE books (
  book_id        INT AUTO_INCREMENT PRIMARY KEY,
  title          VARCHAR(255) NOT NULL,
  isbn           VARCHAR(20) NOT NULL,
  author_id      INT NOT NULL,
  published_year SMALLINT,
  price          DECIMAL(10,2) DEFAULT 0.00,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_copies     INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  deleted_at     DATETIME NULL DEFAULT NULL, -- ลบแบบเก็บร่องรอย (หนังสือที่เคยมีประวัติการยืม)
  CONSTRAINT uq_books_isbn UNIQUE (isbn),
  CONSTRAINT fk_books_author FOREIGN KEY (author_id) REFERENCES authors(author_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE book_categories (
  book_id     INT NOT NULL,
  category_id INT NOT NULL,
  PRIMARY KEY (book_id, category_id),
  CONSTRAINT fk_bc_book FOREIGN KEY (book_id) REFERENCES books(book_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bc_category FOREIGN KEY (category_id) REFERENCES categories(category_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_books_title ON books(title);
CREATE INDEX idx_authors_name ON authors(name);

-- ===== Circulation Service (members, loans) =====
-- โครงสร้างตรงกับฐานข้อมูลที่ใช้พัฒนาจริง (ตรวจจาก SHOW CREATE TABLE)
CREATE TABLE members (
  member_id INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(150) NOT NULL,
  email     VARCHAR(150) NOT NULL,
  phone     VARCHAR(20) DEFAULT NULL,
  deleted_at DATETIME NULL DEFAULT NULL, -- ลบแบบเก็บร่องรอย (สมาชิกที่เคยมีประวัติการยืม)
  UNIQUE KEY email (email)
) ENGINE=InnoDB;

CREATE TABLE loans (
  loan_id     INT AUTO_INCREMENT PRIMARY KEY,
  book_id     INT NOT NULL,
  member_id   INT NOT NULL,
  loan_date   DATE NOT NULL,
  due_date    DATE NOT NULL,
  return_date DATE DEFAULT NULL,
  CONSTRAINT fk_loans_book   FOREIGN KEY (book_id)   REFERENCES books(book_id),
  CONSTRAINT fk_loans_member FOREIGN KEY (member_id) REFERENCES members(member_id)
) ENGINE=InnoDB;

-- ===== Authentication (ผู้ใช้ระบบ: admin / user) =====
-- สมัครผ่านหน้าเว็บจะได้บทบาท user และผูกกับสมาชิกห้องสมุด (members) ของตัวเอง
-- บัญชี admin สร้างจาก seed.sql เท่านั้น
CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('admin','user') NOT NULL DEFAULT 'user',
  member_id     INT DEFAULT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT fk_users_member FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ===== Refresh token และการรีเซ็ตรหัสผ่าน =====
CREATE TABLE refresh_tokens (
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

CREATE TABLE password_resets (
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
