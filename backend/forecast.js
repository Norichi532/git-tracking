const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function isAiForecastEnabled(options = {}) {
  if (options.enabled === false) return false;
  return (
    String(process.env.AI_FORECAST_ENABLED || "").toLowerCase() === "true" ||
    Boolean(process.env.AI_FORECAST_PROVIDER)
  );
}

function parseDate(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  return round((end - start) / MS_PER_DAY, 1);
}

function sprintContext(sprint) {
  const now = Date.now();
  const start = parseDate(sprint?.startDate);
  const finish = parseDate(sprint?.finishDate);
  const totalDays = daysBetween(start, finish);
  const daysLeft = finish ? daysBetween(now, finish) : null;
  const elapsedRatio =
    start && finish && finish > start
      ? Math.max(0, Math.min(1, (now - start) / (finish - start)))
      : null;

  return {
    startDate: sprint?.startDate || "",
    finishDate: sprint?.finishDate || "",
    daysLeft,
    elapsedPercent: elapsedRatio === null ? null : Math.round(elapsedRatio * 100),
    hasDates: Boolean(start && finish),
    isEnded: Boolean(finish && now > finish),
  };
}

function warningCodes(task) {
  return (task.warnings || []).map((warning) => warning.code).filter(Boolean);
}

function isTerminal(task) {
  return ["done", "cancelled"].includes(task.timeMetrics?.currentStatusCategory);
}

function hasStoryPoints(task) {
  return task.storyPoints !== null && task.storyPoints !== undefined && Number.isFinite(Number(task.storyPoints));
}

function riskRank(risk) {
  return { unknown: 0, on_track: 1, at_risk: 2, off_track: 3 }[risk] || 0;
}

function shouldExplainWithAi(task) {
  const includeUnknown =
    String(process.env.AI_FORECAST_INCLUDE_UNKNOWN || "").toLowerCase() === "true";
  const hasWarningLevel = (task.warnings || []).some((warning) => warning.level === "warning");

  return (
    ["at_risk", "off_track"].includes(task.forecast?.risk) ||
    hasWarningLevel ||
    (includeUnknown && task.forecast?.risk === "unknown")
  );
}

