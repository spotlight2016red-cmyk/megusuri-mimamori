import { listDoseEntries } from "./medicines.js";
import { getScheduledAt, toDateKey } from "./time.js";

export function doseKey(medicineId, doseId) {
  return `${medicineId}::${doseId}`;
}

export function duePhrase(medicineName, doseLabel) {
  return `${medicineName}、${doseLabel}の点眼時間です`;
}

export function reminderPhrase(medicineName, doseLabel) {
  return `${medicineName}、${doseLabel}の点眼がまだ完了していません`;
}

function pickJapaneseVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  return (
    voices.find((voice) => voice.lang === "ja-JP") ||
    voices.find((voice) => voice.lang?.startsWith("ja")) ||
    null
  );
}

function createUtterance(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 1;
  utterance.pitch = 1;
  const voice = pickJapaneseVoice();
  if (voice) utterance.voice = voice;
  return utterance;
}

export function unlockSpeech() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.resume();
}

/**
 * 1つの interval だけで全doseを監視する。
 * completeDose 後は notifyCompleted でそのdoseだけ止める。
 */
class VoiceReminderService {
  constructor() {
    this.timerId = null;
    this.trackers = new Map();
    this.queue = [];
    this.busy = false;
    this.current = null;
    this.getMedicines = () => [];
    this.getSettings = () => ({ enabled: true, reminderIntervalMinutes: 1 });
  }

  setGetters({ getMedicines, getSettings }) {
    if (getMedicines) this.getMedicines = getMedicines;
    if (getSettings) this.getSettings = getSettings;
  }

  start() {
    if (this.timerId != null) return;
    this.timerId = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.timerId != null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  resetAll() {
    this.trackers.clear();
    this.queue = [];
    this.current = null;
    this.busy = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  notifyCompleted(medicineId, doseId) {
    const key = doseKey(medicineId, doseId);
    this.trackers.delete(key);
    this.queue = this.queue.filter((item) => item.key !== key);
    if (this.current?.key === key && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      this.busy = false;
      this.current = null;
      this.flush();
    }
  }

  notifyUndone(medicineId, doseId) {
    this.trackers.delete(doseKey(medicineId, doseId));
  }

  speakTest() {
    unlockSpeech();
    this.enqueue({
      key: "test",
      kind: "test",
      text: "点眼の音声通知のテストです",
    });
  }

  tick() {
    const settings = this.getSettings();
    if (!settings?.enabled) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (!("speechSynthesis" in window)) return;

    const medicines = this.getMedicines() ?? [];
    const now = new Date();
    const today = toDateKey(now);
    const intervalMs = Math.max(1, Number(settings.reminderIntervalMinutes) || 1) * 60 * 1000;

    for (const { medicine, dose } of listDoseEntries(medicines)) {
      const key = doseKey(medicine.id, dose.id);
      if (dose.status === "done") {
        this.trackers.delete(key);
        continue;
      }

      const scheduled = getScheduledAt(dose.time, now);
      if (now.getTime() < scheduled.getTime()) continue;

      let tracker = this.trackers.get(key);
      if (!tracker || tracker.date !== today) {
        tracker = { date: today, dueSpoken: false, lastSpokenAt: 0 };
        this.trackers.set(key, tracker);
      }

      if (!tracker.dueSpoken) {
        this.enqueue({
          key,
          kind: "due",
          text: duePhrase(medicine.name, dose.label),
        });
        tracker.dueSpoken = true;
        tracker.lastSpokenAt = now.getTime();
        continue;
      }

      if (now.getTime() - tracker.lastSpokenAt >= intervalMs) {
        this.enqueue({
          key,
          kind: "reminder",
          text: reminderPhrase(medicine.name, dose.label),
        });
        tracker.lastSpokenAt = now.getTime();
      }
    }
  }

  enqueue(item) {
    const duplicate =
      this.current?.key === item.key && this.current?.kind === item.kind
        ? true
        : this.queue.some((queued) => queued.key === item.key && queued.kind === item.kind);
    if (duplicate) return;
    this.queue.push(item);
    this.flush();
  }

  flush() {
    if (this.busy || this.queue.length === 0) return;
    if (!("speechSynthesis" in window)) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    const item = this.queue.shift();
    this.busy = true;
    this.current = item;
    window.speechSynthesis.resume();
    const utterance = createUtterance(item.text);

    const finish = () => {
      if (this.current !== item) return;
      window.clearTimeout(safety);
      this.busy = false;
      this.current = null;
      this.flush();
    };

    const safety = window.setTimeout(finish, 12000);
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }
}

export const voiceReminderService = new VoiceReminderService();

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    pickJapaneseVoice();
  });
}
