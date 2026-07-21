const { loadEnv } = require("./env");
loadEnv();

const express = require("express");
const cors = require("cors");
const {
  fetchOpenProjectProjects,
  fetchOpenProjectProjectMembers,
  fetchOpenProjectProjectSprints,
  fetchOpenProjectSprintTasks,
} = require("./openproject");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function sendOpenProjectResult(res, result, key) {
  if (!result.ok) {
    return res.status(result.status || 503).json({ error: result.error });
  }
  return res.json(result[key]);
}

function progressFromTask(task) {
  if (task.percentageDone !== null && task.percentageDone !== undefined) {
    return Number(task.percentageDone);
  }

  const status = String(task.status || "").toLowerCase();
  if (
    status.includes("done") ||
    status.includes("closed") ||
    status.includes("resolved") ||
    status.includes("đóng")
  ) {
    return 100;
  }

  return 0;
}

function parseBusinessHoursRule(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
}

app.get("/api/openproject/projects", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjects();
    return sendOpenProjectResult(res, result, "projects");
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

app.get("/api/openproject/projects/:id/members", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjectMembers(req.params.id);
    return sendOpenProjectResult(res, result, "members");
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

app.get("/api/openproject/projects/:id/sprints", async (req, res) => {
  try {
    const result = await fetchOpenProjectProjectSprints(req.params.id);
    return sendOpenProjectResult(res, result, "sprints");
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }
});

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
      businessHoursRule: parseBusinessHoursRule(req.query.businessHours),
    });
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the ket noi OpenProject" });
  }

  if (!tasksResult.ok) {
    return res.status(tasksResult.status || 503).json({ error: tasksResult.error });
  }

  const tasks = tasksResult.tasks.map((task) => ({
    ...task,
    progress: progressFromTask(task),
  }));

  const doneCount = tasks.filter((task) => task.progress >= 100).length;
  const averageProgress =
    tasks.length === 0
      ? 0
      : Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length);
  const activeTasks = tasks.filter((task) => task.timeMetrics?.activeMs > 0);
  const averageActiveMs =
    activeTasks.length === 0
      ? 0
      : Math.round(
          activeTasks.reduce((sum, task) => sum + task.timeMetrics.activeMs, 0) /
            activeTasks.length
        );
  const totalBlockedMs = tasks.reduce(
    (sum, task) => sum + (task.timeMetrics?.blockedMs || 0),
    0
  );

  return res.json({
    summary: {
      totalTasks: tasks.length,
      doneTasks: doneCount,
      inProgressTasks: tasks.filter((task) => task.progress > 0 && task.progress < 100).length,
      notStartedTasks: tasks.filter((task) => task.progress === 0).length,
      averageProgress,
      averageActiveMs,
      totalBlockedMs,
    },
    tasks,
  });
});

app.listen(PORT, () => {
  console.log(`Git Tracking Dashboard API dang chay tai http://localhost:${PORT}`);
  console.log("Source of truth: OpenProject + OpenProject GitHub integration");
});
