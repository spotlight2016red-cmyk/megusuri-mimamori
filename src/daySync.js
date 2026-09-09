import {
  applyAndPersistDayRollover,
  loadLastActiveDate,
  loadDailyResetMigrated,
  loadHistory,
  resetDosesForNewDay,
  saveLastActiveDate,
  DAILY_RESET_MIGRATED_KEY,
  LAST_ACTIVE_DATE_KEY,
  HISTORY_KEY,
} from "./history.js";
import { loadMedicines, saveMedicines } from "./storage.js";
import {
  TEST_DATE_KEY,
  clearTestDateSettings,
  getCurrentDate,
  getCurrentDateKey,
  getDeviceDate,
  getTestDateSettings,
  loadTestDateSettings,
} from "./testDate.js";
import { toDateKey } from "./time.js";

/** 開発者向けデバッグ用の日次同期メタデータ（永続化しない） */
const debugState = {
  lastCheckAt: null,
  lastCheckSource: null,
  lastRolloverDateKey: null,
  lastCheckDidRollover: false,
  lastCheckDidMigrate: false,
  lastManualTodayResetAt: null,
};

export function getDaySyncDebugState() {
  return { ...debugState };
}

export function resetDaySyncDebugStateForTests() {
  debugState.lastCheckAt = null;
  debugState.lastCheckSource = null;
  debugState.lastRolloverDateKey = null;
  debugState.lastCheckDidRollover = false;
  debugState.lastCheckDidMigrate = false;
  debugState.lastManualTodayResetAt = null;
}

/**
 * 日次境界の共通同期。
 *
 * 重要:
 * - 入力は localStorage の medicines を優先（React state の古い done を避ける）
 * - didRollover が false でも、呼び出し側は必ず result.medicines を React state へ反映すること
 *   （バックグラウンドで LS だけ更新され UI が取り残されるのを防ぐ）
 */
export function runDayBoundarySync({
  now = getCurrentDate(),
  source = "unknown",
  reactMedicines = null,
} = {}) {
  const checkedAt = getDeviceDate();
  debugState.lastCheckAt = checkedAt.toISOString();
  debugState.lastCheckSource = source;

  const stored = loadMedicines(null);
  const input = Array.isArray(stored) ? stored : reactMedicines ?? [];

  const result = applyAndPersistDayRollover(input, now);

  debugState.lastCheckDidRollover = Boolean(result.didRollover);
  debugState.lastCheckDidMigrate = Boolean(result.didMigrate);
  if (result.didRollover || result.didMigrate) {
    debugState.lastRolloverDateKey = toDateKey(now);
  }

  return {
    ...result,
    checkedAt,
    source,
    inputSource: Array.isArray(stored) ? "localStorage" : "react",
  };
}

/**
 * 手動復旧: 今日の状態をリセットして通常運転を再開する。
 * 日跨ぎではないため履歴へは一切書き込まない。
 */
export function resetTodayAndResume({
  reactMedicines = null,
  deviceNow = getDeviceDate(),
} = {}) {
  const historyBefore = loadHistory();

  clearTestDateSettings();
  loadTestDateSettings();

  const todayKey = toDateKey(deviceNow);
  const stored = loadMedicines(null);
  const input = Array.isArray(stored) ? stored : reactMedicines ?? [];
  const medicines = resetDosesForNewDay(input);

  saveMedicines(medicines);
  saveLastActiveDate(todayKey);

  debugState.lastManualTodayResetAt = deviceNow.toISOString();
  debugState.lastCheckAt = deviceNow.toISOString();
  debugState.lastCheckSource = "manual-today-reset";
  debugState.lastCheckDidRollover = false;
  debugState.lastCheckDidMigrate = false;
  debugState.lastRolloverDateKey = todayKey;

  return {
    medicines,
    history: historyBefore,
    historyRawBefore: window.localStorage.getItem(HISTORY_KEY),
    historyRawAfter: window.localStorage.getItem(HISTORY_KEY),
    todayKey,
    testDateSettings: getTestDateSettings(),
    lastActiveDate: loadLastActiveDate(),
  };
}

/**
 * 画面デバッグ用スナップショット。
 */
export function collectDaySyncDebugSnapshot({
  medicines = [],
  now = getCurrentDate(),
} = {}) {
  loadTestDateSettings();
  const testSettings = getTestDateSettings();
  let rawTestDate = null;
  try {
    rawTestDate = window.localStorage.getItem(TEST_DATE_KEY);
  } catch {
    rawTestDate = null;
  }

  const doses = [];
  for (const medicine of medicines ?? []) {
    for (const dose of medicine.doses ?? []) {
      doses.push({
        medicineId: medicine.id,
        medicineName: medicine.name,
        doseId: dose.id,
        label: dose.label,
        time: dose.time,
        status: dose.status,
        completedAt: dose.completedAt ?? null,
      });
    }
  }

  return {
    deviceDateKey: toDateKey(getDeviceDate()),
    currentDateKey: getCurrentDateKey(getDeviceDate()),
    logicalNowKey: toDateKey(now),
    lastActiveDate: loadLastActiveDate(),
    dailyResetMigrated: loadDailyResetMigrated(),
    dailyResetMigratedRaw:
      window.localStorage.getItem(DAILY_RESET_MIGRATED_KEY) ?? null,
    lastActiveRaw: window.localStorage.getItem(LAST_ACTIVE_DATE_KEY) ?? null,
    testDateSettings: testSettings,
    testDateRaw: rawTestDate,
    testDateAffectsClock: Boolean(testSettings.enabled && testSettings.dateKey),
    ...getDaySyncDebugState(),
    doses,
  };
}
