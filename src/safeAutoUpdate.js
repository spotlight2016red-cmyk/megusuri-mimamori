import { listDoseEntries } from "./medicines.js";
import { getScheduledAt, toDateKey } from "./time.js";
import {
  DEFAULT_AUTO_UPDATE_SETTINGS,
  isInAutoUpdateWindow,
  normalizeAutoUpdateSettings,
} from "./autoUpdateSettings.js";

export const NEAR_DOSE_MINUTES = 30;

/**
 * 直近 minutes 分以内に未完了の点眼予定があるか（これから来る予定のみ）。
 */
export function hasUpcomingDoseWithin(
  medicines,
  now = new Date(),
  minutes = NEAR_DOSE_MINUTES,
) {
  const nowMs = now.getTime();
  const horizon = nowMs + Math.max(0, Number(minutes) || 0) * 60 * 1000;

  for (const { dose } of listDoseEntries(medicines ?? [])) {
    if (dose.status === "done") continue;
    const at = getScheduledAt(dose.time, now).getTime();
    if (at >= nowMs && at <= horizon) return true;
  }
  return false;
}

/**
 * 予定時刻を過ぎた未点眼があるか（再通知対象）。
 */
export function hasActiveIncompleteReminders(medicines, now = new Date()) {
  const nowMs = now.getTime();
  for (const { dose } of listDoseEntries(medicines ?? [])) {
    if (dose.status === "done") continue;
    if (getScheduledAt(dose.time, now).getTime() <= nowMs) return true;
  }
  return false;
}

/**
 * 安全に自動更新してよいかを判定する（副作用なし）。
 */
export function evaluateSafeAutoUpdate({
  now = new Date(),
  settings = DEFAULT_AUTO_UPDATE_SETTINGS,
  medicines = [],
  pendingConfirmOpen = false,
  isSpeaking = false,
  lastActiveDate = null,
  nearDoseMinutes = NEAR_DOSE_MINUTES,
} = {}) {
  const cfg = normalizeAutoUpdateSettings(settings);

  if (!isInAutoUpdateWindow(now, cfg)) {
    return { ok: false, reason: "outside-window" };
  }

  const today = toDateKey(now);
  if (lastActiveDate && lastActiveDate !== today) {
    return { ok: false, reason: "day-rollover-pending" };
  }

  if (pendingConfirmOpen) {
    return { ok: false, reason: "confirm-open" };
  }

  if (isSpeaking) {
    return { ok: false, reason: "speaking" };
  }

  if (hasActiveIncompleteReminders(medicines, now)) {
    return { ok: false, reason: "active-reminders" };
  }

  if (hasUpcomingDoseWithin(medicines, now, nearDoseMinutes)) {
    return { ok: false, reason: "near-dose" };
  }

  return { ok: true, reason: "safe" };
}

export function canSafelyAutoUpdate(input) {
  return evaluateSafeAutoUpdate(input).ok;
}
