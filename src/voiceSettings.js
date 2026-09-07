export const VOICE_SETTINGS_KEY = "megusuri-voice-settings-v1";

/** 本番: 再通知間隔（分） */
export const PRODUCTION_REMINDER_INTERVAL_MINUTES = 10;
/** 本番: 予定時刻からの通知終了（分） */
export const PRODUCTION_REMINDER_WINDOW_MINUTES = 30;

/** 開発・テスト: 再通知間隔（分） */
export const TEST_REMINDER_INTERVAL_MINUTES = 1;
/** 開発・テスト: 通知終了（分） */
export const TEST_REMINDER_WINDOW_MINUTES = 3;

/** 実機確認中の初期値（確認後は運用 10/30 に切替） */
export const DEFAULT_REMINDER_INTERVAL_MINUTES = TEST_REMINDER_INTERVAL_MINUTES;
export const DEFAULT_REMINDER_WINDOW_MINUTES = TEST_REMINDER_WINDOW_MINUTES;

export const DEFAULT_VOICE_SETTINGS = {
  enabled: true,
  reminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
  reminderWindowMinutes: DEFAULT_REMINDER_WINDOW_MINUTES,
};

export function isTestReminderPreset(settings) {
  return (
    Number(settings?.reminderIntervalMinutes) ===
      TEST_REMINDER_INTERVAL_MINUTES &&
    Number(settings?.reminderWindowMinutes) === TEST_REMINDER_WINDOW_MINUTES
  );
}

export function normalizeVoiceSettings(raw = {}) {
  const enabled = raw.enabled !== false;
  const interval = Number(raw.reminderIntervalMinutes);
  const windowRaw = Number(raw.reminderWindowMinutes);

  const reminderIntervalMinutes =
    interval === TEST_REMINDER_INTERVAL_MINUTES
      ? TEST_REMINDER_INTERVAL_MINUTES
      : PRODUCTION_REMINDER_INTERVAL_MINUTES;

  let reminderWindowMinutes;
  if (Number.isFinite(windowRaw) && windowRaw > 0) {
    reminderWindowMinutes = Math.trunc(windowRaw);
  } else if (reminderIntervalMinutes === TEST_REMINDER_INTERVAL_MINUTES) {
    reminderWindowMinutes = TEST_REMINDER_WINDOW_MINUTES;
  } else {
    reminderWindowMinutes = PRODUCTION_REMINDER_WINDOW_MINUTES;
  }

  return {
    enabled,
    reminderIntervalMinutes,
    reminderWindowMinutes: Math.max(
      reminderIntervalMinutes,
      reminderWindowMinutes,
    ),
  };
}

export function loadVoiceSettings() {
  try {
    const raw = window.localStorage.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    return normalizeVoiceSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings) {
  const normalized = normalizeVoiceSettings(settings);
  window.localStorage.setItem(
    VOICE_SETTINGS_KEY,
    JSON.stringify({
      enabled: normalized.enabled,
      reminderIntervalMinutes: normalized.reminderIntervalMinutes,
      reminderWindowMinutes: normalized.reminderWindowMinutes,
    }),
  );
  return normalized;
}

export function productionReminderPreset() {
  return {
    reminderIntervalMinutes: PRODUCTION_REMINDER_INTERVAL_MINUTES,
    reminderWindowMinutes: PRODUCTION_REMINDER_WINDOW_MINUTES,
  };
}

export function testReminderPreset() {
  return {
    reminderIntervalMinutes: TEST_REMINDER_INTERVAL_MINUTES,
    reminderWindowMinutes: TEST_REMINDER_WINDOW_MINUTES,
  };
}
