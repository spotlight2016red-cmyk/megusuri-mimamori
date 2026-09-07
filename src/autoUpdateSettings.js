export const AUTO_UPDATE_SETTINGS_KEY = "megusuri-auto-update-settings-v1";

/** 将来の設定画面から変更できる初期値（02:00〜04:00）。 */
export const DEFAULT_AUTO_UPDATE_SETTINGS = {
  enabled: true,
  startHour: 2,
  startMinute: 0,
  endHour: 4,
  endMinute: 0,
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function normalizeAutoUpdateSettings(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    startHour: clampInt(raw.startHour, 0, 23, DEFAULT_AUTO_UPDATE_SETTINGS.startHour),
    startMinute: clampInt(
      raw.startMinute,
      0,
      59,
      DEFAULT_AUTO_UPDATE_SETTINGS.startMinute,
    ),
    endHour: clampInt(raw.endHour, 0, 23, DEFAULT_AUTO_UPDATE_SETTINGS.endHour),
    endMinute: clampInt(
      raw.endMinute,
      0,
      59,
      DEFAULT_AUTO_UPDATE_SETTINGS.endMinute,
    ),
  };
}

export function loadAutoUpdateSettings() {
  try {
    const raw = window.localStorage.getItem(AUTO_UPDATE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AUTO_UPDATE_SETTINGS };
    return normalizeAutoUpdateSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUTO_UPDATE_SETTINGS };
  }
}

export function saveAutoUpdateSettings(settings) {
  const normalized = normalizeAutoUpdateSettings(settings);
  window.localStorage.setItem(
    AUTO_UPDATE_SETTINGS_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

/**
 * now が自動更新時間帯内か。
 * start === end は無効。start > end は日をまたぐ帯域。
 */
export function isInAutoUpdateWindow(now = new Date(), settings = DEFAULT_AUTO_UPDATE_SETTINGS) {
  const cfg = normalizeAutoUpdateSettings(settings);
  if (!cfg.enabled) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = cfg.startHour * 60 + cfg.startMinute;
  const end = cfg.endHour * 60 + cfg.endMinute;
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}
