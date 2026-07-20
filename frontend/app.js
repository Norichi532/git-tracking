const $ = (sel) => document.querySelector(sel);

// Dia chi backend - doi gia tri nay neu backend chay o cong/domain khac.
// Vi du khi deploy that: const API_BASE = "https://api.ten-mien-cua-ban.com";
const API_BASE = "http://localhost:3000";

let projects = [];
let users = [];
let openProjectProjects = [];
let openProjectMembers = [];
let progressMembers = [];
let progressSprints = [];

// Mau cho tung du an, gan on dinh theo ten (de "graph line" nhat quan)
const PALETTE = ["#1F8B4C", "#2563EB", "#C2410C", "#7C3AED", "#0891B2", "#B45309"];
function colorForProject(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % PALETTE.length;
  return PALETTE[hash];
}

async function api(path, options) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Loi ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
async function loadProjects() {
  projects = await api("/api/projects");

  $("#project-list").innerHTML = projects
    .map(
      (p) => `
      <li>
        <span>${p.name} <span class="meta">${p.repoUrl}</span></span>
        <button data-id="${p.id}" class="del-project">✕</button>
      </li>`
    )
    .join("") || "";

  document.querySelectorAll(".del-project").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/projects/${btn.dataset.id}`, { method: "DELETE" });
      await loadProjects();
      await loadProgressBoard();
    };
  });
}

function openProjectProjectOptions(placeholder) {
  return (
    `<option value="">${placeholder}</option>` +
    openProjectProjects
      .map(
        (p) =>
          `<option value="${p.id}">${p.name}${
            p.identifier ? ` (${p.identifier})` : ""
          }</option>`
      )
      .join("")
  );
}

async function loadOpenProjectProjects() {
  const select = $("#openproject-project-select");
  const statusEl = $("#openproject-status");

  select.disabled = true;
  select.innerHTML = `<option value="">Đang tải dự án từ OpenProject...</option>`;
  statusEl.textContent = "";
  statusEl.className = "webhook-status neutral";

  try {
    openProjectProjects = await api("/api/openproject/projects");

    if (openProjectProjects.length === 0) {
      select.innerHTML = `<option value="">OpenProject chưa có dự án nào</option>`;
      statusEl.textContent = "Không tìm thấy dự án nào từ OpenProject.";
      return;
    }

    select.innerHTML =
      openProjectProjectOptions("Chọn dự án từ OpenProject");
    select.disabled = false;
    $("#member-project-select").innerHTML =
      openProjectProjectOptions("Chọn dự án để tải nhân viên");
    $("#progress-project-select").innerHTML =
      openProjectProjectOptions("Chọn dự án");
  } catch (err) {
    select.innerHTML = `<option value="">Không tải được dự án OpenProject</option>`;
    $("#member-project-select").innerHTML =
      `<option value="">Không tải được dự án OpenProject</option>`;
    $("#progress-project-select").innerHTML =
      `<option value="">Không tải được dự án OpenProject</option>`;
    statusEl.textContent = err.message;
    statusEl.className = "webhook-status error";
  }
}

$("#project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const selectedProject = openProjectProjects.find(
    (project) => String(project.id) === String(form.get("openProjectId"))
  );

  if (!selectedProject) {
    $("#openproject-status").textContent = "Hãy chọn một dự án OpenProject hợp lệ.";
    $("#openproject-status").className = "webhook-status error";
    return;
  }

  const created = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      openProjectId: selectedProject.id,
      repoUrl: form.get("repoUrl"),
    }),
  });
  e.target.reset();
  $("#openproject-status").textContent = "";
  $("#openproject-status").className = "webhook-status neutral";
  await loadProjects();

  const ws = created.webhookSetup;
  const statusEl = $("#project-webhook-status");
  if (!ws || !ws.attempted) {
    statusEl.textContent = ws?.reason
      ? `Chưa tự động gắn webhook: ${ws.reason}`
      : "";
    statusEl.className = "webhook-status neutral";
  } else if (ws.ok) {
    statusEl.textContent = "✓ Đã tự động gắn webhook lên GitHub thành công.";
    statusEl.className = "webhook-status success";
  } else {
    statusEl.textContent = `✕ Gắn webhook tự động thất bại: ${ws.message}`;
    statusEl.className = "webhook-status error";
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function loadOpenProjectMembers(projectId) {
  const select = $("#openproject-member-select");
  const statusEl = $("#openproject-member-status");

  openProjectMembers = [];
  select.disabled = true;
  select.innerHTML = `<option value="">Đang tải nhân viên...</option>`;
  statusEl.textContent = "";
  statusEl.className = "webhook-status neutral";

  if (!projectId) {
    select.innerHTML = `<option value="">Chọn nhân viên từ OpenProject</option>`;
    return;
  }

  try {
    openProjectMembers = await api(`/api/openproject/projects/${projectId}/members`);

    if (openProjectMembers.length === 0) {
      select.innerHTML = `<option value="">Dự án chưa có nhân viên</option>`;
      statusEl.textContent = "Không tìm thấy nhân viên nào trong dự án OpenProject này.";
      return;
    }

    select.innerHTML =
      `<option value="">Chọn nhân viên từ OpenProject</option>` +
      openProjectMembers
        .map(
          (member) =>
            `<option value="${member.id}">${member.name}${
              member.roles?.length ? ` - ${member.roles.join(", ")}` : ""
            }</option>`
        )
        .join("");
    select.disabled = false;
  } catch (err) {
    select.innerHTML = `<option value="">Không tải được nhân viên</option>`;
    statusEl.textContent = err.message;
    statusEl.className = "webhook-status error";
  }
}

async function loadUsers() {
  users = await api("/api/users");

  $("#user-list").innerHTML = users
    .map(
      (u) => `
      <li>
        <span>${u.name} <span class="meta">${u.gitEmails.join(", ")}</span></span>
        <button data-id="${u.id}" class="del-user">✕</button>
      </li>`
    )
    .join("") || "";

  document.querySelectorAll(".del-user").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/users/${btn.dataset.id}`, { method: "DELETE" });
      await loadUsers();
      await loadProgressBoard();
    };
  });
}

