const $ = (sel) => document.querySelector(sel);

const API_BASE = "http://localhost:3000";
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

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (
    normalized.includes("closed") ||
    normalized.includes("done") ||
    normalized.includes("resolved") ||
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

function renderEmpty(message) {
  $("#progress-summary").innerHTML = "";
  $("#task-board").innerHTML = `<p class="empty-state">${message}</p>`;
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
      <div><strong>${result.summary.doneTasks}</strong><span>Hoàn thành</span></div>
      <div><strong>${result.summary.inProgressTasks}</strong><span>Đang làm</span></div>
      <div><strong>${formatDuration(result.summary.averageActiveMs)}</strong><span>Active TB</span></div>
      <div><strong>${formatDuration(result.summary.totalBlockedMs)}</strong><span>Blocked</span></div>
    `;

    if (result.tasks.length === 0) {
      $("#task-board").innerHTML =
        `<p class="empty-state">Không có task nào được giao cho thành viên này trong sprint đã chọn.</p>`;
      return;
    }

    $("#task-board").innerHTML = result.tasks
      .map((task) => {
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
              <span class="meta-chip is-type">${task.type || "Task"}</span>
              <span class="meta-chip ${statusClass(task.status)}">${task.status || "Chưa có trạng thái"}</span>
              <span class="meta-chip ${priorityClass(task.priority)}">${task.priority || "Chưa có ưu tiên"}</span>
              <span class="meta-chip is-date">Cập nhật: ${formatDate(task.updatedAt)}</span>
              ${githubLink}
            </div>
            <div class="task-time">
              <span class="time-chip is-cycle"><strong>${formatDuration(metrics.cycleMs)}</strong> cycle time</span>
              <span class="time-chip is-active"><strong>${formatDuration(metrics.activeMs)}</strong> active time</span>
              <span class="time-chip is-blocked"><strong>${formatDuration(metrics.blockedMs)}</strong> blocked time</span>
              <span class="time-chip is-range">${cycleRange}</span>
            </div>
          </article>`;
      })
      .join("");
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

(async function init() {
  await loadProjects();
  await loadProgressBoard();
})();
