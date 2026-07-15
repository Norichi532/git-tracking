// github.js
// Goi GitHub REST API de TU DONG gan webhook len 1 repo, thay vi phai vao
// Settings > Webhooks lam bang tay. Can GITHUB_TOKEN (Personal Access Token)
// co quyen ghi webhook (classic PAT voi scope "repo", hoac fine-grained PAT
// voi quyen "Webhooks: Read & write").

// Tach owner/repo tu 1 URL GitHub, vi du:
// https://github.com/octocat/hello-world -> { owner: "octocat", repo: "hello-world" }
function parseGithubRepo(repoUrl) {
  try {
    const clean = repoUrl.trim().replace(/\.git$/, "").replace(/\/+$/, "");
    const match = clean.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

// Tao webhook tren GitHub tro ve webhookUrl (URL public cua server minh, vd ngrok)
async function createGithubWebhook({ owner, repo, token, webhookUrl }) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/hooks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push"],
        config: {
          url: webhookUrl,
          content_type: "json",
        },
      }),
    }
  );

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Loi thuong gap: 404 (token khong co quyen/repo sai ten),
    // 422 (webhook voi URL nay da ton tai san roi)
    return {
      ok: false,
      status: res.status,
      message: data.message || `GitHub API loi ${res.status}`,
    };
  }

  return { ok: true, status: 201, hookId: data.id };
}

// Xoa 1 webhook tren GitHub theo hookId da luu lai luc tao.
async function deleteGithubWebhook({ owner, repo, token, hookId }) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  // 204 = xoa thanh cong. 404 = webhook da bi xoa tu truoc (coi nhu ok,
  // khong can bao loi vi ket qua cuoi cung giong nhau: khong con webhook nua).
  if (res.status === 204 || res.status === 404) {
    return { ok: true };
  }

  const data = await res.json().catch(() => ({}));
  return {
    ok: false,
    status: res.status,
    message: data.message || `GitHub API loi ${res.status}`,
  };
}

module.exports = { parseGithubRepo, createGithubWebhook, deleteGithubWebhook };
