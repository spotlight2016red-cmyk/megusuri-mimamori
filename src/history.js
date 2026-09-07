import { listDoseEntries, sortDoseEntries } from "./medicines.js";
import { saveMedicines } from "./storage.js";
import { getCurrentDate } from "./testDate.js";
import { toDateKey } from "./time.js";

export const HISTORY_KEY = "megusuri-history-v1";
export const LAST_ACTIVE_DATE_KEY = "megusuri-last-active-date";
/** 旧版→日次リセット対応版の初回移行済みフラグ。 */
export const DAILY_RESET_MIGRATED_KEY = "megusuri-daily-reset-migrated-v1";
/** 以前の試作キー。あれば読み取り、正規キーへ寄せる。 */
const LEGACY_LAST_ACTIVE_DATE_KEY = "megusuri-last-active-date-v1";

export function snapshotDay(medicines) {
  return sortDoseEntries(listDoseEntries(medicines)).map(({ medicine, dose }) => {
    const entry = {
      medicineId: medicine.id,
      medicineName: medicine.name,
      doseId: dose.id,
      label: dose.label,
      time: dose.time,
      status: dose.status === "done" ? "done" : "upcoming",
    };
    if (entry.status === "done" && dose.completedAt) {
      entry.completedAt = dose.completedAt;
    }
    return entry;
  });
}

export function saveHistoryDay(history, dateKey, entries) {
  return {
    ...history,
    [dateKey]: entries,
  };
}

export function resetDosesForNewDay(medicines) {
  return medicines.map((medicine) => ({
    ...medicine,
    doses: medicine.doses.map((dose) => {
      const next = { ...dose, status: "upcoming" };
      delete next.completedAt;
      return next;
    }),
  }));
}

/**
 * 日付変更時の共通処理:
 * 前日スナップショット保存 → upcoming リセット → completedAt 削除 → last-active-date 更新
 */
export function applyDayRollover({
  medicines,
  history,
  lastActiveDate,
  todayKey,
}) {
  if (!lastActiveDate) {
    return {
      medicines,
      history,
      lastActiveDate: todayKey,
      didRollover: false,
    };
  }

  if (lastActiveDate >= todayKey) {
    return {
      medicines,
      history,
      lastActiveDate,
      didRollover: false,
    };
  }

  return {
    medicines: resetDosesForNewDay(medicines),
    history: saveHistoryDay(history, lastActiveDate, snapshotDay(medicines)),
    lastActiveDate: todayKey,
    didRollover: true,
  };
}

export function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function saveHistory(history) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function loadLastActiveDate() {
  try {
    return (
      window.localStorage.getItem(LAST_ACTIVE_DATE_KEY) ||
      window.localStorage.getItem(LEGACY_LAST_ACTIVE_DATE_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

export function saveLastActiveDate(dateKey) {
  window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, dateKey);
  try {
    window.localStorage.removeItem(LEGACY_LAST_ACTIVE_DATE_KEY);
  } catch {
    // ignore
  }
}

export function loadDailyResetMigrated() {
  try {
    return window.localStorage.getItem(DAILY_RESET_MIGRATED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDailyResetMigrated() {
  window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");
}

/**
 * 旧版（last-active-date 無し）からの初回移行。
 * done を upcoming に戻すが、日付が不明なため履歴には保存しない。
 */
export function applyLegacyDailyResetMigration(medicines, todayKey) {
  return {
    medicines: resetDosesForNewDay(medicines),
    history: null,
    lastActiveDate: todayKey,
    didMigrate: true,
  };
}

/**
 * 日付変更チェックの共通入口。
 * 起動時 / pageshow / visibilitychange / 定期チェックから呼ぶ。
 */
export function applyAndPersistDayRollover(medicines, now = getCurrentDate()) {
  const todayKey = toDateKey(now);
  const previousLastActive = loadLastActiveDate();
  const alreadyMigrated = loadDailyResetMigrated();

  // 旧版→新版: last-active-date が無い既存端末のみ、一度だけリセット
  if (!alreadyMigrated && !previousLastActive) {
    const migration = applyLegacyDailyResetMigration(medicines, todayKey);
    saveMedicines(migration.medicines);
    saveLastActiveDate(migration.lastActiveDate);
    saveDailyResetMigrated();
    return {
      medicines: migration.medicines,
      history: loadHistory(),
      lastActiveDate: migration.lastActiveDate,
      didRollover: false,
      didMigrate: true,
    };
  }

  // 既に last-active-date がある正常端末は移行処理せず、フラグだけ揃える
  if (!alreadyMigrated && previousLastActive) {
    saveDailyResetMigrated();
  }

  const result = applyDayRollover({
    medicines,
    history: loadHistory(),
    lastActiveDate: previousLastActive,
    todayKey,
  });

  if (result.didRollover) {
    saveHistory(result.history);
    saveMedicines(result.medicines);
  }
  if (result.lastActiveDate !== previousLastActive) {
    saveLastActiveDate(result.lastActiveDate);
  }
  return {
    ...result,
    didMigrate: false,
  };
}

export function listPastHistoryKeys(history, todayKey) {
  return Object.keys(history)
    .filter((dateKey) => dateKey !== todayKey)
    .sort((a, b) => b.localeCompare(a));
}

export function formatHistoryStatus(entry, { isToday }) {
  if (entry.status === "done") {
    return `✓ ${entry.completedAt ?? ""}`.trim();
  }
  if (isToday) return `予定 ${entry.time}`;
  return "未使用";
}

export function historyEntriesFromMedicines(medicines) {
  return snapshotDay(medicines);
}
