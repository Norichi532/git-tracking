const $ = (sel) => document.querySelector(sel);

// Dia chi backend - doi gia tri nay neu backend chay o cong/domain khac.
// Vi du khi deploy that: const API_BASE = "https://api.ten-mien-cua-ban.com";
const API_BASE = "http://localhost:3000";

let projects = [];
let users = [];

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

$("#project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const created = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: form.get("name"), repoUrl: form.get("repoUrl") }),
  });
  e.target.reset();
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

$("#user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({ name: form.get("name"), gitEmails: form.get("gitEmails") }),
  });
  e.target.reset();
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
  await loadProjects();
  await loadUsers();
  await loadCommits();
})();
