const $ = (sel) => document.querySelector(sel);

const API_BASE_QUERY = new URLSearchParams(window.location.search).get("api");
if (API_BASE_QUERY) localStorage.setItem("gitTrackingApiBase", API_BASE_QUERY);
const API_BASE = API_BASE_QUERY || localStorage.getItem("gitTrackingApiBase") || "http://localhost:3000";
const BUSINESS_HOURS_KEY = "gitTrackingBusinessHours";
const DEFAULT_BUSINESS_HOURS = {
  enabled: true,
  timezoneOffsetMinutes: 420,
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:00",
  endTime: "17:00",
  breaks: [{ startTime: "12:00", endTime: "13:00" }],
  holidays: [],
};

let openProjectProjects = [];
let progressMembers = [];
let progressSprints = [];
let currentProgressTasks = [];
let activeTaskFilter = "all";
let taskViewMode = "detail";
let groupVisibleCounts = {};

const GROUP_PAGE_SIZE = 10;
const TASK_FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "warnings", label: "Cảnh báo" },
  { id: "no-pr", label: "Chưa có PR" },
  { id: "no-log", label: "Chưa log work" },
  { id: "large", label: "Task lớn" },
  { id: "missing-sp", label: "Thiếu SP" },
];
const TASK_GROUPS = [
  { id: "attention", title: "Cần chú ý" },
  { id: "active", title: "Đang làm" },
  { id: "reviewTesting", title: "Review/Test" },
  { id: "notStarted", title: "Chưa bắt đầu" },
  { id: "done", title: "Hoàn thành" },
  { id: "other", title: "Khác" },
];

