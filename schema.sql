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
