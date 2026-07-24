// openproject.js
// Fetch project choices from OpenProject API v3.

const statusMapping = require("./status-mapping.json");
const OPENPROJECT_CACHE_TTL_MS = Number(process.env.OPENPROJECT_CACHE_TTL_MS || 3 * 60 * 1000);
const openProjectCache = new Map();

function cacheKey(parts) {
  return parts.join("::");
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCache(key) {
  if (!OPENPROJECT_CACHE_TTL_MS) return null;
  const hit = openProjectCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    openProjectCache.delete(key);
    return null;
  }
  return cloneData(hit.value);
}

function setCache(key, value) {
  if (!OPENPROJECT_CACHE_TTL_MS) return;
  openProjectCache.set(key, {
    value: cloneData(value),
    expiresAt: Date.now() + OPENPROJECT_CACHE_TTL_MS,
  });
}

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
  const key = cacheKey(["json", baseUrl, href]);
  const cached = getCache(key);
  if (cached) return cached;

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

  const result = { ok: true, data };
  setCache(key, result);
  return result;
}

async function fetchOpenProjectCollection({ baseUrl, apiKey, href }) {
  const key = cacheKey(["collection", baseUrl, href]);
  const cached = getCache(key);
  if (cached) return cached;

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

  const result = { ok: true, elements };
  setCache(key, result);
  return result;
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

async function fetchOpenProjectProjectSprints(projectId) {
  const config = requireOpenProjectConfig();
  if (!config.ok) return config;

  const projectResult = await fetchOpenProjectJson({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: `/api/v3/projects/${projectId}`,
  });
  if (!projectResult.ok) return projectResult;

  const versionsHrefs = [
    projectResult.data._links?.versions?.href,
    `/api/v3/workspaces/${projectId}/versions`,
    `/api/v3/projects/${projectId}/versions`,
  ].filter(Boolean);

  const uniqueVersionHrefs = [...new Set(versionsHrefs)];
  let result = null;

  for (const href of uniqueVersionHrefs) {
    result = await fetchOpenProjectCollection({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      href,
    });

    if (!result.ok) {
      if (result.status === 404 && href !== uniqueVersionHrefs[uniqueVersionHrefs.length - 1]) {
        continue;
      }
      return result;
    }

    if (result.elements.length > 0) break;
  }

  if (!result) return { ok: true, sprints: [] };

  const sprints = result.elements
    .map((version) => ({
      id: version.id,
      name: version.name,
      startDate: version.startDate || "",
      finishDate: version.endDate || version.effectiveDate || "",
      status: version._links?.status?.title || version.status || "",
      source: "version",
    }))
    .filter((sprint) => sprint.id && sprint.name)
    .sort((a, b) => {
      const left = a.startDate || "";
      const right = b.startDate || "";
      return right.localeCompare(left) || a.name.localeCompare(b.name);
    });

  return { ok: true, sprints };
}

function linkId(link, resourceName) {
  const href = link?.href || "";
  const match = href.match(new RegExp(`/api/v3/${resourceName}/(\\d+)$`));
  return match ? Number(match[1]) : null;
}

function normalizeStatusText(value) {
  return String(value || "").trim().toLowerCase();
}

function statusList(name) {
  return Array.isArray(statusMapping[name]) ? statusMapping[name] : [];
}

function statusInList(status, listName) {
  const normalized = normalizeStatusText(status);
  return statusList(listName).some((item) => normalizeStatusText(item) === normalized);
}

function categoryInList(category, listName) {
  return statusList(listName).includes(category);
}

function configuredStatusCategory(status) {
  const categories = [
    "notStarted",
    "ready",
    "active",
    "review",
    "testing",
    "developed",
    "blocked",
    "done",
    "cancelled",
  ];

  for (const category of categories) {
    if (statusInList(status, category)) return category;
  }

  return null;
}

function statusCategory(status) {
  const configured = configuredStatusCategory(status);
  if (configured) return configured;

  const normalized = String(status || "").toLowerCase();

  if (
    normalized.includes("block") ||
    normalized.includes("blocked") ||
    normalized.includes("chặn")
  ) {
    return "blocked";
  }

  if (
    normalized.includes("closed") ||
    normalized.includes("done") ||
    normalized.includes("resolved") ||
    normalized.includes("rejected") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled") ||
    normalized.includes("đóng") ||
    normalized.includes("hoàn thành")
  ) {
    return "done";
  }

  if (
    normalized.includes("progress") ||
    normalized.includes("review") ||
    normalized.includes("test") ||
    normalized.includes("qa") ||
    normalized.includes("develop") ||
    normalized.includes("implement") ||
    normalized.includes("đang")
  ) {
    return "active";
  }

  return "notStarted";
}

function isInProgressStatus(status) {
  return statusInList(status, "devStart");
}

function isDevelopedStatus(status) {
  if (statusInList(status, "devEnd")) return true;

  const normalized = String(status || "").toLowerCase().trim();
  return (
    normalized === "developed" ||
    normalized === "dev done" ||
    normalized === "development done" ||
    normalized === "đã phát triển"
  );
}

function parseStatusChange(raw) {
  const text = String(raw || "").trim();
  const setMatch = text.match(/^(?:Status|Trạng thái) set to (.+)$/i);
  if (setMatch) {
    return { from: null, to: setMatch[1].trim() };
  }

  const changedMatch = text.match(
    /^(?:Status|Trạng thái) changed from (.+?) to (.+)$/i
  );
  if (changedMatch) {
    return {
      from: changedMatch[1].trim(),
      to: changedMatch[2].trim(),
    };
  }

  return null;
}

async function fetchWorkPackageStatusChanges({ baseUrl, apiKey, workPackageId }) {
  const result = await fetchOpenProjectCollection({
    baseUrl,
    apiKey,
    href: `/api/v3/work_packages/${workPackageId}/activities`,
  });
  if (!result.ok) return result;

  const changes = result.elements
    .flatMap((activity) =>
      (activity.details || [])
        .map((detail) => parseStatusChange(detail.raw))
        .filter(Boolean)
        .map((change) => ({
          ...change,
          at: activity.createdAt,
        }))
    )
    .filter((change) => change.at && change.to)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  return { ok: true, changes };
}

function normalizeGithubPullRequest(item) {
  const updatedAt =
    item.updatedAt ||
    item.lastEditedAt ||
    item.mergedAt ||
    item.closedAt ||
    item.createdAt ||
    "";
  const url =
    item.htmlUrl ||
    item.githubHtmlUrl ||
    item.url ||
    item._links?.html?.href ||
    item._links?.self?.href ||
    "";

  return {
    id: item.id || item.githubId || item.number || null,
    number: item.number || item.githubNumber || null,
    title: item.title || item.subject || item._links?.self?.title || "GitHub pull request",
    state: item.state || item.status || item.githubState || "",
    updatedAt,
    createdAt: item.createdAt || "",
    mergedAt: item.mergedAt || "",
    url,
  };
}

async function fetchWorkPackageGithubActivity({ baseUrl, apiKey, workPackageId, href }) {
  const result = await fetchOpenProjectCollection({
    baseUrl,
    apiKey,
    href: href || `/api/v3/work_packages/${workPackageId}/github_pull_requests`,
  });
  if (!result.ok) return result;

  const pullRequests = result.elements
    .map(normalizeGithubPullRequest)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const latest = pullRequests[0] || null;

  return {
    ok: true,
    activity: {
      pullRequestCount: pullRequests.length,
      latest: latest
        ? {
            type: "pull_request",
            title: latest.title,
            state: latest.state,
            number: latest.number,
            updatedAt: latest.updatedAt || latest.createdAt,
            url: latest.url,
          }
        : null,
    },
  };
}

function parseIsoDurationToMs(value) {
  const match = String(value || "").match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );
  if (!match) return 0;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

function normalizeStoryPoints(value) {
  if (value === null || value === undefined || value === "") return null;
  const points = Number(value);
  return Number.isFinite(points) && points >= 0 ? points : null;
}

function normalizeTimeEntry(item) {
  const spentMs =
    parseIsoDurationToMs(item.hours) ||
    parseIsoDurationToMs(item.spentTime) ||
    parseIsoDurationToMs(item.time) ||
    0;

  return {
    id: item.id || null,
    spentMs,
    spentOn: item.spentOn || item.date || "",
    comment: item.comment?.raw || item.comment || "",
    user: item._links?.user?.title || "",
    activity: item._links?.activity?.title || "",
  };
}

async function fetchWorkPackageLoggedWork({ baseUrl, apiKey, href }) {
  if (!href) {
    return { ok: true, loggedWork: { totalMs: 0, entryCount: 0, entries: [] } };
  }

  const result = await fetchOpenProjectCollection({ baseUrl, apiKey, href });
  if (!result.ok) return result;

  const entries = result.elements.map(normalizeTimeEntry);
  return {
    ok: true,
    loggedWork: {
      totalMs: entries.reduce((sum, entry) => sum + entry.spentMs, 0),
      entryCount: entries.length,
      entries,
    },
  };
}

function overlapMs(start, end, windowStart, windowEnd) {
  const from = Math.max(start, windowStart);
  const to = Math.min(end, windowEnd);
  return Math.max(0, to - from);
}

function parseTimeToMinutes(value, fallback) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function defaultBusinessHoursRule() {
  return {
    enabled: true,
    timezoneOffsetMinutes: 420,
    workDays: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "17:00",
    breaks: [{ startTime: "12:00", endTime: "13:00" }],
    holidays: [],
  };
}

function normalizeBusinessHoursRule(rule) {
  const defaults = defaultBusinessHoursRule();
  const input = rule && typeof rule === "object" ? rule : {};
  const workDays = Array.isArray(input.workDays)
    ? input.workDays.map(Number).filter((day) => day >= 0 && day <= 6)
    : defaults.workDays;
  const breaks = Array.isArray(input.breaks)
    ? input.breaks
        .map((item) => ({
          startTime: item.startTime || item.start || "",
          endTime: item.endTime || item.end || "",
        }))
        .filter((item) => item.startTime && item.endTime)
    : defaults.breaks;

  return {
    enabled: input.enabled !== false,
    timezoneOffsetMinutes: Number.isFinite(Number(input.timezoneOffsetMinutes))
      ? Number(input.timezoneOffsetMinutes)
      : defaults.timezoneOffsetMinutes,
    workDays: workDays.length ? [...new Set(workDays)] : defaults.workDays,
    startTime: input.startTime || defaults.startTime,
    endTime: input.endTime || defaults.endTime,
    breaks,
    holidays: Array.isArray(input.holidays) ? input.holidays.filter(Boolean) : [],
  };
}

function localDayNumber(ms, offsetMs) {
  return Math.floor((ms + offsetMs) / 86400000);
}

function localDateString(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}

function localWeekday(dayNumber) {
  return new Date(dayNumber * 86400000).getUTCDay();
}

function businessMsBetween(start, end, ruleInput) {
  if (end <= start) return 0;

  const rule = normalizeBusinessHoursRule(ruleInput);
  if (!rule.enabled) return end - start;

  const offsetMs = rule.timezoneOffsetMinutes * 60000;
  const startMinute = parseTimeToMinutes(rule.startTime, 8 * 60);
  const endMinute = parseTimeToMinutes(rule.endTime, 17 * 60);
  if (endMinute <= startMinute) return 0;

  const holidaySet = new Set(rule.holidays);
  const firstDay = localDayNumber(start, offsetMs);
  const lastDay = localDayNumber(end, offsetMs);
  let total = 0;

  for (let day = firstDay; day <= lastDay; day++) {
    if (!rule.workDays.includes(localWeekday(day))) continue;
    if (holidaySet.has(localDateString(day))) continue;

    const localMidnightUtc = day * 86400000 - offsetMs;
    const intervals = [
      {
        start: localMidnightUtc + startMinute * 60000,
        end: localMidnightUtc + endMinute * 60000,
      },
    ];

    for (const item of rule.breaks) {
      const breakStartMinute = parseTimeToMinutes(item.startTime, -1);
      const breakEndMinute = parseTimeToMinutes(item.endTime, -1);
      if (breakStartMinute < 0 || breakEndMinute <= breakStartMinute) continue;
      const breakStart = localMidnightUtc + breakStartMinute * 60000;
      const breakEnd = localMidnightUtc + breakEndMinute * 60000;

      for (let i = intervals.length - 1; i >= 0; i--) {
        const interval = intervals[i];
        if (breakEnd <= interval.start || breakStart >= interval.end) continue;

        intervals.splice(i, 1);
        if (breakStart > interval.start) {
          intervals.push({ start: interval.start, end: breakStart });
        }
        if (breakEnd < interval.end) {
          intervals.push({ start: breakEnd, end: interval.end });
        }
      }
    }

    total += intervals.reduce(
      (sum, interval) => sum + overlapMs(interval.start, interval.end, start, end),
      0
    );
  }

  return total;
}

function calculateTimeMetrics({
  createdAt,
  updatedAt,
  currentStatus,
  statusChanges,
  businessHoursRule,
}) {
  const fallbackStart = new Date(createdAt || updatedAt || Date.now()).getTime();
  const now = Date.now();
  const changes = [...statusChanges].sort((a, b) => new Date(a.at) - new Date(b.at));
  const segments = [];
  let lastStatus = null;
  let lastTime = fallbackStart;

  for (const change of changes) {
    const changeTime = new Date(change.at).getTime();
    if (lastStatus && changeTime >= lastTime) {
      segments.push({
        status: lastStatus,
        category: statusCategory(lastStatus),
        start: lastTime,
        end: changeTime,
      });
    }
    lastStatus = change.to;
    lastTime = changeTime;
  }

  segments.push({
    status: lastStatus || currentStatus,
    category: statusCategory(lastStatus || currentStatus),
    start: lastTime,
    end: now,
  });

  const cycleStartSegment = segments.find((segment) =>
    categoryInList(segment.category, "cycleStart")
  );
  const cycleStart = cycleStartSegment?.start || null;
  const doneSegment = cycleStart
    ? segments.find(
        (segment) => categoryInList(segment.category, "terminal") && segment.start >= cycleStart
      )
    : null;
  const cycleEnd = doneSegment?.start || (cycleStart ? now : null);

  const durationBetween = (start, end) => businessMsBetween(start, end, businessHoursRule);
  let developmentStartedAt = null;
  let developedAt = null;

  for (const change of changes) {
    const changeTime = new Date(change.at).getTime();
    if (!developmentStartedAt && isInProgressStatus(change.to)) {
      developmentStartedAt = changeTime;
      continue;
    }
    if (developmentStartedAt && isDevelopedStatus(change.to)) {
      developedAt = changeTime;
      break;
    }
  }

  const blockedMs =
    cycleStart && cycleEnd
      ? segments
          .filter((segment) => segment.category === "blocked")
          .reduce(
            (sum, segment) =>
              sum +
              durationBetween(
                Math.max(segment.start, cycleStart),
                Math.min(segment.end, cycleEnd)
              ),
            0
          )
      : 0;

  return {
    blockedMs,
    developmentStartedAt: developmentStartedAt
      ? new Date(developmentStartedAt).toISOString()
      : null,
    developedAt: developedAt ? new Date(developedAt).toISOString() : null,
    implementationMs:
      developmentStartedAt && developedAt
        ? durationBetween(developmentStartedAt, developedAt)
        : 0,
    implementationElapsedMs:
      developmentStartedAt && !developedAt
        ? durationBetween(developmentStartedAt, now)
        : 0,
    timeMode: normalizeBusinessHoursRule(businessHoursRule).enabled ? "business" : "calendar",
    currentStatusCategory: statusCategory(currentStatus),
    statusChanges: changes,
  };
}

function taskWarnings({ task, timeMetrics, loggedWork, githubActivity }) {
  const warnings = [];
  const storyPoints = Number(task.storyPoints);
  const hasStoryPoints =
    task.storyPoints !== null && task.storyPoints !== undefined && Number.isFinite(storyPoints);
  const implementationMs = timeMetrics.implementationMs || 0;
  const loggedMs = loggedWork.totalMs || 0;
  const blockedMs = timeMetrics.blockedMs || 0;
  const unaccountedMs = Math.max(0, implementationMs - loggedMs - blockedMs);
  const fourBusinessHours = 4 * 60 * 60 * 1000;
  const twoBusinessHours = 2 * 60 * 60 * 1000;

  if (timeMetrics.developmentStartedAt && !timeMetrics.developedAt) {
    warnings.push({
      code: "PIPELINE_NOT_FINISHED",
      level: "info",
      message: "Task đã bắt đầu dev nhưng chưa tới Developed.",
    });
  }

  if (timeMetrics.developmentStartedAt && loggedMs === 0) {
    warnings.push({
      code: "NO_LOGGED_WORK",
      level: "warning",
      message: "Chưa có logged work cho task đã bắt đầu dev.",
    });
  }

  if (implementationMs > 0 && loggedMs > 0 && loggedMs / implementationMs < 0.25) {
    warnings.push({
      code: "LOW_LOGGED_RATIO",
      level: "warning",
      message: "Logged work thấp so với thời gian đi qua pipeline.",
    });
  }

  if (unaccountedMs >= fourBusinessHours) {
    warnings.push({
      code: "HIGH_UNACCOUNTED_TIME",
      level: "warning",
      message: "Khoảng chưa phân bổ cao, nên kiểm tra họp/chờ/context switch.",
    });
  }

  if (blockedMs >= twoBusinessHours) {
    warnings.push({
      code: "BLOCKED_TIME",
      level: "warning",
      message: "Task có blocked time đáng chú ý.",
    });
  }

  if (
    !githubActivity.latest &&
    categoryInList(timeMetrics.currentStatusCategory, "cycleStart") &&
    !categoryInList(timeMetrics.currentStatusCategory, "terminal")
  ) {
    warnings.push({
      code: "NO_GITHUB_ACTIVITY",
      level: "info",
      message: "Chưa thấy pull request liên kết qua OpenProject GitHub integration.",
    });
  }

  if (!task.assignee) {
    warnings.push({
      code: "NO_ASSIGNEE",
      level: "warning",
      message: "Task chưa có assignee.",
    });
  }

  if (!hasStoryPoints) {
    warnings.push({
      code: "NO_STORY_POINTS",
      level: "info",
      message: "Task chưa có story point, nên bổ sung để đánh giá tải sprint.",
    });
  }

  if (hasStoryPoints && storyPoints >= 13) {
    warnings.push({
      code: "LARGE_TASK_SHOULD_SPLIT",
      level: "warning",
      message: "Task rất lớn theo story point, nên cân nhắc chia nhỏ.",
    });
  }

  if (
    hasStoryPoints &&
    storyPoints >= 8 &&
    ["notStarted", "ready"].includes(timeMetrics.currentStatusCategory)
  ) {
    warnings.push({
      code: "HIGH_POINT_NOT_STARTED",
      level: "warning",
      message: "Task nhiều point nhưng chưa bắt đầu, có thể ảnh hưởng sprint.",
    });
  }

  if (
    hasStoryPoints &&
    storyPoints >= 8 &&
    !githubActivity.latest &&
    categoryInList(timeMetrics.currentStatusCategory, "cycleStart") &&
    !categoryInList(timeMetrics.currentStatusCategory, "terminal")
  ) {
    warnings.push({
      code: "HIGH_POINT_NO_GITHUB_ACTIVITY",
      level: "info",
      message: "Task nhiều point đang chạy nhưng chưa có pull request liên kết.",
    });
  }

  return {
    warnings,
    unaccountedMs,
  };
}

async function fetchOpenProjectSprintTasks({
  projectId,
  sprintId,
  memberId,
  businessHoursRule,
  includeGithubActivity = true,
  includeLoggedWork = true,
}) {
  const config = requireOpenProjectConfig();
  if (!config.ok) return config;

  const projectResult = await fetchOpenProjectJson({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: `/api/v3/projects/${projectId}`,
  });
  if (!projectResult.ok) return projectResult;
  const projectIdentifier = projectResult.data.identifier || projectId;

  const workPackagesHref = projectResult.data._links?.workPackages?.href;
  if (!workPackagesHref) return { ok: true, tasks: [] };

  const workPackagesUrl = new URL(absoluteOpenProjectUrl(config.baseUrl, workPackagesHref));
  if (!workPackagesUrl.searchParams.has("filters")) {
    workPackagesUrl.searchParams.set("filters", "[]");
  }

  const workPackagesResult = await fetchOpenProjectCollection({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    href: `${workPackagesUrl.pathname}${workPackagesUrl.search}`,
  });
  if (!workPackagesResult.ok) return workPackagesResult;

  const wantedVersionId = Number(sprintId);
  const wantedMemberId = Number(memberId);

  const tasks = workPackagesResult.elements
    .filter((wp) => linkId(wp._links?.version, "versions") === wantedVersionId)
    .filter((wp) => linkId(wp._links?.assignee, "users") === wantedMemberId)
    .map((wp) => ({
      id: wp.id,
      displayId: wp.displayId || String(wp.id),
      subject: wp.subject,
      type: wp._links?.type?.title || "",
      status: wp._links?.status?.title || "",
      priority: wp._links?.priority?.title || "",
      assignee: wp._links?.assignee?.title || "",
      sprint: wp._links?.version?.title || "",
      storyPoints: normalizeStoryPoints(wp.storyPoints),
      percentageDone: wp.percentageDone ?? wp.derivedPercentageDone ?? null,
      updatedAt: wp.updatedAt,
      createdAt: wp.createdAt,
      url: absoluteOpenProjectUrl(
        config.baseUrl,
        `/projects/${projectIdentifier}/work_packages/${wp.id}`
      ),
      githubUrl: absoluteOpenProjectUrl(
        config.baseUrl,
        `/projects/${projectIdentifier}/work_packages/${wp.id}/github`
      ),
      githubPullRequestsHref: wp._links?.github_pull_requests?.href || "",
      timeEntriesHref: wp._links?.timeEntries?.href || "",
    }))
    .sort((a, b) => Number(a.displayId) - Number(b.displayId));

  const tasksWithTimeMetrics = await Promise.all(
    tasks.map(async (task) => {
      const [changesResult, githubActivityResult, loggedWorkResult] = await Promise.all([
        fetchWorkPackageStatusChanges({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          workPackageId: task.id,
        }),
        includeGithubActivity
          ? fetchWorkPackageGithubActivity({
              baseUrl: config.baseUrl,
              apiKey: config.apiKey,
              workPackageId: task.id,
              href: task.githubPullRequestsHref,
            })
          : Promise.resolve({ ok: true, activity: { pullRequestCount: 0, latest: null } }),
        includeLoggedWork
          ? fetchWorkPackageLoggedWork({
              baseUrl: config.baseUrl,
              apiKey: config.apiKey,
              href: task.timeEntriesHref,
            })
          : Promise.resolve({ ok: true, loggedWork: { totalMs: 0, entryCount: 0, entries: [] } }),
      ]);

      const githubActivity = githubActivityResult.ok
        ? githubActivityResult.activity
        : { pullRequestCount: 0, latest: null, unavailable: true };
      const loggedWork = loggedWorkResult.ok
        ? loggedWorkResult.loggedWork
        : { totalMs: 0, entryCount: 0, entries: [], unavailable: true };
      const { githubPullRequestsHref, timeEntriesHref, ...publicTask } = task;

      if (!changesResult.ok) {
        const timeMetrics = {
          blockedMs: 0,
          developmentStartedAt: null,
          developedAt: null,
          implementationMs: 0,
          implementationElapsedMs: 0,
          currentStatusCategory: statusCategory(task.status),
          statusChanges: [],
          unavailable: true,
        };
        const warningResult = taskWarnings({
          task,
          timeMetrics,
          loggedWork,
          githubActivity,
        });

        return {
          ...publicTask,
          githubActivity,
          loggedWork,
          timeMetrics: {
            ...timeMetrics,
            unaccountedMs: warningResult.unaccountedMs,
          },
          warnings: warningResult.warnings,
        };
      }

      const timeMetrics = calculateTimeMetrics({
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        currentStatus: task.status,
        statusChanges: changesResult.changes,
        businessHoursRule,
      });
      const warningResult = taskWarnings({
        task,
        timeMetrics,
        loggedWork,
        githubActivity,
      });

      return {
        ...publicTask,
        githubActivity,
        loggedWork,
        timeMetrics: {
          ...timeMetrics,
          unaccountedMs: warningResult.unaccountedMs,
        },
        warnings: warningResult.warnings,
      };
    })
  );

  return { ok: true, tasks: tasksWithTimeMetrics };
}

module.exports = {
  fetchOpenProjectProjects,
  fetchOpenProjectProjectMembers,
  fetchOpenProjectProjectSprints,
  fetchOpenProjectSprintTasks,
  businessMsBetween,
};
