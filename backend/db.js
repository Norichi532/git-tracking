// db.js
// Database toi gian dua tren file JSON. Muc dich la de demo nhanh, khong can
// cai PostgreSQL. Cau truc du lieu phan anh dung 3 bang da thiet ke:
// Projects, Users (co the co nhieu gitEmail), Commits.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "db.json");

const EMPTY_DB = {
  projects: [], // { id, name, repoUrl, webhookId|null, createdAt }
  users: [], // { id, name, gitEmails: [string], createdAt }
  commits: [], // { id (sha), projectId, authorId|null, authorEmail, authorName, message, url, commitDate, createdAt }
  nextProjectId: 1,
  nextUserId: 1,
};

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    writeDB(EMPTY_DB);
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Chuan hoa URL repo de so sanh (bo .git, bo dau / cuoi, bo http/https khac biet)
function normalizeRepoUrl(url) {
  if (!url) return "";
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/^https?:\/\//, "");
}

module.exports = { readDB, writeDB, normalizeRepoUrl, EMPTY_DB };
