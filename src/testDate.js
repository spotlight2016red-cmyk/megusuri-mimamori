import { parseDateKey, toDateKey } from "./time.js";

export const TEST_DATE_KEY = "megusuri-test-date-v1";

export const DEFAULT_TEST_DATE_SETTINGS = {
  enabled: false,
  dateKey: null,
};

let cachedSettings = null;

function isValidDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = parseDateKey(value);
  return toDateKey(parsed) === value;
}

export function normalizeTestDateSettings(raw = {}) {
  const enabled = Boolean(raw.enabled);
  const dateKey =
    enabled && isValidDateKey(raw.dateKey) ? raw.dateKey : null;
  return {
    enabled: enabled && Boolean(dateKey),
    dateKey: enabled ? dateKey : null,
  };
}

export function loadTestDateSettings() {
  try {
    const raw = window.localStorage.getItem(TEST_DATE_KEY);
    if (!raw) {
      cachedSettings = { ...DEFAULT_TEST_DATE_SETTINGS };
      return cachedSettings;
    }
    cachedSettings = normalizeTestDateSettings(JSON.parse(raw));
    return cachedSettings;
  } catch {
    cachedSettings = { ...DEFAULT_TEST_DATE_SETTINGS };
    return cachedSettings;
  }
}

export function getTestDateSettings() {
  return cachedSettings ?? loadTestDateSettings();
}

export function saveTestDateSettings(settings) {
  const normalized = normalizeTestDateSettings(settings);
  window.localStorage.setItem(TEST_DATE_KEY, JSON.stringify(normalized));
  cachedSettings = normalized;
  return normalized;
}

export function clearTestDateSettings() {
  return saveTestDateSettings({ enabled: false, dateKey: null });
}

/** 常に端末の実日時。音声・自動更新の時刻判定用。 */
export function getDeviceDate() {
  return new Date();
}

/**
 * アプリの論理日時。
 * 通常は端末日時。テストモード時は指定日 + 端末の時刻。
 */
export function getCurrentDate(deviceNow = getDeviceDate()) {
  const settings = getTestDateSettings();
  if (!settings.enabled || !settings.dateKey) {
    return new Date(deviceNow.getTime());
  }
  const current = parseDateKey(settings.dateKey);
  current.setHours(
    deviceNow.getHours(),
    deviceNow.getMinutes(),
    deviceNow.getSeconds(),
    deviceNow.getMilliseconds(),
  );
  return current;
}

export function getCurrentDateKey(deviceNow = getDeviceDate()) {
  return toDateKey(getCurrentDate(deviceNow));
}

/** 表示用: 2026/09/08 */
export function formatTestDateLabel(dateKey) {
  if (!isValidDateKey(dateKey)) return "";
  const [yyyy, mm, dd] = dateKey.split("-");
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * テスト日付を1日進めた設定を返す（保存はしない）。
 * 呼び出し側で保存後、通常の日次リセットを通す。
 */
export function nextTestDateSettings(settings = getTestDateSettings(), deviceNow = getDeviceDate()) {
  const baseKey =
    settings.enabled && settings.dateKey
      ? settings.dateKey
      : toDateKey(deviceNow);
  const next = parseDateKey(baseKey);
  next.setDate(next.getDate() + 1);
  return {
    enabled: true,
    dateKey: toDateKey(next),
  };
}

/** テスト用にキャッシュを捨てる */
export function resetTestDateCacheForTests() {
  cachedSettings = null;
}