async function api(path) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Loi ${res.status}`);
  }
  return res.json();
}

function businessHoursRule() {
  try {
    return {
      ...DEFAULT_BUSINESS_HOURS,
      ...JSON.parse(localStorage.getItem(BUSINESS_HOURS_KEY) || "{}"),
    };
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

function projectOptions(placeholder) {
  return (
    `<option value="">${placeholder}</option>` +
    openProjectProjects
      .map(
        (project) =>
          `<option value="${project.id}">${project.name}${
            project.identifier ? ` (${project.identifier})` : ""
          }</option>`
      )
      .join("")
  );
}

function progressColor(progress) {
  if (progress >= 100) return "var(--green)";
  if (progress >= 70) return "#2563EB";
  if (progress >= 30) return "#B45309";
  return "var(--rust)";
}

function formatPoints(points) {
  const value = Number(points || 0);
  return Number.isInteger(value) ? `${value} pts` : `${value.toFixed(1)} pts`;
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (
    normalized.includes("closed") ||
    normalized.includes("done") ||
    normalized.includes("resolved") ||
    normalized.includes("prod") ||
    normalized.includes("đóng") ||
    normalized.includes("hoàn thành")
  ) {
    return "is-done";
  }
  if (
    normalized.includes("progress") ||
    normalized.includes("review") ||
    normalized.includes("test") ||
    normalized.includes("qa") ||
    normalized.includes("đang")
  ) {
    return "is-active";
  }
  if (normalized.includes("block") || normalized.includes("chặn")) {
    return "is-blocked";
  }
  if (normalized.includes("rejected") || normalized.includes("cancel")) {
    return "is-muted";
  }
  return "is-planned";
}

function priorityClass(priority) {
  const normalized = String(priority || "").toLowerCase();
  if (
    normalized.includes("high") ||
    normalized.includes("urgent") ||
    normalized.includes("immediate") ||
    normalized.includes("cao") ||
    normalized.includes("khẩn")
  ) {
    return "is-high";
  }
  if (normalized.includes("low") || normalized.includes("thấp")) {
    return "is-low";
  }
  return "is-normal";
}

function formatDate(iso) {
  if (!iso) return "Chưa cập nhật";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatRelativeTime(iso) {
  if (!iso) return "chưa rõ thời gian";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0h";

  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && minutes) parts.push(`${minutes}m`);

  return parts.join(" ") || "0h";
}

function warningClass(level) {
  return level === "warning" ? "is-warning" : "is-info";
}

function renderEmpty(message) {
  $("#progress-summary").innerHTML = "";
  $("#task-controls").innerHTML = "";
  $("#task-board").innerHTML = `<p class="empty-state">${message}</p>`;
}

function taskPoints(task) {
  return task.storyPoints === null || task.storyPoints === undefined ? 0 : Number(task.storyPoints) || 0;
}

function hasWarning(task) {
  return (task.warnings || []).length > 0;
}

function warningScore(task) {
  return (task.warnings || []).reduce(
    (sum, warning) => sum + (warning.level === "warning" ? 2 : 1),
    0
  );
}

function taskHasGithubActivity(task) {
  return Boolean(task.githubActivity?.latest);
}

function taskMatchesFilter(task) {
  if (activeTaskFilter === "warnings") return hasWarning(task);
  if (activeTaskFilter === "no-pr") return !taskHasGithubActivity(task);
  if (activeTaskFilter === "no-log") return task.timeMetrics?.developmentStartedAt && !task.loggedWork?.totalMs;
  if (activeTaskFilter === "large") return taskPoints(task) >= 8;
  if (activeTaskFilter === "missing-sp") {
    return task.storyPoints === null || task.storyPoints === undefined;
  }
  return true;
}

function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const warningDiff = warningScore(b) - warningScore(a);
    if (warningDiff) return warningDiff;

    const pointDiff = taskPoints(b) - taskPoints(a);
    if (pointDiff) return pointDiff;

    return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0);
  });
}

function taskGroupId(task) {
  if (hasWarning(task)) return "attention";

  const category = task.timeMetrics?.currentStatusCategory;
  if (["active", "blocked"].includes(category)) return "active";
  if (["review", "testing", "developed"].includes(category)) return "reviewTesting";
  if (["notStarted", "ready"].includes(category)) return "notStarted";
  if (["done", "cancelled"].includes(category)) return "done";
  return "other";
}

function groupTasks(tasks) {
  const groups = Object.fromEntries(TASK_GROUPS.map((group) => [group.id, []]));
  sortedTasks(tasks.filter(taskMatchesFilter)).forEach((task) => {
    groups[taskGroupId(task)].push(task);
  });
  return groups;
}

function groupPoints(tasks) {
  return tasks.reduce((sum, task) => sum + taskPoints(task), 0);
}

function renderTaskControls() {
  $("#task-controls").innerHTML = `
    <div class="task-filter-bar" aria-label="Bộ lọc task">
      ${TASK_FILTERS.map(
        (filter) =>
          `<button type="button" class="filter-chip ${
            activeTaskFilter === filter.id ? "is-active" : ""
          }" data-filter="${filter.id}">${filter.label}</button>`
      ).join("")}
    </div>
    <div class="view-toggle" aria-label="Kiểu hiển thị task">
      <button type="button" class="${taskViewMode === "compact" ? "is-active" : ""}" data-view="compact">Compact</button>
      <button type="button" class="${taskViewMode === "detail" ? "is-active" : ""}" data-view="detail">Detail</button>
    </div>
  `;
}

function renderTaskCard(task) {
  const color = progressColor(task.progress);
  const metrics = task.timeMetrics || {};
  const githubLink = task.githubUrl
    ? `<a class="meta-chip is-github" href="${task.githubUrl}" target="_blank" rel="noreferrer">GitHub activity</a>`
    : `<span class="meta-chip is-muted">GitHub activity nằm trong OpenProject</span>`;
  const cycleRange = metrics.cycleStartedAt
    ? `${formatDate(metrics.cycleStartedAt)} -> ${
        metrics.cycleEndedAt ? formatDate(metrics.cycleEndedAt) : "đang chạy"
      }`
    : "Chưa bắt đầu";
  const latestGithub = task.githubActivity?.latest;
  const warnings = task.warnings || [];
  const loggedMs = task.loggedWork?.totalMs || 0;
  const warningList = warnings.length
    ? `
      <div class="task-warnings">
        ${warnings
          .map(
            (warning) =>
              `<span class="warning-chip ${warningClass(warning.level)}">${warning.message}</span>`
          )
          .join("")}
      </div>`
    : "";

  const compactMeta = `
    <span class="meta-chip is-type">${task.type || "Task"}</span>
    <span class="meta-chip is-points">${
      task.storyPoints === null || task.storyPoints === undefined ? "Chưa có SP" : formatPoints(task.storyPoints)
    }</span>
    <span class="meta-chip ${statusClass(task.status)}">${task.status || "Chưa có trạng thái"}</span>
    ${warnings.length ? `<span class="meta-chip is-warning-count">${warnings.length} cảnh báo</span>` : ""}
  `;

  if (taskViewMode === "compact") {
    return `
      <article class="task-card is-compact">
        <div class="task-topline">
          <a href="${task.url}" target="_blank" rel="noreferrer">#${task.displayId} ${task.subject}</a>
          <strong style="color:${color}">${task.progress}%</strong>
        </div>
        <div class="task-meta">${compactMeta}</div>
      </article>`;
  }

  const lastGithubActivity = latestGithub
    ? `
      <div class="github-activity">
        <span class="github-label">Last GitHub</span>
        <a href="${latestGithub.url || task.githubUrl}" target="_blank" rel="noreferrer">
          ${latestGithub.number ? `PR #${latestGithub.number}` : "Pull request"}: ${latestGithub.title}
        </a>
        <span class="meta-chip is-github">${latestGithub.state || "updated"} · ${formatRelativeTime(latestGithub.updatedAt)}</span>
      </div>`
    : `
      <div class="github-activity is-empty">
        <span class="github-label">Last GitHub</span>
        <span>Chưa có pull request liên kết trong OpenProject</span>
      </div>`;

  return `
    <article class="task-card">
      <div class="task-topline">
        <a href="${task.url}" target="_blank" rel="noreferrer">#${task.displayId} ${task.subject}</a>
        <strong style="color:${color}">${task.progress}%</strong>
      </div>
      <div class="progress-track">
        <div class="progress-bar" style="width:${task.progress}%;background:${color}"></div>
      </div>
      <div class="task-meta">
        ${compactMeta}
        <span class="meta-chip ${priorityClass(task.priority)}">${task.priority || "Chưa có ưu tiên"}</span>
        <span class="meta-chip is-date">Cập nhật: ${formatDate(task.updatedAt)}</span>
        ${githubLink}
      </div>
      ${lastGithubActivity}
      ${warningList}
      <div class="task-time">
        <span class="time-chip is-develop"><strong>${formatDuration(metrics.developMs)}</strong> dev time</span>
        <span class="time-chip is-logged"><strong>${formatDuration(loggedMs)}</strong> logged work</span>
        <span class="time-chip is-unaccounted"><strong>${formatDuration(metrics.unaccountedMs)}</strong> chưa phân bổ</span>
        <span class="time-chip is-blocked"><strong>${formatDuration(metrics.blockedMs)}</strong> blocked time</span>
        <span class="time-chip is-range">${cycleRange}</span>
      </div>
    </article>`;
}

function renderTaskGroups(tasks = currentProgressTasks) {
  const groups = groupTasks(tasks);
  const visibleGroupIds = TASK_GROUPS.filter((group) => groups[group.id].length > 0);

  if (!visibleGroupIds.length) {
    $("#task-board").innerHTML = `<p class="empty-state">Không có task phù hợp với bộ lọc hiện tại.</p>`;
    return;
  }

  $("#task-board").innerHTML = visibleGroupIds
    .map((group) => {
      const groupTasks = groups[group.id];
      const visibleCount = groupVisibleCounts[group.id] || GROUP_PAGE_SIZE;
      const visibleTasks = groupTasks.slice(0, visibleCount);
      const remaining = groupTasks.length - visibleTasks.length;

      return `
        <section class="task-group">
          <div class="task-group-header">
            <h3>${group.title}</h3>
            <span>${groupTasks.length} task · ${formatPoints(groupPoints(groupTasks))}</span>
          </div>
          <div class="task-group-list">
            ${visibleTasks.map(renderTaskCard).join("")}
          </div>
          ${
            remaining > 0
              ? `<button type="button" class="show-more-btn" data-show-more="${group.id}">Hiển thị thêm ${Math.min(GROUP_PAGE_SIZE, remaining)} task</button>`
              : ""
          }
        </section>`;
    })
    .join("");
}

async function loadProjects() {
  const select = $("#progress-project-select");
  const statusEl = $("#progress-status");

  select.disabled = true;
  select.innerHTML = `<option value="">Đang tải dự án...</option>`;

  try {
    openProjectProjects = await api("/api/openproject/projects");
    select.innerHTML = projectOptions("Chọn dự án");
    select.disabled = openProjectProjects.length === 0;
  } catch (err) {
    select.innerHTML = `<option value="">Không tải được dự án</option>`;
    statusEl.textContent = err.message;
    statusEl.className = "status-line error";
  }
}

async function loadMembers(projectId) {
  const select = $("#progress-member-select");
  progressMembers = [];
  select.disabled = true;
  select.innerHTML = `<option value="">Đang tải thành viên...</option>`;

  if (!projectId) {
    select.innerHTML = `<option value="">Chọn thành viên</option>`;
    return;
  }

  progressMembers = await api(`/api/openproject/projects/${projectId}/members`);
  select.innerHTML =
    `<option value="">Chọn thành viên</option>` +
    progressMembers
      .map((member) => `<option value="${member.id}">${member.name}</option>`)
      .join("");
  select.disabled = progressMembers.length === 0;
}

async function loadSprints(projectId) {
  const select = $("#progress-sprint-select");
  progressSprints = [];
  select.disabled = true;
  select.innerHTML = `<option value="">Đang tải sprint...</option>`;

  if (!projectId) {
    select.innerHTML = `<option value="">Chọn sprint</option>`;
    return;
  }

  progressSprints = await api(`/api/openproject/projects/${projectId}/sprints`);
  if (progressSprints.length === 0) {
    select.innerHTML = `<option value="">Chưa có sprint/version trong dự án</option>`;
    select.disabled = true;
    return;
  }

  select.innerHTML =
    `<option value="">Chọn sprint</option>` +
    progressSprints
      .map((sprint) => {
        const dates =
          sprint.startDate || sprint.finishDate
            ? ` (${sprint.startDate || "?"} - ${sprint.finishDate || "?"})`
            : "";
        return `<option value="${sprint.id}">${sprint.name}${dates}</option>`;
      })
      .join("");
  select.disabled = progressSprints.length === 0;
}

async function loadProgressBoard() {
  const projectId = $("#progress-project-select").value;
  const memberId = $("#progress-member-select").value;
  const sprintId = $("#progress-sprint-select").value;
  const statusEl = $("#progress-status");

  if (!projectId || !memberId || !sprintId) {
    renderEmpty("Chọn dự án, thành viên và sprint để xem tiến độ.");
    return;
  }

  statusEl.textContent = "Đang tải tiến độ...";
  statusEl.className = "status-line neutral";

  try {
    const params = new URLSearchParams({
      openProjectId: projectId,
      openProjectUserId: memberId,
      sprintId,
      businessHours: JSON.stringify(businessHoursRule()),
    });
    const result = await api(`/api/progress?${params.toString()}`);
    statusEl.textContent = "";

    $("#progress-summary").innerHTML = `
      <div><strong>${result.summary.totalTasks}</strong><span>Task</span></div>
      <div><strong>${result.summary.averageProgress}%</strong><span>Trung bình</span></div>
      <div><strong>${result.summary.weightedProgress}%</strong><span>Theo story point</span></div>
      <div><strong>${formatPoints(result.summary.assignedPoints)}</strong><span>Assigned</span></div>
      <div><strong>${formatPoints(result.summary.donePoints)}</strong><span>Done points</span></div>
      <div><strong>${formatPoints(result.summary.remainingPoints)}</strong><span>Remaining</span></div>
      <div><strong>${result.summary.doneTasks}</strong><span>Hoàn thành</span></div>
      <div><strong>${result.summary.inProgressTasks}</strong><span>Đang làm</span></div>
      <div><strong>${formatDuration(result.summary.averageDevelopMs)}</strong><span>Dev TB (${result.summary.developedTasks})</span></div>
      <div><strong>${formatDuration(result.summary.totalLoggedMs)}</strong><span>Logged work</span></div>
      <div><strong>${formatDuration(result.summary.totalUnaccountedMs)}</strong><span>Chưa phân bổ</span></div>
      <div><strong>${formatDuration(result.summary.totalBlockedMs)}</strong><span>Blocked</span></div>
      <div><strong>${result.summary.warningCount}</strong><span>Cảnh báo</span></div>
    `;

    currentProgressTasks = result.tasks;
    groupVisibleCounts = {};
    renderTaskControls();

    if (currentProgressTasks.length === 0) {
      $("#task-board").innerHTML =
        `<p class="empty-state">Không có task nào được giao cho thành viên này trong sprint đã chọn.</p>`;
      return;
    }

    renderTaskGroups();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "status-line error";
  }
}

$("#progress-project-select").addEventListener("change", async (event) => {
  const projectId = event.target.value;
  $("#progress-status").textContent = "";
  $("#progress-member-select").innerHTML = `<option value="">Chọn thành viên</option>`;
  $("#progress-sprint-select").innerHTML = `<option value="">Chọn sprint</option>`;
  renderEmpty("Chọn thành viên và sprint để xem tiến độ.");

  await Promise.all([loadMembers(projectId), loadSprints(projectId)]);
});

$("#progress-member-select").addEventListener("change", loadProgressBoard);
$("#progress-sprint-select").addEventListener("change", loadProgressBoard);
$("#progress-refresh-btn").addEventListener("click", loadProgressBoard);
$("#task-controls").addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    activeTaskFilter = filterButton.dataset.filter;
    groupVisibleCounts = {};
    renderTaskControls();
    renderTaskGroups();
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    taskViewMode = viewButton.dataset.view;
    renderTaskControls();
    renderTaskGroups();
  }
});
$("#task-board").addEventListener("click", (event) => {
  const button = event.target.closest("[data-show-more]");
  if (!button) return;

  const groupId = button.dataset.showMore;
  groupVisibleCounts[groupId] = (groupVisibleCounts[groupId] || GROUP_PAGE_SIZE) + GROUP_PAGE_SIZE;
  renderTaskGroups();
});

(async function init() {
  await loadProjects();
  await loadProgressBoard();
})();