$("#member-project-select").addEventListener("change", async (e) => {
  $("#user-form").elements.gitEmails.value = "";
  await loadOpenProjectMembers(e.target.value);
});

$("#openproject-member-select").addEventListener("change", (e) => {
  const selectedMember = openProjectMembers.find(
    (member) => String(member.id) === String(e.target.value)
  );
  $("#user-form").elements.gitEmails.value = selectedMember?.email || "";
});

$("#user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const selectedMember = openProjectMembers.find(
    (member) => String(member.id) === String(form.get("openProjectUserId"))
  );

  if (!selectedMember) {
    $("#openproject-member-status").textContent =
      "Hãy chọn một nhân viên OpenProject hợp lệ.";
    $("#openproject-member-status").className = "webhook-status error";
    return;
  }

  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      openProjectUserId: selectedMember.id,
      name: selectedMember.name,
      gitEmails: form.get("gitEmails"),
    }),
  });
  e.target.reset();
  $("#openproject-member-select").disabled = true;
  $("#openproject-member-select").innerHTML =
    `<option value="">Chọn nhân viên từ OpenProject</option>`;
  $("#openproject-member-status").textContent = "";
  $("#openproject-member-status").className = "webhook-status neutral";
  await loadUsers();
  await loadProgressBoard();
});

// ---------------------------------------------------------------------------
// Simulate push

// ---------------------------------------------------------------------------
// Progress board
// ---------------------------------------------------------------------------
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

function progressColor(progress) {
  if (progress >= 100) return "var(--green)";
  if (progress >= 70) return "#2563EB";
  if (progress >= 30) return "#B45309";
  return "var(--rust)";
}

function renderProgressEmpty(message) {
  $("#progress-summary").innerHTML = "";
  $("#task-board").innerHTML = `<p class="empty-state">${message}</p>`;
}

async function loadProgressMembers(projectId) {
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
    progressMembers.map((member) => `<option value="${member.id}">${member.name}</option>`).join("");
  select.disabled = progressMembers.length === 0;
}

async function loadProgressSprints(projectId) {
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
    renderProgressEmpty("Chọn dự án, thành viên và sprint để xem các task được giao cùng tiến độ commit.");
    return;
  }

  statusEl.textContent = "Đang tải tiến độ...";
  statusEl.className = "webhook-status neutral";

  try {
    const params = new URLSearchParams({
      openProjectId: projectId,
      openProjectUserId: memberId,
      sprintId,
    });
    const result = await api(`/api/progress?${params.toString()}`);
    statusEl.textContent = "";

    $("#progress-summary").innerHTML = `
      <div><strong>${result.summary.totalTasks}</strong><span>Task</span></div>
      <div><strong>${result.summary.averageProgress}%</strong><span>Trung bình</span></div>
      <div><strong>${result.summary.doneTasks}</strong><span>Hoàn thành</span></div>
      <div><strong>${result.summary.inProgressTasks}</strong><span>Đang làm</span></div>
    `;

    if (result.tasks.length === 0) {
      $("#task-board").innerHTML =
        `<p class="empty-state">Không có task nào được giao cho thành viên này trong sprint đã chọn.</p>`;
      return;
    }

    $("#task-board").innerHTML = result.tasks
      .map((task) => {
        const color = progressColor(task.progress);
        const latestCommit = task.latestCommit
          ? `<span>Commit mới nhất: ${timeAgo(task.latestCommit.commitDate)}</span>`
          : `<span>Chưa có commit theo quy tắc</span>`;
        const commits = task.commits.length
          ? task.commits
              .map(
                (commit) => `
                <li>
                  <span>${commit.message}</span>
                  <code>${commit.id.slice(0, 7)}</code>
                </li>`
              )
              .join("")
          : `<li><span>Không có commit liên kết task này</span></li>`;

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
              <span>${task.type || "Task"}</span>
              <span>${task.status || "Chưa có trạng thái"}</span>
              <span>${task.commitCount} commit</span>
              ${latestCommit}
            </div>
            <ul class="task-commits">${commits}</ul>
          </article>`;
      })
      .join("");
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "webhook-status error";
  }
}

$("#progress-project-select").addEventListener("change", async (e) => {
  $("#progress-status").textContent = "";
  $("#progress-member-select").innerHTML = `<option value="">Chọn thành viên</option>`;
  $("#progress-sprint-select").innerHTML = `<option value="">Chọn sprint</option>`;
  renderProgressEmpty("Chọn thành viên và sprint để xem tiến độ.");

  await Promise.all([
    loadProgressMembers(e.target.value),
    loadProgressSprints(e.target.value),
  ]);
});

$("#progress-member-select").addEventListener("change", loadProgressBoard);
$("#progress-sprint-select").addEventListener("change", loadProgressBoard);
$("#progress-refresh-btn").addEventListener("click", loadProgressBoard);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await loadOpenProjectProjects();
  await loadProjects();
  await loadUsers();
  await loadProgressBoard();
})();
