// server.js
const { loadEnv } = require("./env");
loadEnv();

const express = require("express");
const cors = require("cors");
const { readDB, writeDB, normalizeRepoUrl } = require("./db");
const { parseGithubRepo, createGithubWebhook, deleteGithubWebhook } = require("./github");
const {
  fetchOpenProjectProjects,
  fetchOpenProjectProjectMembers,
  fetchOpenProjectProjectSprints,
  fetchOpenProjectSprintTasks,
} = require("./openproject");

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
    console.warn(
      `[GitHub webhook] No local project matched repoUrl="${repoUrl}". Commit payload ignored.`
    );
    return {
      ok: false,
      status: 404,
      error: `Khong tim thay project nao khop voi repoUrl: ${repoUrl}`,
    };
  }

  const incomingCommits = payload.commits || [];
  let inserted = 0;
  let skipped = 0;
  const insertedCommits = [];
  const skippedCommits = [];

  for (const c of incomingCommits) {
    const sha = c.id || c.sha;
    if (!sha) continue;

    const alreadyExists = db.commits.some(
      (existing) => existing.id === sha && existing.projectId === project.id
    );
    if (alreadyExists) {
      skipped++;
      skippedCommits.push({
        sha,
        message: c.message || "",
      });
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
    insertedCommits.push({
      sha,
      authorEmail,
      authorName,
      message: c.message || "",
    });
  }

  writeDB(db);

  if (inserted > 0 || skipped > 0) {
    console.log(
      `[GitHub webhook] project="${project.name}" repo="${repoUrl}" received=${incomingCommits.length} inserted=${inserted} skipped=${skipped}`
    );

    insertedCommits.forEach((commit) => {
      console.log(
        `[GitHub webhook] + ${commit.sha.slice(0, 7)} ${commit.authorName} <${commit.authorEmail}>: ${commit.message}`
      );
    });

    skippedCommits.forEach((commit) => {
      console.log(
        `[GitHub webhook] = ${commit.sha.slice(0, 7)} skipped duplicate: ${commit.message}`
      );
    });
  }

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
app.get("/api/openproject/projects", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjects();
    if (!result.ok) {
      return res.status(result.status || 503).json({ error: result.error });
    }
    res.json(result.projects);
  } catch (err) {
    res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

app.get("/api/openproject/projects/:id/members", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjectMembers(req.params.id);
    if (!result.ok) {
      return res.status(result.status || 503).json({ error: result.error });
    }
    res.json(result.members);
  } catch (err) {
    res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

app.get("/api/openproject/projects/:id/sprints", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjectSprints(req.params.id);
    if (!result.ok) {
      return res.status(result.status || 503).json({ error: result.error });
    }
    res.json(result.sprints);
  } catch (err) {
    res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

function commitWorkPackageIds(message) {
  const ids = new Set();
  const text = String(message || "");
  for (const match of text.matchAll(/\b(?:OP|WP)#(\d+)\b/gi)) {
    ids.add(Number(match[1]));
  }
  return ids;
}

function commitProgressState(message) {
  const text = String(message || "").toLowerCase();
  const match = text.match(/\b(start|progress|review|done|block|blocked|fix)\b/);
  if (!match) return null;
  if (match[1] === "blocked") return "block";
  return match[1];
}

function progressFromTaskAndCommits(task, commits) {
  const latestState = commits.map((c) => c.progressState).filter(Boolean).at(-1);
  const status = String(task.status || "").toLowerCase();

  if (task.percentageDone !== null && task.percentageDone !== undefined) {
    return Number(task.percentageDone);
  }
  if (latestState === "done" || status.includes("done") || status.includes("closed") || status.includes("đóng")) {
    return 100;
  }
  if (latestState === "review") return 80;
  if (latestState === "progress" || latestState === "fix") return 50;
  if (latestState === "start") return 20;
  if (latestState === "block") return 35;
  return 0;
}

app.get("/api/progress", async (req, res) => {
  const { openProjectId, openProjectUserId, sprintId } = req.query;
  if (!openProjectId || !openProjectUserId || !sprintId) {
    return res.status(400).json({
      error: "Thieu openProjectId, openProjectUserId hoac sprintId",
    });
  }

  let tasksResult;
  try {
    tasksResult = await fetchOpenProjectSprintTasks({
      projectId: openProjectId,
      memberId: openProjectUserId,
      sprintId,
    });
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
  if (!tasksResult.ok) {
    return res.status(tasksResult.status || 503).json({ error: tasksResult.error });
  }

  const db = readDB();
  const localProject = db.projects.find(
    (project) => String(project.openProjectId) === String(openProjectId)
  );
  const localUser = db.users.find(
    (user) => String(user.openProjectUserId) === String(openProjectUserId)
  );

  const relatedCommits = db.commits
    .filter((commit) => !localProject || commit.projectId === localProject.id)
    .filter((commit) => !localUser || commit.authorId === localUser.id)
    .map((commit) => ({
      ...commit,
      workPackageIds: commitWorkPackageIds(commit.message),
      progressState: commitProgressState(commit.message),
    }))
    .filter((commit) => commit.workPackageIds.size > 0)
    .sort((a, b) => new Date(a.commitDate) - new Date(b.commitDate));

  const tasks = tasksResult.tasks.map((task) => {
    const taskCommits = relatedCommits
      .filter((commit) => commit.workPackageIds.has(task.id))
      .map((commit) => ({
        id: commit.id,
        message: commit.message,
        url: commit.url,
        commitDate: commit.commitDate,
        progressState: commit.progressState,
      }));

    return {
      ...task,
      progress: progressFromTaskAndCommits(task, taskCommits),
      commitCount: taskCommits.length,
      latestCommit: taskCommits.at(-1) || null,
      commits: taskCommits.slice(-5).reverse(),
    };
  });

  const doneCount = tasks.filter((task) => task.progress >= 100).length;
  const averageProgress =
    tasks.length === 0
      ? 0
      : Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length);

  res.json({
    summary: {
      totalTasks: tasks.length,
      doneTasks: doneCount,
      inProgressTasks: tasks.filter((task) => task.progress > 0 && task.progress < 100).length,
      notStartedTasks: tasks.filter((task) => task.progress === 0).length,
      averageProgress,
    },
    tasks,
  });
});

app.get("/api/projects", (req, res) => {
  const db = readDB();
  res.json(db.projects);
});

app.post("/api/projects", async (req, res) => {
  const { repoUrl, openProjectId } = req.body;
  if (!repoUrl || !openProjectId) {
    return res.status(400).json({ error: "Thieu openProjectId hoac repoUrl" });
  }

  let openProjectResult;
  try {
    openProjectResult = await fetchOpenProjectProjects();
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
  if (!openProjectResult.ok) {
    return res.status(openProjectResult.status || 503).json({ error: openProjectResult.error });
  }

  const openProject = openProjectResult.projects.find(
    (project) => String(project.id) === String(openProjectId)
  );
  if (!openProject) {
    return res.status(400).json({ error: "Du an OpenProject khong hop le" });
  }

  const db = readDB();
  const project = {
    id: db.nextProjectId++,
    name: openProject.name,
    openProjectId: Number(openProjectId),
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
  const { name, gitEmails, openProjectUserId } = req.body;
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
    openProjectUserId: openProjectUserId ? Number(openProjectUserId) : null,
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
