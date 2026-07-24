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
const { buildTaskForecasts } = require("./forecast");
const {
  attachBaselineForecasts,
  getStoredBenchmark,
  recalculateStoryPointBenchmark,
} = require("./benchmark");

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

  if (task.timeMetrics?.currentStatusCategory === "done") {
    return 100;
  }

  if (task.timeMetrics?.currentStatusCategory === "cancelled") {
    return 0;
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

app.get("/api/benchmarks", (req, res) => {
  const { openProjectId, openProjectUserId } = req.query;
  if (!openProjectId || !openProjectUserId) {
    return res.status(400).json({
      error: "Thieu openProjectId hoac openProjectUserId",
    });
  }

  return res.json({
    benchmark: getStoredBenchmark(openProjectId, openProjectUserId),
  });
});

app.post("/api/benchmarks/recalculate", async (req, res) => {
  const openProjectId = req.body?.openProjectId || req.query.openProjectId;
  const openProjectUserId = req.body?.openProjectUserId || req.query.openProjectUserId;

  if (!openProjectId || !openProjectUserId) {
    return res.status(400).json({
      error: "Thieu openProjectId hoac openProjectUserId",
    });
  }

  try {
    const result = await recalculateStoryPointBenchmark({
      projectId: openProjectId,
      memberId: openProjectUserId,
      businessHoursRule: parseBusinessHoursRule(
        req.body?.businessHours || req.query.businessHours
      ),
    });
    if (!result.ok) {
      return res.status(result.status || 503).json({ error: result.error });
    }
    return res.json({ benchmark: result.benchmark });
  } catch (err) {
    return res.status(503).json({ error: err.message || "Khong the tinh baseline" });
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

  const businessHoursRule = parseBusinessHoursRule(req.query.businessHours);
  let tasks = tasksResult.tasks.map((task) => ({
    ...task,
    progress: progressFromTask(task),
  }));

  const sprintsResult = await fetchOpenProjectProjectSprints(openProjectId).catch((err) => ({
    ok: false,
    error: err.message,
  }));
  const sprint = sprintsResult.ok
    ? (sprintsResult.sprints || []).find((item) => String(item.id) === String(sprintId)) || null
    : null;
  const aiEnabled = String(req.query.ai || "false").toLowerCase() === "true";
  tasks = await buildTaskForecasts({ tasks, sprint, aiEnabled });
  const storyPointBenchmark = getStoredBenchmark(openProjectId, openProjectUserId);
  tasks = attachBaselineForecasts({
    tasks,
    benchmark: storyPointBenchmark,
    sprint,
    businessHoursRule,
  });

  const doneCount = tasks.filter((task) => task.progress >= 100).length;
  const averageProgress =
    tasks.length === 0
      ? 0
      : Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length);
  const pointTasks = tasks.filter(
    (task) =>
      task.storyPoints !== null &&
      task.storyPoints !== undefined &&
      Number.isFinite(Number(task.storyPoints))
  );
  const assignedPoints = pointTasks.reduce((sum, task) => sum + Number(task.storyPoints), 0);
  const donePoints = pointTasks
    .filter((task) => task.progress >= 100)
    .reduce((sum, task) => sum + Number(task.storyPoints), 0);
  const inProgressPoints = pointTasks
    .filter((task) => task.progress > 0 && task.progress < 100)
    .reduce((sum, task) => sum + Number(task.storyPoints), 0);
  const remainingPoints = Math.max(0, assignedPoints - donePoints);
  const weightedProgress =
    assignedPoints === 0
      ? averageProgress
      : Math.round(
          pointTasks.reduce(
            (sum, task) => sum + Number(task.storyPoints) * (task.progress || 0),
            0
          ) / assignedPoints
        );
  const totalBlockedMs = tasks.reduce(
    (sum, task) => sum + (task.timeMetrics?.blockedMs || 0),
    0
  );
  const totalLoggedMs = tasks.reduce(
    (sum, task) => sum + (task.loggedWork?.totalMs || 0),
    0
  );
  const totalUnaccountedMs = tasks.reduce(
    (sum, task) => sum + (task.timeMetrics?.unaccountedMs || 0),
    0
  );
  const implementedTasks = tasks.filter((task) => task.timeMetrics?.implementationMs > 0);
  const averageImplementationMs =
    implementedTasks.length === 0
      ? 0
      : Math.round(
          implementedTasks.reduce((sum, task) => sum + task.timeMetrics.implementationMs, 0) /
            implementedTasks.length
        );
  const warningCount = tasks.reduce((sum, task) => sum + (task.warnings?.length || 0), 0);
  const forecastCounts = tasks.reduce(
    (counts, task) => {
      const risk = task.forecast?.risk || "unknown";
      counts[risk] = (counts[risk] || 0) + 1;
      return counts;
    },
    { on_track: 0, at_risk: 0, off_track: 0, unknown: 0 }
  );
  const baselineForecastCounts = tasks.reduce(
    (counts, task) => {
      const risk = task.baselineForecast?.risk;
      if (risk) counts[risk] = (counts[risk] || 0) + 1;
      return counts;
    },
    { on_track: 0, at_risk: 0, off_track: 0, unknown: 0 }
  );

  return res.json({
    summary: {
      totalTasks: tasks.length,
      doneTasks: doneCount,
      inProgressTasks: tasks.filter((task) => task.progress > 0 && task.progress < 100).length,
      notStartedTasks: tasks.filter((task) => task.progress === 0).length,
      averageProgress,
      weightedProgress,
      assignedPoints,
      donePoints,
      inProgressPoints,
      remainingPoints,
      missingStoryPointTasks: tasks.length - pointTasks.length,
      totalBlockedMs,
      totalLoggedMs,
      totalUnaccountedMs,
      implementedTasks: implementedTasks.length,
      averageImplementationMs,
      warningCount,
      forecastCounts,
      baselineForecastCounts,
      storyPointBenchmark,
      aiForecastEnabled: aiEnabled,
    },
    tasks,
  });
});

app.listen(PORT, () => {
  console.log(`Git Tracking Dashboard API dang chay tai http://localhost:${PORT}`);
  console.log("Source of truth: OpenProject + OpenProject GitHub integration");
});
