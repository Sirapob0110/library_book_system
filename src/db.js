// src/db.js - MySQL connection pool
require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "book_system",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  dateStrings: ["DATE"], // ส่งค่า DATE เป็นข้อความ YYYY-MM-DD ป้องกันวันที่เลื่อนตามเขตเวลา
});

module.exports = pool;
