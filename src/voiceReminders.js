import { listDoseEntries } from "./medicines.js";
import { getDeviceDate } from "./testDate.js";
import { getScheduledAt, toDateKey } from "./time.js";
import {
  initialSpokenOffsets,
  listReminderOffsetsMinutes,
  phraseForReminderKind,
  planDoseReminder,
} from "./voiceReminderLogic.js";

export {
  duePhrase,
  finalReminderPhrase,
  reminderPhrase,
} from "./voiceReminderLogic.js";

export const VOICE_SPOKEN_SESSION_KEY = "megusuri-voice-spoken-v1";

export function doseKey(medicineId, doseId) {
  return `${medicineId}::${doseId}`;
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

function readSpokenSession() {
  try {
    const raw = window.sessionStorage?.getItem(VOICE_SPOKEN_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeSpokenSession(state) {
  try {
    window.sessionStorage?.setItem(
      VOICE_SPOKEN_SESSION_KEY,
      JSON.stringify(state),
    );
  } catch {
    // ignore
  }
}

/**
 * 1つの interval だけで全doseを監視する。
 * completeDose 後は notifyCompleted でそのdoseだけ止める。
 * 予定時刻判定は端末の実時計（getDeviceDate）を使う。
 */
class VoiceReminderService {
  constructor() {
    this.timerId = null;
    this.trackers = new Map();
    this.queue = [];
    this.busy = false;
    this.current = null;
    this.getMedicines = () => [];
    this.getSettings = () => ({
      enabled: true,
      reminderIntervalMinutes: 10,
      reminderWindowMinutes: 30,
    });
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
    writeSpokenSession({});
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  persistTrackers() {
    const state = {};
    for (const [key, tracker] of this.trackers.entries()) {
      state[key] = {
        date: tracker.date,
        spokenOffsets: [...tracker.spokenOffsets],
        exhausted: Boolean(tracker.exhausted),
      };
    }
    writeSpokenSession(state);
  }

  loadTrackerFromSession(key, today) {
    const saved = readSpokenSession()[key];
    if (!saved || saved.date !== today) return null;
    return {
      date: today,
      spokenOffsets: new Set(
        (saved.spokenOffsets ?? []).map(Number).filter(Number.isFinite),
      ),
      exhausted: Boolean(saved.exhausted),
    };
  }

  notifyCompleted(medicineId, doseId) {
    const key = doseKey(medicineId, doseId);
    this.trackers.delete(key);
    this.queue = this.queue.filter((item) => item.key !== key);
    const session = readSpokenSession();
    if (session[key]) {
      delete session[key];
      writeSpokenSession(session);
    }
    if (this.current?.key === key && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      this.busy = false;
      this.current = null;
      this.flush();
    }
  }

  notifyUndone(medicineId, doseId) {
    const key = doseKey(medicineId, doseId);
    this.trackers.delete(key);
    const session = readSpokenSession();
    if (session[key]) {
      delete session[key];
      writeSpokenSession(session);
    }
    // 次の tick で通知対象時間内なら再監視（過去枠は二重発火しない）
  }

  speakTest() {
    unlockSpeech();
    this.enqueue({
      key: "test",
      kind: "test",
      offset: null,
      text: "点眼の音声通知のテストです",
    });
  }

  /** 読み上げ中・キュー待ちを含む。自動更新の安全判定用。 */
  isSpeaking() {
    if (this.busy || this.current || this.queue.length > 0) return true;
    if ("speechSynthesis" in window) {
      return (
        Boolean(window.speechSynthesis.speaking) ||
        Boolean(window.speechSynthesis.pending)
      );
    }
    return false;
  }

  tick() {
    const settings = this.getSettings();
    if (!settings?.enabled) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }
    if (!("speechSynthesis" in window)) return;

    const medicines = this.getMedicines() ?? [];
    const now = getDeviceDate();
    const today = toDateKey(now);
    const intervalMinutes = Math.max(
      1,
      Number(settings.reminderIntervalMinutes) || 10,
    );
    const windowMinutes = Math.max(
      intervalMinutes,
      Number(settings.reminderWindowMinutes) || 30,
    );
    const offsets = listReminderOffsetsMinutes(intervalMinutes, windowMinutes);
    const nowMs = now.getTime();

    for (const { medicine, dose } of listDoseEntries(medicines)) {
      const key = doseKey(medicine.id, dose.id);
      if (dose.status === "done") {
        if (this.trackers.has(key)) {
          this.trackers.delete(key);
          this.persistTrackers();
        }
        continue;
      }

      const scheduled = getScheduledAt(dose.time, now);
      const scheduledMs = scheduled.getTime();
      if (nowMs < scheduledMs) {
        continue;
      }

      let tracker = this.trackers.get(key);
      if (!tracker || tracker.date !== today) {
        tracker =
          this.loadTrackerFromSession(key, today) ||
          {
            date: today,
            spokenOffsets: initialSpokenOffsets(nowMs, scheduledMs, offsets),
            exhausted: false,
          };
        this.trackers.set(key, tracker);
        this.persistTrackers();
      }

      if (tracker.exhausted) continue;

      const plan = planDoseReminder({
        nowMs,
        scheduledMs,
        spokenOffsets: tracker.spokenOffsets,
        intervalMinutes,
        windowMinutes,
      });

      tracker.spokenOffsets = plan.spokenOffsets;
      if (plan.exhausted) {
        tracker.exhausted = true;
        this.persistTrackers();
        continue;
      }

      if (plan.action !== "speak") {
        this.persistTrackers();
        continue;
      }

      this.enqueue({
        key,
        kind: plan.kind,
        offset: plan.offset,
        text: phraseForReminderKind(plan.kind, medicine.name, dose.label),
      });
      this.persistTrackers();
    }
  }

  enqueue(item) {
    const duplicate =
      (this.current?.key === item.key &&
        this.current?.kind === item.kind &&
        this.current?.offset === item.offset) ||
      this.queue.some(
        (queued) =>
          queued.key === item.key &&
          queued.kind === item.kind &&
          queued.offset === item.offset,
      );
    if (duplicate) return;
    this.queue.push(item);
    this.flush();
  }

  flush() {
    if (this.busy || this.queue.length === 0) return;
    if (!("speechSynthesis" in window)) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
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