function taskForecastByRules(task, sprint) {
  const category = task.timeMetrics?.currentStatusCategory || "unknown";
  const points = hasStoryPoints(task) ? Number(task.storyPoints) : null;
  const progress = Number(task.progress || 0);
  const warnings = warningCodes(task);
  const reasons = [];
  const suggestedActions = [];
  const factors = {
    daysLeftInSprint: sprint.daysLeft,
    sprintElapsedPercent: sprint.elapsedPercent,
    storyPoints: points,
    progress,
    statusCategory: category,
    hasPullRequest: Boolean(task.githubActivity?.latest),
    implementationHours: round((task.timeMetrics?.implementationMs || 0) / MS_PER_HOUR),
    blockedHours: round((task.timeMetrics?.blockedMs || 0) / MS_PER_HOUR),
    loggedWorkHours: round((task.loggedWork?.totalMs || 0) / MS_PER_HOUR),
    warningCodes: warnings,
  };

  let risk = "on_track";

  if (category === "done") {
    return {
      risk: "on_track",
      confidence: 0.95,
      source: "rules",
      label: "Kịp tiến độ",
      reasons: ["Task đã ở trạng thái hoàn thành."],
      suggestedActions: [],
      factors,
    };
  }

  if (category === "cancelled") {
    return {
      risk: "unknown",
      confidence: 0.8,
      source: "rules",
      label: "Không đánh giá",
      reasons: ["Task đã bị hủy hoặc từ chối, không còn thuộc luồng hoàn thành sprint."],
      suggestedActions: ["Xác nhận task này có cần thay thế bằng work package khác không."],
      factors,
    };
  }

  if (!sprint.hasDates) {
    risk = "unknown";
    reasons.push("Sprint chưa có đủ ngày bắt đầu/kết thúc để dự báo.");
    suggestedActions.push("Bổ sung ngày sprint/version trong OpenProject.");
  }

  if (sprint.isEnded && progress < 100) {
    risk = "off_track";
    reasons.push("Sprint đã hết hạn nhưng task chưa hoàn thành.");
    suggestedActions.push("Xác nhận carry-over hoặc chuyển phần còn lại sang sprint tiếp theo.");
  }

  if (!isTerminal(task) && sprint.elapsedPercent !== null) {
    if (["notStarted", "ready"].includes(category) && sprint.elapsedPercent >= 75) {
      risk = "off_track";
      reasons.push("Sprint đã đi qua phần lớn thời gian nhưng task chưa bắt đầu.");
      suggestedActions.push("Ưu tiên làm rõ scope hoặc chuyển task khỏi sprint nếu không còn khả thi.");
    } else if (["notStarted", "ready"].includes(category) && sprint.elapsedPercent >= 50) {
      risk = riskRank(risk) < 2 ? "at_risk" : risk;
      reasons.push("Task chưa bắt đầu trong khi sprint đã đi qua hơn một nửa.");
      suggestedActions.push("Kiểm tra lại ưu tiên và khả năng bắt đầu trong ngày làm việc tiếp theo.");
    }

    if (progress < 50 && sprint.elapsedPercent >= 60) {
      risk = riskRank(risk) < 2 ? "at_risk" : risk;
      reasons.push("Tiến độ task thấp so với thời gian sprint đã trôi qua.");
      suggestedActions.push("Cập nhật phần việc còn lại và cân nhắc tách scope chưa cần thiết.");
    }
  }

  if (points !== null && points >= 8 && progress < 100) {
    if (sprint.elapsedPercent !== null && sprint.elapsedPercent >= 70 && !task.githubActivity?.latest) {
      risk = "off_track";
      reasons.push("Task nhiều story point, sprint gần cuối nhưng chưa có pull request liên kết.");
      suggestedActions.push("Tạo PR sớm để mở review hoặc tách phần chưa sẵn sàng.");
    } else if (!task.githubActivity?.latest) {
      risk = riskRank(risk) < 2 ? "at_risk" : risk;
      reasons.push("Task nhiều story point nhưng chưa có pull request liên kết.");
      suggestedActions.push("Đẩy nhánh/PR sớm để giảm rủi ro review dồn cuối sprint.");
    }
  }

  if ((task.timeMetrics?.blockedMs || 0) >= 8 * MS_PER_HOUR) {
    risk = "off_track";
    reasons.push("Task bị blocked từ một ngày làm việc trở lên.");
    suggestedActions.push("Escalate blocker và ghi rõ owner xử lý blocker.");
  } else if ((task.timeMetrics?.blockedMs || 0) >= 4 * MS_PER_HOUR) {
    risk = riskRank(risk) < 2 ? "at_risk" : risk;
    reasons.push("Task có blocked time đáng chú ý.");
    suggestedActions.push("Kiểm tra dependency hoặc quyết định unblock trong daily.");
  }

  if (warnings.includes("NO_LOGGED_WORK") && task.timeMetrics?.developmentStartedAt) {
    risk = riskRank(risk) < 2 ? "at_risk" : risk;
    reasons.push("Task đã bắt đầu dev nhưng chưa có logged work.");
    suggestedActions.push("Nhắc assignee log effort hoặc xác nhận team không dùng time entry cho task này.");
  }

  if (warnings.includes("HIGH_UNACCOUNTED_TIME")) {
    risk = riskRank(risk) < 2 ? "at_risk" : risk;
    reasons.push("Unaccounted time cao, có thể có chờ đợi, họp, context switch hoặc thiếu log work.");
    suggestedActions.push("Trao đổi nhanh với assignee để làm rõ phần thời gian chưa phân bổ.");
  }

  if (!reasons.length) {
    reasons.push("Không phát hiện tín hiệu rủi ro đáng kể từ dữ liệu hiện có.");
  }

  const labels = {
    on_track: "Kịp tiến độ",
    at_risk: "Có rủi ro",
    off_track: "Khó kịp",
    unknown: "Chưa đủ dữ liệu",
  };

  return {
    risk,
    confidence: Math.min(0.95, round(0.55 + Math.min(reasons.length, 4) * 0.1, 2)),
    source: "rules",
    label: labels[risk],
    reasons: [...new Set(reasons)].slice(0, 4),
    suggestedActions: [...new Set(suggestedActions)].slice(0, 4),
    factors,
  };
}

function aiPayloadForTask(task) {
  return {
    taskId: task.id,
    displayId: task.displayId,
    title: task.subject,
    status: task.status,
    statusCategory: task.timeMetrics?.currentStatusCategory,
    progress: task.progress,
    storyPoints: task.storyPoints,
    updatedAt: task.updatedAt,
    hasPullRequest: Boolean(task.githubActivity?.latest),
    implementationHours: round((task.timeMetrics?.implementationMs || 0) / MS_PER_HOUR),
    blockedHours: round((task.timeMetrics?.blockedMs || 0) / MS_PER_HOUR),
    loggedWorkHours: round((task.loggedWork?.totalMs || 0) / MS_PER_HOUR),
    warnings: warningCodes(task),
    ruleForecast: task.forecast,
  };
}

