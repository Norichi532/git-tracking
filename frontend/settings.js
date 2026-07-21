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

const form = document.querySelector("#business-hours-form");
const statusEl = document.querySelector("#settings-status");

function currentRule() {
  try {
    return {
      ...DEFAULT_BUSINESS_HOURS,
      ...JSON.parse(localStorage.getItem(BUSINESS_HOURS_KEY) || "{}"),
    };
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

function fillForm(rule) {
  form.elements.enabled.checked = rule.enabled !== false;
  form.elements.startTime.value = rule.startTime || DEFAULT_BUSINESS_HOURS.startTime;
  form.elements.endTime.value = rule.endTime || DEFAULT_BUSINESS_HOURS.endTime;
  form.elements.timezoneOffsetMinutes.value =
    rule.timezoneOffsetMinutes ?? DEFAULT_BUSINESS_HOURS.timezoneOffsetMinutes;

  const lunch = rule.breaks?.[0] || DEFAULT_BUSINESS_HOURS.breaks[0];
  form.elements.breakStartTime.value = lunch.startTime || "";
  form.elements.breakEndTime.value = lunch.endTime || "";
  form.elements.holidays.value = (rule.holidays || []).join("\n");

  document.querySelectorAll('input[name="workDays"]').forEach((input) => {
    input.checked = (rule.workDays || []).map(Number).includes(Number(input.value));
  });
}

function readForm() {
  const workDays = [...document.querySelectorAll('input[name="workDays"]:checked')].map(
    (input) => Number(input.value)
  );
  const breakStartTime = form.elements.breakStartTime.value;
  const breakEndTime = form.elements.breakEndTime.value;
  const holidays = form.elements.holidays.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    enabled: form.elements.enabled.checked,
    timezoneOffsetMinutes: Number(form.elements.timezoneOffsetMinutes.value),
    workDays,
    startTime: form.elements.startTime.value,
    endTime: form.elements.endTime.value,
    breaks:
      breakStartTime && breakEndTime
        ? [{ startTime: breakStartTime, endTime: breakEndTime }]
        : [],
    holidays,
  };
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const rule = readForm();
  localStorage.setItem(BUSINESS_HOURS_KEY, JSON.stringify(rule));
  statusEl.textContent = "Đã lưu rule giờ làm việc.";
  statusEl.className = "status-line success";
});

document.querySelector("#reset-rule-btn").addEventListener("click", () => {
  localStorage.setItem(BUSINESS_HOURS_KEY, JSON.stringify(DEFAULT_BUSINESS_HOURS));
  fillForm(DEFAULT_BUSINESS_HOURS);
  statusEl.textContent = "Đã khôi phục rule mặc định.";
  statusEl.className = "status-line neutral";
});

fillForm(currentRule());
