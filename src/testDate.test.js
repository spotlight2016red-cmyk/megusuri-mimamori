import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearTestDateSettings,
  formatTestDateLabel,
  getCurrentDate,
  getCurrentDateKey,
  getDeviceDate,
  loadTestDateSettings,
  nextTestDateSettings,
  resetTestDateCacheForTests,
  saveTestDateSettings,
  TEST_DATE_KEY,
} from "./testDate.js";
import {
  DAILY_RESET_MIGRATED_KEY,
  HISTORY_KEY,
  LAST_ACTIVE_DATE_KEY,
  applyAndPersistDayRollover,
  loadHistory,
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
    ],
  },
];

describe("testDate helpers", () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createMemoryStorage() };
    resetTestDateCacheForTests();
  });

  it("通常は端末日時を返す", () => {
    const device = new Date(2026, 8, 7, 15, 30, 0);
    assert.equal(getCurrentDateKey(device), "2026-09-07");
    assert.equal(getCurrentDate(device).getHours(), 15);
  });

  it("テストモード時は日付だけ差し替え、時刻は端末時計", () => {
    saveTestDateSettings({ enabled: true, dateKey: "2026-09-08" });
    const device = new Date(2026, 8, 7, 15, 30, 45, 123);
    const current = getCurrentDate(device);
    assert.equal(toDateKeyLike(current), "2026-09-08");
    assert.equal(current.getHours(), 15);
    assert.equal(current.getMinutes(), 30);
    assert.equal(current.getSeconds(), 45);
  });

  it("端末の日付に戻すと解除される", () => {
    saveTestDateSettings({ enabled: true, dateKey: "2026-09-08" });
    clearTestDateSettings();
    assert.deepEqual(loadTestDateSettings(), {
      enabled: false,
      dateKey: null,
    });
    assert.equal(window.localStorage.getItem(TEST_DATE_KEY), JSON.stringify({
      enabled: false,
      dateKey: null,
    }));
  });

  it("＋1日の次設定を計算する", () => {
    const next = nextTestDateSettings(
      { enabled: true, dateKey: "2026-09-07" },
      new Date(2026, 8, 7, 10, 0, 0),
    );
    assert.deepEqual(next, { enabled: true, dateKey: "2026-09-08" });
  });

  it("表示ラベルを 2026/09/08 形式にする", () => {
    assert.equal(formatTestDateLabel("2026-09-08"), "2026/09/08");
  });

  it("getDeviceDate はテスト日付の影響を受けない", () => {
    saveTestDateSettings({ enabled: true, dateKey: "2030-01-01" });
    const before = Date.now();
    const device = getDeviceDate();
    const after = Date.now();
    assert.ok(device.getTime() >= before - 5);
    assert.ok(device.getTime() <= after + 5);
    assert.equal(getCurrentDateKey(device), "2030-01-01");
    assert.notEqual(toDateKeyLike(device), "2030-01-01");
  });
});

function toDateKeyLike(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

describe("テスト日付＋1日で通常の日次リセットを通す", () => {
  beforeEach(() => {
    globalThis.window = { localStorage: createMemoryStorage() };
    resetTestDateCacheForTests();
  });

  it("9/7 done → ＋1日 → 9/8 upcoming かつ履歴9/7に done", () => {
    saveMedicines(medicinesWithDone);
    window.localStorage.setItem(LAST_ACTIVE_DATE_KEY, "2026-09-07");
    window.localStorage.setItem(DAILY_RESET_MIGRATED_KEY, "1");
    saveTestDateSettings({ enabled: true, dateKey: "2026-09-07" });

    // 使用済みのまま 9/7
    let medicines = loadMedicines([]);
    assert.equal(medicines[0].doses[0].status, "done");

    // 「＋1日進める」と同じ手順: 設定保存 → 通常の日次処理
    const advanced = nextTestDateSettings(
      loadTestDateSettings(),
      new Date(2026, 8, 7, 11, 0, 0),
    );
    saveTestDateSettings(advanced);
    assert.equal(getCurrentDateKey(new Date(2026, 8, 7, 11, 0, 0)), "2026-09-08");

    const result = applyAndPersistDayRollover(
      medicines,
      getCurrentDate(new Date(2026, 8, 7, 11, 0, 0)),
    );

    assert.equal(result.didRollover, true);
    assert.equal(result.lastActiveDate, "2026-09-08");
    assert.equal(result.medicines[0].doses[0].status, "upcoming");
    assert.equal("completedAt" in result.medicines[0].doses[0], false);
    assert.equal(result.medicines[0].name, "目薬A");
    assert.equal(result.medicines[0].color, "#0f9f78");
    assert.equal(result.medicines[0].doses[0].id, "a-morning");
    assert.equal(result.medicines[0].doses[0].time, "08:00");

    const history = loadHistory();
    assert.equal(history["2026-09-07"].length, 1);
    assert.equal(history["2026-09-07"][0].status, "done");
    assert.equal(history["2026-09-07"][0].completedAt, "07:55");
    assert.equal(window.localStorage.getItem(HISTORY_KEY) != null, true);
    assert.equal(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].doses[0].status,
      "upcoming",
    );
  });
});
