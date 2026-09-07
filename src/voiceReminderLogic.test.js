import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  duePhrase,
  finalReminderPhrase,
  initialSpokenOffsets,
  isPastReminderWindow,
  listReminderOffsetsMinutes,
  phraseForReminderKind,
  planDoseReminder,
  reminderKindForOffset,
  reminderPhrase,
} from "./voiceReminderLogic.js";
import {
  DEFAULT_VOICE_SETTINGS,
  PRODUCTION_REMINDER_INTERVAL_MINUTES,
  PRODUCTION_REMINDER_WINDOW_MINUTES,
  TEST_REMINDER_INTERVAL_MINUTES,
  TEST_REMINDER_WINDOW_MINUTES,
  normalizeVoiceSettings,
  productionReminderPreset,
  testReminderPreset,
} from "./voiceSettings.js";

const scheduledMs = Date.UTC(2026, 8, 7, 8, 0, 0);

function atOffset(minutes, seconds = 0) {
  return scheduledMs + minutes * 60_000 + seconds * 1000;
}

describe("voice reminder offsets", () => {
  it("本番 10/30 は 0,10,20,30", () => {
    assert.deepEqual(
      listReminderOffsetsMinutes(
        PRODUCTION_REMINDER_INTERVAL_MINUTES,
        PRODUCTION_REMINDER_WINDOW_MINUTES,
      ),
      [0, 10, 20, 30],
    );
  });

  it("テスト 1/3 は 0,1,2,3", () => {
    assert.deepEqual(
      listReminderOffsetsMinutes(
        TEST_REMINDER_INTERVAL_MINUTES,
        TEST_REMINDER_WINDOW_MINUTES,
      ),
      [0, 1, 2, 3],
    );
  });

  it("kind と文言を分ける", () => {
    assert.equal(reminderKindForOffset(0, 30), "due");
    assert.equal(reminderKindForOffset(10, 30), "reminder");
    assert.equal(reminderKindForOffset(30, 30), "final");
    assert.equal(duePhrase("目薬A", "朝"), "目薬A、朝の点眼時間です");
    assert.equal(
      reminderPhrase("目薬A", "朝"),
      "目薬A、朝の点眼がまだ完了していません",
    );
    assert.equal(
      finalReminderPhrase("目薬A", "朝"),
      "目薬A、朝の点眼がまだ確認できていません。確認してください",
    );
    assert.equal(
      phraseForReminderKind("final", "目薬A", "朝"),
      finalReminderPhrase("目薬A", "朝"),
    );
  });
});

describe("planDoseReminder スケジュール", () => {
  it("予定前は wait", () => {
    const plan = planDoseReminder({
      nowMs: atOffset(-1),
      scheduledMs,
      spokenOffsets: [],
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(plan.action, "wait");
  });

  it("テスト間隔: 初回→1→2→最終→終了", () => {
    let spoken = [];

    const due = planDoseReminder({
      nowMs: atOffset(0),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(due.action, "speak");
    assert.equal(due.kind, "due");
    assert.equal(due.offset, 0);
    spoken = [...due.spokenOffsets];

    const r1 = planDoseReminder({
      nowMs: atOffset(1),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(r1.action, "speak");
    assert.equal(r1.kind, "reminder");
    assert.equal(r1.offset, 1);
    spoken = [...r1.spokenOffsets];

    const r2 = planDoseReminder({
      nowMs: atOffset(2),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(r2.action, "speak");
    assert.equal(r2.kind, "reminder");
    assert.equal(r2.offset, 2);
    spoken = [...r2.spokenOffsets];

    const final = planDoseReminder({
      nowMs: atOffset(3),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(final.action, "speak");
    assert.equal(final.kind, "final");
    assert.equal(final.offset, 3);
    spoken = [...final.spokenOffsets];

    const after = planDoseReminder({
      nowMs: atOffset(4),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(after.action, "exhausted");
    assert.equal(after.exhausted, true);
  });

  it("使用済み相当: 発火済み以降は speak しない", () => {
    const afterComplete = planDoseReminder({
      nowMs: atOffset(2),
      scheduledMs,
      spokenOffsets: [0, 1],
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    // 完了後は tracker 削除されるが、もし残っていても offset 2 は来る。
    // 「使用済みにしたら停止」は service 側。ここでは二重発火防止を確認。
    const sameSlotAgain = planDoseReminder({
      nowMs: atOffset(1, 5),
      scheduledMs,
      spokenOffsets: [0, 1],
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(sameSlotAgain.action, "wait");
    assert.equal(afterComplete.action, "speak");
    assert.equal(afterComplete.offset, 2);
  });

  it("ページ再表示: 過ぎた枠は初回マークで再発火しない", () => {
    const offsets = listReminderOffsetsMinutes(1, 3);
    const spoken = initialSpokenOffsets(atOffset(1, 30), scheduledMs, offsets);
    assert.ok(spoken.has(0));
    assert.ok(spoken.has(1));
    assert.equal(spoken.has(2), false);

    const plan = planDoseReminder({
      nowMs: atOffset(1, 30),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(plan.action, "wait");
  });

  it("ちょうど枠到達時は初回マーク対象外で発火できる", () => {
    const offsets = listReminderOffsetsMinutes(1, 3);
    const spoken = initialSpokenOffsets(atOffset(1), scheduledMs, offsets);
    assert.equal(spoken.has(1), false);
    const plan = planDoseReminder({
      nowMs: atOffset(1),
      scheduledMs,
      spokenOffsets: spoken,
      intervalMinutes: 1,
      windowMinutes: 3,
    });
    assert.equal(plan.action, "speak");
    assert.equal(plan.offset, 1);
  });

  it("本番 10/30 の最終は 30 分", () => {
    const plan = planDoseReminder({
      nowMs: atOffset(30),
      scheduledMs,
      spokenOffsets: [0, 10, 20],
      intervalMinutes: 10,
      windowMinutes: 30,
    });
    assert.equal(plan.action, "speak");
    assert.equal(plan.kind, "final");
    assert.equal(plan.offset, 30);
  });
});

describe("window / settings", () => {
  it("30分以上経過を判定する", () => {
    assert.equal(isPastReminderWindow(scheduledMs, atOffset(29, 59), 30), false);
    assert.equal(isPastReminderWindow(scheduledMs, atOffset(30), 30), true);
  });

  it("初期値はテスト 1/3（実機確認用）", () => {
    assert.deepEqual(DEFAULT_VOICE_SETTINGS, {
      enabled: true,
      reminderIntervalMinutes: 1,
      reminderWindowMinutes: 3,
    });
  });

  it("旧設定（間隔のみ）から window を補完する", () => {
    assert.deepEqual(normalizeVoiceSettings({ enabled: true, reminderIntervalMinutes: 1 }), {
      enabled: true,
      reminderIntervalMinutes: 1,
      reminderWindowMinutes: 3,
    });
    assert.deepEqual(normalizeVoiceSettings({ reminderIntervalMinutes: 10 }), {
      enabled: true,
      reminderIntervalMinutes: 10,
      reminderWindowMinutes: 30,
    });
  });

  it("プリセットを提供する", () => {
    assert.deepEqual(productionReminderPreset(), {
      reminderIntervalMinutes: 10,
      reminderWindowMinutes: 30,
    });
    assert.deepEqual(testReminderPreset(), {
      reminderIntervalMinutes: 1,
      reminderWindowMinutes: 3,
    });
  });
});
