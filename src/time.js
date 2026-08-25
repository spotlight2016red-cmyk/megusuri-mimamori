const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const clockFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateHeading(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]})`;
}

export function formatClock(date) {
  return clockFormat.format(date);
}

export function parseTime(time) {
  const [hours, minutes] = String(time ?? "00:00")
    .split(":")
    .map((part) => Number(part));
  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

export function getScheduledAt(time, now = new Date()) {
  const { hours, minutes } = parseTime(time);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}

export function isTimePassed(time, now = new Date()) {
  return now.getTime() >= getScheduledAt(time, now).getTime();
}

export function toDateKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function displayStatus(dose, now = new Date()) {
  if (dose.status === "done") return "done";
  if (dose.status === "skipped") return "skipped";
  if (dose.status === "late") return "late";
  if (isTimePassed(dose.time, now)) return "late";
  return dose.status || "upcoming";
}
