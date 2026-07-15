const $ = (sel) => document.querySelector(sel);

// Dia chi backend - doi gia tri nay neu backend chay o cong/domain khac.
// Vi du khi deploy that: const API_BASE = "https://api.ten-mien-cua-ban.com";
const API_BASE = "http://localhost:3000";

let projects = [];
let users = [];
let openProjectProjects = [];
let openProjectMembers = [];

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

  const options = projects
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  $("#filter-project").innerHTML = `<option value="">Mọi dự án</option>` + options;

  document.querySelectorAll(".del-project").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/projects/${btn.dataset.id}`, { method: "DELETE" });
      await loadProjects();
      await loadCommits();
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
  } catch (err) {
    select.innerHTML = `<option value="">Không tải được dự án OpenProject</option>`;
    $("#member-project-select").innerHTML =
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

  $("#filter-user").innerHTML =
    `<option value="">Mọi người dùng</option>` +
    users.map((u) => `<option value="${u.id}">${u.name}</option>`).join("");

  document.querySelectorAll(".del-user").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/users/${btn.dataset.id}`, { method: "DELETE" });
      await loadUsers();
      await loadCommits();
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
  await loadCommits();
});

// ---------------------------------------------------------------------------
// Simulate push

// ---------------------------------------------------------------------------
// Commit feed
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

async function loadCommits() {
  const projectId = $("#filter-project").value;
  const userId = $("#filter-user").value;
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (userId) params.set("userId", userId);

  const commits = await api(`/api/commits?${params.toString()}`);

  if (commits.length === 0) {
    $("#commit-feed").innerHTML =
      '<p class="empty-state">Chưa có commit nào khớp bộ lọc hiện tại.</p>';
    return;
  }

  $("#commit-feed").innerHTML = commits
    .map((c) => {
      const color = colorForProject(c.projectName);
      const authorTag = c.authorId
        ? `<span>${c.displayName}</span>`
        : `<span class="author-unmapped">${c.displayName}</span>`;
      return `
        <div class="commit-row">
          <div class="graph-cell">
            <div class="graph-dot" style="background:${color}"></div>
          </div>
          <div class="commit-main">
            <p class="message">${c.message}</p>
            <div class="subline">
              <span class="project-chip" style="background:${color}22;color:${color}">${c.projectName}</span>
              ${authorTag}
              <span>· ${timeAgo(c.commitDate)}</span>
            </div>
          </div>
          <div class="commit-sha">${c.id.slice(0, 7)}</div>
        </div>`;
    })
    .join("");
}

$("#filter-project").addEventListener("change", loadCommits);
$("#filter-user").addEventListener("change", loadCommits);
$("#refresh-btn").addEventListener("click", loadCommits);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await loadOpenProjectProjects();
  await loadProjects();
  await loadUsers();
  await loadCommits();
})();
