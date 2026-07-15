// openproject.js
// Fetch project choices from OpenProject API v3.

function requireOpenProjectConfig() {
  const baseUrl = (process.env.OPENPROJECT_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.OPENPROJECT_API_KEY || "";

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error: "Chua cau hinh OPENPROJECT_BASE_URL hoac OPENPROJECT_API_KEY trong .env",
    };
  }

  return { ok: true, baseUrl, apiKey };
}

function openProjectAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`;
}

function absoluteOpenProjectUrl(baseUrl, href) {
  if (/^https?:\/\//i.test(href)) return href;
  return `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

async function fetchOpenProjectJson({ baseUrl, apiKey, href }) {
  const res = await fetch(absoluteOpenProjectUrl(baseUrl, href), {
    headers: {
      Authorization: openProjectAuthHeader(apiKey),
      Accept: "application/hal+json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: data.message || data.errorIdentifier || `OpenProject API loi ${res.status}`,
    };
  }

  return { ok: true, data };
}

async function fetchOpenProjectCollection({ baseUrl, apiKey, href }) {
  const pageSize = 100;
  let offset = 1;
  let total = null;
  const elements = [];

  while (total === null || elements.length < total) {
    const url = new URL(absoluteOpenProjectUrl(baseUrl, href));
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const result = await fetchOpenProjectJson({
      baseUrl,
      apiKey,
      href: `${url.pathname}${url.search}`,
    });
    if (!result.ok) return result;

    const pageElements = result.data._embedded?.elements || [];
    total = Number(result.data.total || pageElements.length);
    elements.push(...pageElements);

    if (pageElements.length === 0) break;
    offset++;
  }

  return { ok: true, elements };
}

async function fetchOpenProjectProjects() {
  const config = requireOpenProjectConfig();
  if (!config.ok) return config;

  const result = await fetchOpenProjectCollection({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: "/api/v3/projects",
  });
  if (!result.ok) return result;

  const normalizedProjects = result.elements
    .map((project) => ({
      id: project.id,
      name: project.name,
      identifier: project.identifier,
    }))
    .filter((project) => project.id && project.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, projects: normalizedProjects };
}

async function fetchOpenProjectProjectMembers(projectId) {
  const config = requireOpenProjectConfig();
  if (!config.ok) return config;

  const projectResult = await fetchOpenProjectJson({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: `/api/v3/projects/${projectId}`,
  });
  if (!projectResult.ok) return projectResult;

  const membershipsHref = projectResult.data._links?.memberships?.href;
  if (!membershipsHref) {
    return { ok: true, members: [] };
  }

  const membershipsResult = await fetchOpenProjectCollection({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: membershipsHref,
  });
  if (!membershipsResult.ok) return membershipsResult;

  const members = await Promise.all(
    membershipsResult.elements.map(async (membership) => {
      const principal = membership._links?.principal;
      const href = principal?.href || "";
      const id = href.match(/\/api\/v3\/users\/(\d+)$/)?.[1] || null;
      const member = {
        id: id ? Number(id) : null,
        name: principal?.title || membership._links?.self?.title || "Unknown",
        email: "",
        roles: (membership._links?.roles || []).map((role) => role.title).filter(Boolean),
      };

      if (href) {
        const userResult = await fetchOpenProjectJson({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          href,
        });
        if (userResult.ok) {
          member.name = userResult.data.name || member.name;
          member.email = userResult.data.email || "";
          member.login = userResult.data.login || "";
        }
      }

      return member;
    })
  );

  return {
    ok: true,
    members: members
      .filter((member) => member.id && member.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

module.exports = { fetchOpenProjectProjects, fetchOpenProjectProjectMembers };
