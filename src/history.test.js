import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDayRollover,
  applyLegacyDailyResetMigration,
  formatHistoryStatus,
  listPastHistoryKeys,
  resetDosesForNewDay,
  saveHistoryDay,
  snapshotDay,
} from "./history.js";
import { cloneSeed } from "./medicines.js";

const yesterdayKey = "2026-08-25";
const todayKey = "2026-08-26";

function sampleMedicines() {
  return [
    {
      id: "a",
      shortName: "A",
      name: "目薬A",
      color: "#0f9f78",
      extra: "keep-me",
      doses: [
        {
          id: "a-morning",
          label: "朝",
          time: "08:00",
          status: "done",
          completedAt: "07:52",
          note: "keep-dose",
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
          status: "upcoming",
        },
      ],
    },
  ];
}

describe("snapshotDay", () => {
  it("done と upcoming の両方を保存し、時刻順にする", () => {
    const entries = snapshotDay(sampleMedicines());
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0], {
      medicineId: "a",
      medicineName: "目薬A",
      doseId: "a-morning",
      label: "朝",
      time: "08:00",
      status: "done",
      completedAt: "07:52",
    });
    assert.deepEqual(entries[1], {
      medicineId: "a",
      medicineName: "目薬A",
      doseId: "a-evening",
      label: "夕方",
      time: "18:00",
      status: "upcoming",
    });
    assert.equal("completedAt" in entries[1], false);
    assert.equal(entries[2].status, "upcoming");
    assert.equal(entries[2].doseId, "b-night");
  });
});

describe("saveHistoryDay", () => {
  it("同じ日付キーは上書きし、重複追加しない", () => {
    const first = saveHistoryDay({}, yesterdayKey, snapshotDay(sampleMedicines()));
    const second = saveHistoryDay(first, yesterdayKey, [
      {
        medicineId: "a",
        medicineName: "目薬A",
        doseId: "a-morning",
        label: "朝",
        time: "08:00",
        status: "done",
        completedAt: "08:03",
      },
    ]);
    assert.equal(second[yesterdayKey].length, 1);
    assert.equal(second[yesterdayKey][0].completedAt, "08:03");
  });
});

describe("applyDayRollover", () => {
  it("last-active-date が無い初回はリセットしない", () => {
    const medicines = sampleMedicines();
    const result = applyDayRollover({
      medicines,
      history: {},
      lastActiveDate: null,
      todayKey,
    });
    assert.equal(result.didRollover, false);
    assert.equal(result.medicines[0].doses[0].status, "done");
    assert.equal(result.lastActiveDate, todayKey);
    assert.deepEqual(result.history, {});
  });

  it("同じ日なら何もしない", () => {
    const medicines = sampleMedicines();
    const result = applyDayRollover({
      medicines,
      history: { [yesterdayKey]: [] },
      lastActiveDate: todayKey,
      todayKey,
    });
    assert.equal(result.didRollover, false);
    assert.equal(result.medicines, medicines);
  });

  it("新しい日なら履歴保存 → リセット → last-active-date 更新の順で処理する", () => {
    const medicines = sampleMedicines();
    const result = applyDayRollover({
      medicines,
      history: {},
      lastActiveDate: yesterdayKey,
      todayKey,
    });

    assert.equal(result.didRollover, true);
    assert.equal(result.lastActiveDate, todayKey);

    const saved = result.history[yesterdayKey];
    assert.equal(saved.length, 3);
    assert.equal(saved[0].status, "done");
    assert.equal(saved[0].completedAt, "07:52");
    assert.equal(saved[1].status, "upcoming");
    assert.equal(saved[2].status, "upcoming");

    for (const medicine of result.medicines) {
      for (const dose of medicine.doses) {
        assert.equal(dose.status, "upcoming");
        assert.equal("completedAt" in dose, false);
      }
    }

    assert.equal(result.medicines[0].name, "目薬A");
    assert.equal(result.medicines[0].doses[0].time, "08:00");
    assert.equal(result.medicines[0].doses[1].time, "18:00");
    assert.equal(result.medicines[1].doses[0].time, "21:00");
    assert.equal(result.medicines[0].extra, "keep-me");
    assert.equal(result.medicines[0].doses[0].note, "keep-dose");
    assert.equal(result.medicines[0].doses[0].id, "a-morning");
  });

  it("megusuri-medicines-v2 の配列構造を維持する", () => {
    const reset = resetDosesForNewDay(cloneSeed());
    assert.ok(Array.isArray(reset));
    assert.equal(reset[0].id, "a");
    assert.ok(Array.isArray(reset[0].doses));
    assert.equal(reset[0].doses[0].id, "a-morning");
    assert.equal(reset[0].doses[0].label, "朝");
    assert.equal(reset[0].doses[0].time, "08:00");
    assert.equal(reset[0].doses[0].status, "upcoming");
  });
});

describe("applyLegacyDailyResetMigration", () => {
  it("done を upcoming にし completedAt を消すが他フィールドは保持する", () => {
    const medicines = sampleMedicines();
    const result = applyLegacyDailyResetMigration(medicines, todayKey);

    assert.equal(result.didMigrate, true);
    assert.equal(result.lastActiveDate, todayKey);
    assert.equal(result.history, null);

    assert.equal(result.medicines[0].name, "目薬A");
    assert.equal(result.medicines[0].color, "#0f9f78");
    assert.equal(result.medicines[0].extra, "keep-me");
    assert.equal(result.medicines[0].doses[0].id, "a-morning");
    assert.equal(result.medicines[0].doses[0].time, "08:00");
    assert.equal(result.medicines[0].doses[0].note, "keep-dose");
    assert.equal(result.medicines[0].doses[0].status, "upcoming");
    assert.equal("completedAt" in result.medicines[0].doses[0], false);
  });
});

describe("履歴表示", () => {
  it("今日は予定、過去日の未了は未使用と表示する", () => {
    const upcoming = {
      medicineName: "目薬B",
      label: "夜",
      time: "21:00",
      status: "upcoming",
    };
    const done = {
      medicineName: "目薬A",
      label: "朝",
      time: "08:00",
      status: "done",
      completedAt: "08:03",
    };
    assert.equal(formatHistoryStatus(done, { isToday: true }), "✓ 08:03");
    assert.equal(formatHistoryStatus(upcoming, { isToday: true }), "予定 21:00");
    assert.equal(formatHistoryStatus(upcoming, { isToday: false }), "未使用");
  });

  it("過去日キーは今日を除いて新しい順", () => {
    const keys = listPastHistoryKeys(
      {
        "2026-08-25": [],
        "2026-08-26": [],
        "2026-08-24": [],
      },
      "2026-08-26",
    );
    assert.deepEqual(keys, ["2026-08-25", "2026-08-24"]);
  });
});
