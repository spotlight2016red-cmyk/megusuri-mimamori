import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_AUTO_UPDATE_SETTINGS,
  isInAutoUpdateWindow,
  normalizeAutoUpdateSettings,
} from "./autoUpdateSettings.js";
import {
  canSafelyAutoUpdate,
  evaluateSafeAutoUpdate,
  hasActiveIncompleteReminders,
  hasUpcomingDoseWithin,
} from "./safeAutoUpdate.js";

function at(hours, minutes = 0) {
  return new Date(2026, 8, 7, hours, minutes, 0, 0);
}

function medicinesWithDose(time, status = "upcoming") {
  return [
    {
      id: "m1",
      name: "目薬A",
      doses: [{ id: "d1", label: "朝", time, status }],
    },
  ];
}

describe("autoUpdateSettings", () => {
  it("初期値は 02:00〜04:00 で有効", () => {
    assert.deepEqual(DEFAULT_AUTO_UPDATE_SETTINGS, {
      enabled: true,
      startHour: 2,
      startMinute: 0,
      endHour: 4,
      endMinute: 0,
    });
  });

  it("不正値を正規化する", () => {
    const normalized = normalizeAutoUpdateSettings({
      enabled: false,
      startHour: 99,
      startMinute: -3,
      endHour: "3",
      endMinute: 90,
    });
    assert.equal(normalized.enabled, false);
    assert.equal(normalized.startHour, 23);
    assert.equal(normalized.startMinute, 0);
    assert.equal(normalized.endHour, 3);
    assert.equal(normalized.endMinute, 59);
  });

  it("02:00〜04:00 の判定", () => {
    const settings = DEFAULT_AUTO_UPDATE_SETTINGS;
    assert.equal(isInAutoUpdateWindow(at(1, 59), settings), false);
    assert.equal(isInAutoUpdateWindow(at(2, 0), settings), true);
    assert.equal(isInAutoUpdateWindow(at(3, 30), settings), true);
    assert.equal(isInAutoUpdateWindow(at(4, 0), settings), false);
    assert.equal(isInAutoUpdateWindow(at(14, 0), settings), false);
  });

  it("日をまたぐ時間帯も扱える", () => {
    const overnight = normalizeAutoUpdateSettings({
      startHour: 23,
      startMinute: 0,
      endHour: 1,
      endMinute: 0,
    });
    assert.equal(isInAutoUpdateWindow(at(23, 30), overnight), true);
    assert.equal(isInAutoUpdateWindow(at(0, 30), overnight), true);
    assert.equal(isInAutoUpdateWindow(at(1, 0), overnight), false);
    assert.equal(isInAutoUpdateWindow(at(12, 0), overnight), false);
  });
});

describe("safeAutoUpdate", () => {
  it("直近30分以内の予定を検出する", () => {
    const now = at(2, 10);
    assert.equal(
      hasUpcomingDoseWithin(medicinesWithDose("02:30"), now, 30),
      true,
    );
    assert.equal(
      hasUpcomingDoseWithin(medicinesWithDose("02:50"), now, 30),
      false,
    );
    assert.equal(
      hasUpcomingDoseWithin(medicinesWithDose("02:30", "done"), now, 30),
      false,
    );
  });

  it("未点眼の再通知対象を検出する", () => {
    const now = at(2, 10);
    assert.equal(
      hasActiveIncompleteReminders(medicinesWithDose("02:00"), now),
      true,
    );
    assert.equal(
      hasActiveIncompleteReminders(medicinesWithDose("02:00", "done"), now),
      false,
    );
    assert.equal(
      hasActiveIncompleteReminders(medicinesWithDose("03:00"), now),
      false,
    );
  });

  it("安全条件をすべて満たすときだけ ok", () => {
    const base = {
      now: at(2, 30),
      settings: DEFAULT_AUTO_UPDATE_SETTINGS,
      medicines: medicinesWithDose("08:00"),
      pendingConfirmOpen: false,
      isSpeaking: false,
      lastActiveDate: "2026-09-07",
    };
    assert.equal(canSafelyAutoUpdate(base), true);
    assert.equal(evaluateSafeAutoUpdate(base).reason, "safe");
  });

  it("各ブロック条件で拒否する", () => {
    const base = {
      now: at(2, 30),
      settings: DEFAULT_AUTO_UPDATE_SETTINGS,
      medicines: medicinesWithDose("08:00"),
      pendingConfirmOpen: false,
      isSpeaking: false,
      lastActiveDate: "2026-09-07",
    };

    assert.equal(
      evaluateSafeAutoUpdate({ ...base, now: at(14, 0) }).reason,
      "outside-window",
    );
    assert.equal(
      evaluateSafeAutoUpdate({
        ...base,
        lastActiveDate: "2026-09-06",
      }).reason,
      "day-rollover-pending",
    );
    assert.equal(
      evaluateSafeAutoUpdate({ ...base, pendingConfirmOpen: true }).reason,
      "confirm-open",
    );
    assert.equal(
      evaluateSafeAutoUpdate({ ...base, isSpeaking: true }).reason,
      "speaking",
    );
    assert.equal(
      evaluateSafeAutoUpdate({
        ...base,
        medicines: medicinesWithDose("02:00"),
      }).reason,
      "active-reminders",
    );
    assert.equal(
      evaluateSafeAutoUpdate({
        ...base,
        medicines: medicinesWithDose("02:50"),
      }).reason,
      "near-dose",
    );
  });

  it("無効化されていると時間帯外扱い", () => {
    assert.equal(
      canSafelyAutoUpdate({
        now: at(2, 30),
        settings: { ...DEFAULT_AUTO_UPDATE_SETTINGS, enabled: false },
        medicines: medicinesWithDose("08:00"),
        lastActiveDate: "2026-09-07",
      }),
      false,
    );
  });
});
