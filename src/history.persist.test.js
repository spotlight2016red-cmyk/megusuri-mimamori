import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  DAILY_RESET_MIGRATED_KEY,
  HISTORY_KEY,
  LAST_ACTIVE_DATE_KEY,
  applyAndPersistDayRollover,
  loadDailyResetMigrated,
  loadHistory,
  loadLastActiveDate,
} from "./history.js";
import { STORAGE_KEY, loadMedicines, saveMedicines } from "./storage.js";

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
}

const medicinesWithDone = [
  {
    id: "a",
    shortName: "A",
    name: "目薬A",
    color: "#0f9f78",
    doses: [
      {
        id: "a-morning",
        label: "朝",
        time: "08:00",
        status: "done",
        completedAt: "07:55",
      },
      {
        id: "a-evening",
        label: "夕方",
        time: "18:00",
        status: "upcoming",
      },
    ],
  },
  {
    id: "b",
    shortName: "B",
    name: "目薬B",
    color: "#6657d9",
    doses: [
      {
        id: "b-night",
        label: "夜",
        time: "21:00",
        status: "done",
        completedAt: "21:10",
      },
    ],
  },
];

describe("applyAndPersistDayRollover（疑似日付変更）", () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createMemoryStorage() };
  });

  it("昨日の last-active-date なら履歴保存→リセット→今日へ更新し、同じ日の再実行では二重リセットしない", () => {
    const yesterday = "2026-09-06";
    const today = "2026-09-07";

    saveMedicines(medicinesWithDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, yesterday);

    const first = applyAndPersistDayRollover(
      loadMedicines([]),
      new Date(2026, 8, 7, 9, 0, 0),
    );

    assert.equal(first.didRollover, true);
    assert.equal(loadLastActiveDate(), today);

    const history = loadHistory();
    assert.equal(history[yesterday].length, 3);
    assert.equal(history[yesterday][0].status, "done");
    assert.equal(history[yesterday][0].completedAt, "07:55");
    assert.equal(history[yesterday][1].status, "upcoming");
    assert.equal(history[yesterday][2].status, "done");

    for (const medicine of first.medicines) {
      assert.ok(medicine.id);
      assert.ok(medicine.name);
      assert.ok(medicine.color);
      for (const dose of medicine.doses) {
        assert.equal(dose.status, "upcoming");
        assert.equal("completedAt" in dose, false);
        assert.ok(dose.id);
        assert.ok(dose.label);
        assert.ok(dose.time);
      }
    }

    assert.equal(first.medicines[0].doses[0].time, "08:00");
    assert.equal(first.medicines[0].doses[1].time, "18:00");
    assert.equal(first.medicines[1].doses[0].time, "21:00");

    const storedMedicines = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY),
    );
    assert.equal(storedMedicines[0].doses[0].status, "upcoming");
    assert.equal("completedAt" in storedMedicines[0].doses[0], false);

    const second = applyAndPersistDayRollover(
      first.medicines,
      new Date(2026, 8, 7, 10, 0, 0),
    );
    assert.equal(second.didRollover, false);
    assert.equal(Object.keys(loadHistory()).length, 1);
    assert.equal(loadHistory()[yesterday].length, 3);
  });

  it("旧版データ(doneあり・last-active-dateなし)は初回だけ upcoming へ移行する", () => {
    saveMedicines(medicinesWithDone);
    assert.equal(window.localStorage.getItem(LAST_ACTIVE_DATE_KEY), null);
    assert.equal(window.localStorage.getItem(DAILY_RESET_MIGRATED_KEY), null);

    const first = applyAndPersistDayRollover(
      loadMedicines([]),
      new Date(2026, 8, 7, 9, 0, 0),
    );

    assert.equal(first.didMigrate, true);
    assert.equal(first.didRollover, false);
    assert.equal(loadLastActiveDate(), "2026-09-07");
    assert.equal(loadDailyResetMigrated(), true);
    assert.equal(window.localStorage.getItem(HISTORY_KEY), null);

    assert.equal(first.medicines[0].id, "a");
    assert.equal(first.medicines[0].name, "目薬A");
    assert.equal(first.medicines[0].color, "#0f9f78");
    assert.equal(first.medicines[0].doses[0].id, "a-morning");
    assert.equal(first.medicines[0].doses[0].time, "08:00");
    assert.equal(first.medicines[0].doses[0].label, "朝");
    assert.equal(first.medicines[0].doses[0].status, "upcoming");
    assert.equal("completedAt" in first.medicines[0].doses[0], false);
    assert.equal(first.medicines[0].doses[1].status, "upcoming");
    assert.equal(first.medicines[1].doses[0].status, "upcoming");
    assert.equal("completedAt" in first.medicines[1].doses[0], false);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    assert.equal(stored[0].doses[0].status, "upcoming");
    assert.equal("completedAt" in stored[0].doses[0], false);

    // 同日に done にしてから再起動しても、移行済みフラグで再リセットしない
    const afterUse = structuredClone(first.medicines);
    afterUse[0].doses[0].status = "done";
    afterUse[0].doses[0].completedAt = "08:05";
    saveMedicines(afterUse);

    const second = applyAndPersistDayRollover(
      loadMedicines([]),
      new Date(2026, 8, 7, 10, 0, 0),
    );
    assert.equal(second.didMigrate, false);
    assert.equal(second.didRollover, false);
    assert.equal(second.medicines[0].doses[0].status, "done");
    assert.equal(second.medicines[0].doses[0].completedAt, "08:05");
    assert.equal(window.localStorage.getItem(HISTORY_KEY), null);
  });

  it("既に last-active-date がある端末では移行リセットしない", () => {
    saveMedicines(medicinesWithDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-07");

    const result = applyAndPersistDayRollover(
      loadMedicines([]),
      new Date(2026, 8, 7, 9, 0, 0),
    );

    assert.equal(result.didMigrate, false);
    assert.equal(result.didRollover, false);
    assert.equal(result.medicines[0].doses[0].status, "done");
    assert.equal(result.medicines[0].doses[0].completedAt, "07:55");
    assert.equal(loadDailyResetMigrated(), true);
    assert.equal(window.localStorage.getItem(HISTORY_KEY), null);
  });
});
