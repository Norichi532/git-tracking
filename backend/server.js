// server.js
const { loadEnv } = require("./env");
loadEnv();

const express = require("express");
const cors = require("cors");
const { readDB, writeDB, normalizeRepoUrl } = require("./db");
const { parseGithubRepo, createGithubWebhook, deleteGithubWebhook } = require("./github");

const app = express();
const PORT = process.env.PORT || 3000;

// WEBHOOK_BASE_URL: URL public cua server (vd URL ngrok, nen dung static domain
// de khong doi moi lan restart). GITHUB_TOKEN: Personal Access Token de tu
// dong tao webhook qua GitHub API. Ca hai deu doc tu file .env (xem .env.example).
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// Backend va frontend gio chay o 2 cong/domain khac nhau, nen can bat CORS
// de trinh duyet cho phep frontend goi API sang day.
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------------------------------
// Core logic: xu ly 1 "push event" (dung chung cho webhook that va simulate)
// ---------------------------------------------------------------------------
function handlePushEvent(payload) {
  const db = readDB();

  const repoUrl =
    payload.repository?.html_url || payload.repository?.url || payload.repoUrl;
  const normalizedIncoming = normalizeRepoUrl(repoUrl);

  const project = db.projects.find(
    (p) => normalizeRepoUrl(p.repoUrl) === normalizedIncoming
  );

  if (!project) {
    return {
      ok: false,
      status: 404,
      error: `Khong tim thay project nao khop voi repoUrl: ${repoUrl}`,
    };
  }

  const incomingCommits = payload.commits || [];
  let inserted = 0;
  let skipped = 0;

  for (const c of incomingCommits) {
    const sha = c.id || c.sha;
    if (!sha) continue;

    const alreadyExists = db.commits.some(
      (existing) => existing.id === sha && existing.projectId === project.id
    );
    if (alreadyExists) {
      skipped++;
      continue;
    }

    const authorEmail = (c.author?.email || "").toLowerCase().trim();
    const authorName = c.author?.name || "Unknown";

    // Resolve ve User da biet, dua theo bat ky email nao trong danh sach gitEmails
    const matchedUser = db.users.find((u) =>
      (u.gitEmails || []).map((e) => e.toLowerCase()).includes(authorEmail)
    );

    db.commits.push({
      id: sha,
      projectId: project.id,
      authorId: matchedUser ? matchedUser.id : null,
      authorEmail,
      authorName,
      message: c.message || "",
      url: c.url || "",
      commitDate: c.timestamp || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    inserted++;
  }

  writeDB(db);
  return { ok: true, status: 200, project: project.name, inserted, skipped };
}

// ---------------------------------------------------------------------------
// Webhook that (GitHub gui payload dung format nay khi co su kien push)
// Gan URL nay (qua ngrok) vao Settings > Webhooks cua tung repo tren GitHub.
// ---------------------------------------------------------------------------
app.post("/webhooks/git", (req, res) => {
  const result = handlePushEvent(req.body);
  res.status(result.status).json(result);
});

// ---------------------------------------------------------------------------
// Endpoint gia lap push event - dung de DEMO khong can ngrok/GitHub that.
// Frontend se goi endpoint nay khi ban bam nut "Mo phong commit".
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Projects CRUD (toi gian)
// ---------------------------------------------------------------------------
app.get("/api/projects", (req, res) => {
  const db = readDB();
  res.json(db.projects);
});

app.post("/api/projects", async (req, res) => {
  const { name, repoUrl } = req.body;
  if (!name || !repoUrl) {
    return res.status(400).json({ error: "Thieu name hoac repoUrl" });
  }
  const db = readDB();
  const project = {
    id: db.nextProjectId++,
    name,
    repoUrl,
    createdAt: new Date().toISOString(),
  };
  db.projects.push(project);
  writeDB(db);

  // ---- Tu dong gan webhook len GitHub, neu da cau hinh du dieu kien ----
  let webhookSetup = { attempted: false };

  if (!GITHUB_TOKEN) {
    webhookSetup = { attempted: false, reason: "Chua co GITHUB_TOKEN trong .env" };
  } else if (!WEBHOOK_BASE_URL) {
    webhookSetup = { attempted: false, reason: "Chua co WEBHOOK_BASE_URL trong .env" };
  } else {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) {
      webhookSetup = { attempted: false, reason: "repoUrl khong phai dinh dang GitHub hop le" };
    } else {
      webhookSetup.attempted = true;
      const result = await createGithubWebhook({
        owner: parsed.owner,
        repo: parsed.repo,
        token: GITHUB_TOKEN,
        webhookUrl: `${WEBHOOK_BASE_URL.replace(/\/+$/, "")}/webhooks/git`,
      });
      webhookSetup = { ...webhookSetup, ...result };

      // Luu hookId vao project de sau nay xoa du an co the xoa kem webhook
      if (result.ok && result.hookId) {
        const dbAfter = readDB();
        const p = dbAfter.projects.find((x) => x.id === project.id);
        if (p) p.webhookId = result.hookId;
        writeDB(dbAfter);
      }
    }
  }

  res.status(201).json({ ...project, webhookSetup });
});

app.delete("/api/projects/:id", async (req, res) => {
  const db = readDB();
  const project = db.projects.find((p) => p.id === Number(req.params.id));
  if (!project) {
    return res.status(404).json({ error: "Project khong ton tai" });
  }

  // Xoa webhook tren GitHub truoc, neu project nay co gan webhook tu dong
  let webhookDeleted = null;
  if (project.webhookId && GITHUB_TOKEN) {
    const parsed = parseGithubRepo(project.repoUrl);
    if (parsed) {
      webhookDeleted = await deleteGithubWebhook({
        owner: parsed.owner,
        repo: parsed.repo,
        token: GITHUB_TOKEN,
        hookId: project.webhookId,
      });
    }
  }

  db.projects = db.projects.filter((p) => p.id !== Number(req.params.id));
  // Xoa kem cac commit thuoc du an nay, tranh con lai commit "mo coi"
  db.commits = db.commits.filter((c) => c.projectId !== Number(req.params.id));
  writeDB(db);

  res.status(200).json({ ok: true, webhookDeleted });
});

// ---------------------------------------------------------------------------
// Users CRUD (moi user co the co NHIEU gitEmail)
// ---------------------------------------------------------------------------
app.get("/api/users", (req, res) => {
  const db = readDB();
  res.json(db.users);
});

app.post("/api/users", (req, res) => {
  const { name, gitEmails } = req.body;
  if (!name || !gitEmails) {
    return res.status(400).json({ error: "Thieu name hoac gitEmails" });
  }
  const emailList = Array.isArray(gitEmails)
    ? gitEmails
    : String(gitEmails)
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

  const db = readDB();
  const user = {
    id: db.nextUserId++,
    name,
    gitEmails: emailList,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);

  // Gan hoi cuu: commit nao truoc do co email khop nhung chua co authorId
  db.commits.forEach((c) => {
    if (!c.authorId && emailList.map((e) => e.toLowerCase()).includes(c.authorEmail)) {
      c.authorId = user.id;
    }
  });

  writeDB(db);
  res.status(201).json(user);
});

app.delete("/api/users/:id", (req, res) => {
  const db = readDB();
  db.users = db.users.filter((u) => u.id !== Number(req.params.id));
  writeDB(db);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Commits - query linh hoat theo project va/hoac user
// ---------------------------------------------------------------------------
app.get("/api/commits", (req, res) => {
  const db = readDB();
  let results = db.commits;

  if (req.query.projectId) {
    results = results.filter((c) => c.projectId === Number(req.query.projectId));
  }
  if (req.query.userId) {
    results = results.filter((c) => c.authorId === Number(req.query.userId));
  }
  if (req.query.email) {
    results = results.filter(
      (c) => c.authorEmail === String(req.query.email).toLowerCase()
    );
  }

  // Dinh kem ten project va ten user de frontend de hien thi
  const withNames = results
    .map((c) => {
      const project = db.projects.find((p) => p.id === c.projectId);
      const user = db.users.find((u) => u.id === c.authorId);
      return {
        ...c,
        projectName: project ? project.name : "(khong ro)",
        displayName: user ? user.name : c.authorName + " (chua map user)",
      };
    })
    .sort((a, b) => new Date(b.commitDate) - new Date(a.commitDate));

  res.json(withNames);
});

app.listen(PORT, () => {
  console.log(`Git Commit Tracker dang chay tai http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/git`);
});
