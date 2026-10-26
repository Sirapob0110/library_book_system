// เปิดทุกบริการหลังบ้านพร้อมกันด้วยคำสั่งเดียว: npm run start:all
// (Book API :3000, Circulation :3001, API Gateway :8000) กด Ctrl+C ครั้งเดียวปิดทั้งหมด
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const services = [
  { name: "book", file: "src/index.js" },
  { name: "circulation", file: "src/circulation/index.js" },
  { name: "gateway", file: "src/gateway/index.js" },
];

const children = services.map(({ name, file }) => {
  const child = spawn(process.execPath, [file], { cwd: root, env: process.env });
  const prefix = (line) => `[${name}] ${line}`;

  child.stdout.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(prefix(l))));
  child.stderr.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.error(prefix(l))));
  child.on("exit", (code) => {
    console.log(prefix(`หยุดทำงาน (code ${code})`));
  });

  return child;
});

function stopAll() {
  children.forEach((c) => c.kill());
  process.exit(0);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
