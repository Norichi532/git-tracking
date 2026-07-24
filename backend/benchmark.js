const fs = require("fs");
const path = require("path");
const {
  fetchOpenProjectProjectSprints,
  fetchOpenProjectSprintTasks,
  businessMsBetween,
} = require("./openproject");

const MS_PER_HOUR = 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, "data");
const BENCHMARK_FILE = path.join(DATA_DIR, "benchmarks.json");
const MIN_SAMPLE_SIZE = 5;
const COMPLETED_SPRINT_LIMIT = 3;

function benchmarkKey(projectId, memberId) {
  return `${projectId}:${memberId}`;
}

function emptyStore() {
  return { version: 1, benchmarks: {} };
}

function readBenchmarkStore() {
  try {
    if (!fs.existsSync(BENCHMARK_FILE)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(BENCHMARK_FILE, "utf8"));
    return {
      version: 1,
      benchmarks: parsed && typeof parsed.benchmarks === "object" ? parsed.benchmarks : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeBenchmarkStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${BENCHMARK_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2));
  fs.renameSync(tmpFile, BENCHMARK_FILE);
}

function getStoredBenchmark(projectId, memberId) {
  const store = readBenchmarkStore();
  return store.benchmarks[benchmarkKey(projectId, memberId)] || null;
}

function saveStoredBenchmark(benchmark) {
  const store = readBenchmarkStore();
  store.benchmarks[benchmarkKey(benchmark.openProjectId, benchmark.memberId)] = benchmark;
  writeBenchmarkStore(store);
  return benchmark;
}

function parseDateMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function parseSprintFinishMs(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T23:59:59`).getTime();
  }
  return parseDateMs(value);
}

function sprintSortValue(sprint) {
  return parseDateMs(sprint.finishDate) || parseDateMs(sprint.startDate) || 0;
}

function selectBenchmarkSprints(sprints) {
  const now = Date.now();
  const completed = sprints
    .filter((sprint) => {
      const finish = parseDateMs(sprint.finishDate);
      return finish && finish <= now;
    })
    .sort((a, b) => sprintSortValue(b) - sprintSortValue(a))
    .slice(0, COMPLETED_SPRINT_LIMIT);

  const selected = [...completed];
  const selectedIds = new Set(selected.map((sprint) => String(sprint.id)));
  const latestFallback = [...sprints]
    .filter((sprint) => !selectedIds.has(String(sprint.id)))
    .sort((a, b) => sprintSortValue(b) - sprintSortValue(a))[0];

  return { selected, latestFallback };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return Math.round(sorted[index]);
}

function collectBenchmarkSamples(tasks, exclusions) {
  const samples = [];

  for (const task of tasks) {
    const points = Number(task.storyPoints);
    const implementationMs = Number(task.timeMetrics?.implementationMs || 0);
    const category = task.timeMetrics?.currentStatusCategory;

    if (category === "cancelled") {
      exclusions.cancelled += 1;
      continue;
    }
    if (!Number.isFinite(points) || points <= 0) {
      exclusions.missingStoryPoints += 1;
      continue;
    }
    if (!Number.isFinite(implementationMs) || implementationMs <= 0) {
      exclusions.missingImplementationTime += 1;
      continue;
    }

    samples.push({
      taskId: task.id,
      displayId: task.displayId,
      storyPoints: points,
      implementationMs,
      msPerPoint: implementationMs / points,
    });
  }

  return samples;
}

function summarizeSamples({ projectId, memberId, source, sprintIds, sprintNames, samples, exclusions }) {
  const values = samples.map((sample) => sample.msPerPoint);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    openProjectId: String(projectId),
    memberId: String(memberId),
    source,
    sprintIds,
    sprintNames,
    sampleSize: samples.length,
    avgMsPerPoint: values.length ? Math.round(sum / values.length) : 0,
    medianMsPerPoint: percentile(values, 0.5),
    p80MsPerPoint: percentile(values, 0.8),
    excluded: exclusions,
    calculatedAt: new Date().toISOString(),
    timeMode: "business",
  };
}

async function fetchSprintSamples({ projectId, memberId, sprint, businessHoursRule, exclusions }) {
  const result = await fetchOpenProjectSprintTasks({
    projectId,
    memberId,
    sprintId: sprint.id,
    businessHoursRule,
    includeGithubActivity: false,
    includeLoggedWork: false,
  });
  if (!result.ok) {
    throw new Error(result.error || `Khong the tai task sprint ${sprint.id}`);
  }
  return collectBenchmarkSamples(result.tasks, exclusions);
}

async function recalculateStoryPointBenchmark({ projectId, memberId, businessHoursRule }) {
  const sprintsResult = await fetchOpenProjectProjectSprints(projectId);
  if (!sprintsResult.ok) return sprintsResult;

  const { selected, latestFallback } = selectBenchmarkSprints(sprintsResult.sprints || []);
  const selectedById = new Map(selected.map((sprint) => [String(sprint.id), sprint]));
  const exclusions = { missingStoryPoints: 0, missingImplementationTime: 0, cancelled: 0 };
  let samples = [];

  for (const sprint of selected) {
    samples = samples.concat(
      await fetchSprintSamples({ projectId, memberId, sprint, businessHoursRule, exclusions })
    );
  }

  let source = "completed_sprints";
  if (samples.length < MIN_SAMPLE_SIZE && latestFallback) {
    selectedById.set(String(latestFallback.id), latestFallback);
    source = selected.length ? "completed_sprints_fallback_latest" : "latest_sprint";
    samples = samples.concat(
      await fetchSprintSamples({
        projectId,
        memberId,
        sprint: latestFallback,
        businessHoursRule,
        exclusions,
      })
    );
  }

  const sourceSprints = [...selectedById.values()];
  const benchmark = summarizeSamples({
    projectId,
    memberId,
    source,
    sprintIds: sourceSprints.map((sprint) => sprint.id),
    sprintNames: sourceSprints.map((sprint) => sprint.name),
    samples,
    exclusions,
  });

  return { ok: true, benchmark: saveStoredBenchmark(benchmark) };
}

function benchmarkConfidence(sampleSize) {
  if (sampleSize >= 10) return 0.85;
  if (sampleSize >= MIN_SAMPLE_SIZE) return 0.72;
  if (sampleSize > 0) return 0.55;
  return 0;
}

function buildBaselineForecast(task, benchmark, sprint, businessHoursRule) {
  const category = task.timeMetrics?.currentStatusCategory;
  const points = Number(task.storyPoints);
  const elapsedMs = Number(task.timeMetrics?.implementationElapsedMs || 0);
  const baselineMs = Number(benchmark?.medianMsPerPoint || 0);
  const finishMs = parseSprintFinishMs(sprint?.finishDate);
  const labels = {
    on_track: "Theo baseline",
    at_risk: "Rủi ro baseline",
    off_track: "Vượt baseline",
    unknown: "Thiếu baseline",
  };

  const unknown = (reason) => ({
    risk: "unknown",
    label: labels.unknown,
    confidence: benchmarkConfidence(benchmark?.sampleSize || 0),
    source: "story-point-baseline",
    reason,
    expectedMs: 0,
    elapsedMs,
    remainingExpectedMs: 0,
    remainingSprintBusinessMs: finishMs ? businessMsBetween(Date.now(), finishMs, businessHoursRule) : null,
    avgMsPerPoint: benchmark?.avgMsPerPoint || 0,
    medianMsPerPoint: benchmark?.medianMsPerPoint || 0,
    p80MsPerPoint: benchmark?.p80MsPerPoint || 0,
    sampleSize: benchmark?.sampleSize || 0,
  });

  if (category !== "active") return null;
  if (!benchmark || !baselineMs || !benchmark.sampleSize) {
    return unknown("Chưa có baseline story point cho nhân viên này.");
  }
  if (!Number.isFinite(points) || points <= 0) {
    return unknown("Task chưa có story point nên chưa thể so với baseline cá nhân.");
  }
  if (!task.timeMetrics?.developmentStartedAt) {
    return unknown("Task chưa có mốc vào In Progress.");
  }
  if (!finishMs) {
    return unknown("Sprint chưa có ngày kết thúc để so sánh thời gian còn lại.");
  }

  const expectedMs = Math.round(points * baselineMs);
  const remainingExpectedMs = Math.max(0, expectedMs - elapsedMs);
  const remainingSprintBusinessMs = businessMsBetween(Date.now(), finishMs, businessHoursRule);
  let risk = "on_track";
  let reason = "Thời gian đã dùng vẫn nằm trong baseline cá nhân.";

  if (elapsedMs > expectedMs || remainingExpectedMs > remainingSprintBusinessMs) {
    risk = "off_track";
    reason =
      elapsedMs > expectedMs
        ? "Task đã vượt thời gian kỳ vọng theo baseline cá nhân."
        : "Thời gian kỳ vọng còn lại lớn hơn thời gian sprint còn lại.";
  } else if (elapsedMs >= expectedMs * 0.8 || remainingExpectedMs >= remainingSprintBusinessMs * 0.8) {
    risk = "at_risk";
    reason = "Task đã dùng gần hết baseline hoặc thời gian còn lại khá sát.";
  }

  return {
    risk,
    label: labels[risk],
    confidence: benchmarkConfidence(benchmark.sampleSize),
    source: "story-point-baseline",
    reason,
    expectedMs,
    elapsedMs,
    remainingExpectedMs,
    remainingSprintBusinessMs,
    avgMsPerPoint: benchmark.avgMsPerPoint,
    medianMsPerPoint: benchmark.medianMsPerPoint,
    p80MsPerPoint: benchmark.p80MsPerPoint,
    sampleSize: benchmark.sampleSize,
  };
}

function attachBaselineForecasts({ tasks, benchmark, sprint, businessHoursRule }) {
  return tasks.map((task) => ({
    ...task,
    baselineForecast: buildBaselineForecast(task, benchmark, sprint, businessHoursRule),
  }));
}

module.exports = {
  getStoredBenchmark,
  recalculateStoryPointBenchmark,
  attachBaselineForecasts,
};