function parseAiResponse(data) {
  const text =
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseGeminiResponse(data) {
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeAiForecasts(tasks, parsed) {
  const byId = new Map((parsed?.forecasts || []).map((forecast) => [forecast.taskId, forecast]));

  return tasks.map((task) => {
    const ai = byId.get(task.id);
    if (!ai) return task;

    return {
      ...task,
      forecast: {
        ...task.forecast,
        risk: ai.risk || task.forecast.risk,
        confidence: Number.isFinite(Number(ai.confidence))
          ? Math.max(task.forecast.confidence, Number(ai.confidence))
          : task.forecast.confidence,
        source: "rules+ai",
        aiReason: ai.reason,
        suggestedActions: ai.suggestedActions?.length
          ? ai.suggestedActions.slice(0, 4)
          : task.forecast.suggestedActions,
      },
    };
  });
}

function aiRequestPayload(candidates, sprint) {
  return {
    sprint,
    tasks: candidates.map(aiPayloadForTask),
  };
}

async function callGeminiForecast(candidates, sprint) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Bạn là trợ lý PM/Scrum Master. Hãy giải thích rủi ro delivery cho từng task bằng tiếng Việt. Giữ ruleForecast.risk trừ khi dữ liệu mâu thuẫn rõ ràng. Chỉ trả JSON hợp lệ theo schema: {\"forecasts\":[{\"taskId\":number,\"risk\":\"on_track|at_risk|off_track|unknown\",\"confidence\":number,\"reason\":string,\"suggestedActions\":string[]}]}. Payload:\n" +
              JSON.stringify(aiRequestPayload(candidates, sprint)),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini API error ${res.status}`);

  const parsed = parseGeminiResponse(data);
  if (!parsed) throw new Error("Gemini response did not contain valid JSON");
  return parsed;
}

async function callOpenAiForecast(candidates, sprint) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6";
  const body = {
    model,
    store: false,
    input: [
      {
        role: "system",
        content:
          "You explain sprint delivery risk for project managers. Keep the ruleForecast risk unless the data clearly contradicts it. Return concise Vietnamese JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify(aiRequestPayload(candidates, sprint)),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "task_forecast_explanations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            forecasts: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: { type: "number" },
                  risk: { type: "string", enum: ["on_track", "at_risk", "off_track", "unknown"] },
                  confidence: { type: "number" },
                  reason: { type: "string" },
                  suggestedActions: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["taskId", "risk", "confidence", "reason", "suggestedActions"],
              },
            },
          },
          required: ["forecasts"],
        },
      },
    },
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI API error ${res.status}`);

  const parsed = parseAiResponse(data);
  if (!parsed) throw new Error("OpenAI response did not contain valid JSON");
  return parsed;
}

async function enhanceForecastsWithAi(tasks, sprint, options = {}) {
  if (!isAiForecastEnabled(options)) return tasks;

  const candidates = tasks
    .filter((task) => !isTerminal(task) && shouldExplainWithAi(task))
    .slice(0, Number(process.env.AI_FORECAST_TASK_LIMIT || 25));
  if (!candidates.length) return tasks;

  try {
    const provider = String(process.env.AI_FORECAST_PROVIDER || "openai").toLowerCase();
    const parsed =
      provider === "gemini"
        ? await callGeminiForecast(candidates, sprint)
        : await callOpenAiForecast(candidates, sprint);

    return mergeAiForecasts(tasks, parsed);
  } catch (err) {
    return tasks.map((task) => ({
      ...task,
      forecast: {
        ...task.forecast,
        aiUnavailable: true,
        aiError: err.message || "AI forecast unavailable",
      },
    }));
  }
}

async function buildTaskForecasts({ tasks, sprint, aiEnabled = true }) {
  const sprintInfo = sprintContext(sprint);
  const withRuleForecast = tasks.map((task) => ({
    ...task,
    forecast: taskForecastByRules(task, sprintInfo),
  }));

  return enhanceForecastsWithAi(withRuleForecast, sprintInfo, { enabled: aiEnabled });
}

module.exports = {
  buildTaskForecasts,
};
