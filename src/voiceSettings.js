export const VOICE_SETTINGS_KEY = "megusuri-voice-settings-v1";

/** 運用時の再通知間隔。確認後は DEFAULT をこの値に戻す。 */
export const PRODUCTION_REMINDER_INTERVAL_MINUTES = 10;

/** テスト用の再通知間隔。 */
export const TEST_REMINDER_INTERVAL_MINUTES = 1;

/** 最初は1分。確認後は PRODUCTION_REMINDER_INTERVAL_MINUTES に変更する。 */
export const DEFAULT_REMINDER_INTERVAL_MINUTES = TEST_REMINDER_INTERVAL_MINUTES;

export const DEFAULT_VOICE_SETTINGS = {
  enabled: true,
  reminderIntervalMinutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
};

export function loadVoiceSettings() {
  try {
    const raw = window.localStorage.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw);
    const interval = Number(parsed.reminderIntervalMinutes);
    return {
      enabled: parsed.enabled !== false,
      reminderIntervalMinutes:
        interval === PRODUCTION_REMINDER_INTERVAL_MINUTES
          ? PRODUCTION_REMINDER_INTERVAL_MINUTES
          : TEST_REMINDER_INTERVAL_MINUTES,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings) {
  window.localStorage.setItem(
    VOICE_SETTINGS_KEY,
    JSON.stringify({
      enabled: Boolean(settings.enabled),
      reminderIntervalMinutes: Number(settings.reminderIntervalMinutes),
    }),
  );
}
