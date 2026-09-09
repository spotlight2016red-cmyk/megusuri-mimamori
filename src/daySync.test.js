import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  DAILY_RESET_MIGRATED_KEY,
  LAST_ACTIVE_DATE_KEY,
  applyAndPersistDayRollover,
  loadHistory,
  loadLastActiveDate,
} from "./history.js";
import { STORAGE_KEY, loadMedicines, saveMedicines } from "./storage.js";
import {
  TEST_DATE_KEY,
  clearTestDateSettings,
  getCurrentDateKey,
  resetTestDateCacheForTests,
  saveTestDateSettings,
} from "./testDate.js";
import {
  resetDaySyncDebugStateForTests,
  runDayBoundarySync,
} from "./daySync.js";

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

const threeDone = [
  {
    id: "a",
    shortName: "A",
    name: "目薬A",
    color: "#0f9f78",
    doses: [
      {
        id: "a1",
        label: "朝",
        time: "08:00",
        status: "done",
        completedAt: "08:01",
      },
      {
        id: "a2",
        label: "昼",
        time: "12:00",
        status: "done",
        completedAt: "12:05",
      },
      {
        id: "a3",
        label: "夜",
        time: "21:00",
        status: "done",
        completedAt: "21:02",
      },
    ],
  },
];

describe("実時計日次同期 A/B/C", () => {
  beforeEach(() => {
    globalThis.window = {
      localStorage: createMemoryStorage(),
      sessionStorage: createMemoryStorage(),
    };
    resetTestDateCacheForTests();
    resetDaySyncDebugStateForTests();
  });

  it("A: last-active=9/8・実時計9/9・3dose done → upcoming + 履歴9/8", () => {
    saveMedicines(threeDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-08");
    window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");

    const result = runDayBoundarySync({
      now: new Date(2026, 8, 9, 9, 0, 0),
      source: "periodic-60s",
      reactMedicines: threeDone,
    });

    assert.equal(result.didRollover, true);
    assert.equal(loadLastActiveDate(), "2026-09-09");
    assert.equal(result.medicines[0].doses.length, 3);
    for (const dose of result.medicines[0].doses) {
      assert.equal(dose.status, "upcoming");
      assert.equal("completedAt" in dose, false);
    }

    const history = loadHistory();
    assert.equal(history["2026-09-08"].length, 3);
    assert.equal(history["2026-09-08"][0].status, "done");
    assert.equal(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].doses[0].status,
      "upcoming",
    );
  });

  it("B: バックグラウンドで LS 更新済み・React は古い done → visible 同期で state 相当が upcoming", () => {
    // 背景で日次処理が走り LS と last-active だけ更新された状態を再現
    saveMedicines(threeDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-08");
    window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");
    applyAndPersistDayRollover(threeDone, new Date(2026, 8, 9, 0, 5, 0));
    assert.equal(loadLastActiveDate(), "2026-09-09");
    assert.equal(loadMedicines([])[0].doses[0].status, "upcoming");

    // React state は更新されず古い done のまま、という前提
    const staleReactState = structuredClone(threeDone);
    assert.equal(staleReactState[0].doses[0].status, "done");

    const resumed = runDayBoundarySync({
      now: new Date(2026, 8, 9, 8, 0, 0),
      source: "visibilitychange",
      reactMedicines: staleReactState,
    });

    assert.equal(resumed.didRollover, false);
    assert.equal(resumed.inputSource, "localStorage");
    // 呼び出し側がこの medicines を setState すれば UI も upcoming になる
    assert.equal(resumed.medicines[0].doses[0].status, "upcoming");
    assert.equal(resumed.medicines[0].doses[1].status, "upcoming");
    assert.equal(resumed.medicines[0].doses[2].status, "upcoming");
  });

  it("C: 日付変更時の戻り値 medicines は即 upcoming（React 反映用）", () => {
    saveMedicines(threeDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-08");
    window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");

    const result = runDayBoundarySync({
      now: new Date(2026, 8, 9, 10, 0, 0),
      source: "focus",
      reactMedicines: threeDone,
    });

    assert.equal(result.didRollover, true);
    assert.ok(result.medicines !== threeDone);
    assert.equal(
      result.medicines.every((medicine) =>
        medicine.doses.every((dose) => dose.status === "upcoming"),
      ),
      true,
    );
  });

  it("テスト日付OFFなら raw に古い dateKey が残っても日付判定へ影響しない", () => {
    window.localStorage.setItem(
      TEST_DATE_KEY,
      JSON.stringify({ enabled: false, dateKey: "2026-09-01" }),
    );
    resetTestDateCacheForTests();
    const key = getCurrentDateKey(new Date(2026, 8, 9, 12, 0, 0));
    assert.equal(key, "2026-09-09");

    clearTestDateSettings();
    saveTestDateSettings({ enabled: false, dateKey: "2030-01-01" });
    assert.equal(
      getCurrentDateKey(new Date(2026, 8, 9, 12, 0, 0)),
      "2026-09-09",
    );
  });

  it("persist 順序: medicines リセット保存の後に last-active が今日になる", () => {
    const writes = [];
    const base = createMemoryStorage();
    globalThis.window = {
      localStorage: {
        getItem: (key) => base.getItem(key),
        removeItem: (key) => base.removeItem(key),
        setItem(key, value) {
          writes.push(key);
          base.setItem(key, value);
        },
      },
      sessionStorage: createMemoryStorage(),
    };

    saveMedicines(threeDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-08");
    window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");
    writes.length = 0;

    applyAndPersistDayRollover(threeDone, new Date(2026, 8, 9, 9, 0, 0));

    const historyIdx = writes.indexOf("megusuri-history-v1");
    const medicinesIdx = writes.indexOf(STORAGE_KEY);
    const lastActiveIdx = writes.indexOf(LAST_ACTIVE_DATE_KEY);
    assert.ok(historyIdx >= 0);
    assert.ok(medicinesIdx >= 0);
    assert.ok(lastActiveIdx >= 0);
    assert.ok(historyIdx < medicinesIdx);
    assert.ok(medicinesIdx < lastActiveIdx);
  });
});
