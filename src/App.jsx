import { useEffect, useMemo, useRef, useState } from "react";
import { completeDose, undoDose } from "./completeDose.js";
import {
  addDose,
  cloneSeed,
  getNextOpenDose,
  listDoseEntries,
  removeDose,
  sortDoseEntries,
  updateDose,
  updateMedicine,
} from "./medicines.js";
import {
  formatHistoryStatus,
  historyEntriesFromMedicines,
  listPastHistoryKeys,
  loadHistory,
  loadLastActiveDate,
} from "./history.js";
import { loadMedicines, saveMedicines } from "./storage.js";
import {
  displayStatus,
  formatClock,
  formatDateHeading,
  getScheduledAt,
  parseDateKey,
  toDateKey,
} from "./time.js";
import {
  unlockSpeech,
  voiceReminderService,
} from "./voiceReminders.js";
import {
  loadUiSettings,
  saveUiSettings,
} from "./uiSettings.js";
import {
  PRODUCTION_REMINDER_INTERVAL_MINUTES,
  PRODUCTION_REMINDER_WINDOW_MINUTES,
  TEST_REMINDER_INTERVAL_MINUTES,
  TEST_REMINDER_WINDOW_MINUTES,
  isTestReminderPreset,
  loadVoiceSettings,
  productionReminderPreset,
  saveVoiceSettings,
  testReminderPreset,
} from "./voiceSettings.js";
import { isPastReminderWindow } from "./voiceReminderLogic.js";
import { loadAutoUpdateSettings } from "./autoUpdateSettings.js";
import { canSafelyAutoUpdate } from "./safeAutoUpdate.js";
import { startServiceWorkerUpdates } from "./swUpdate.js";
import {
  clearTestDateSettings,
  formatTestDateLabel,
  getCurrentDate,
  getCurrentDateKey,
  getDeviceDate,
  loadTestDateSettings,
  nextTestDateSettings,
  saveTestDateSettings,
} from "./testDate.js";
import {
  collectDaySyncDebugSnapshot,
  resetTodayAndResume,
  runDayBoundarySync,
} from "./daySync.js";

function bootMedicines() {
  return runDayBoundarySync({
    now: getCurrentDate(),
    source: "boot",
    reactMedicines: loadMedicines(cloneSeed()),
  }).medicines;
}

export default function App() {
  const [medicines, setMedicines] = useState(() => bootMedicines());
  const [history, setHistory] = useState(() => loadHistory());
  const [now, setNow] = useState(() => getCurrentDate());
  const [sheet, setSheet] = useState(null);
  const [pending, setPending] = useState(null);
  const [toast, setToast] = useState("");
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const [tabletNotify, setTabletNotify] = useState(true);
  const [alexaNotify, setAlexaNotify] = useState(true);
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings());
  const [uiSettings, setUiSettings] = useState(() => loadUiSettings());
  const [testDateSettings, setTestDateSettings] = useState(() =>
    loadTestDateSettings(),
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [confirmTodayReset, setConfirmTodayReset] = useState(false);
  const wakeLockRef = useRef(null);
  const installPromptRef = useRef(null);
  const medicinesRef = useRef(medicines);
  const voiceSettingsRef = useRef(voiceSettings);
  const pendingRef = useRef(pending);
  const autoUpdateSettingsRef = useRef(loadAutoUpdateSettings());
  const swUpdateRef = useRef(null);
  const suppressMedicinesPersistRef = useRef(false);
  const [dayDebugTick, setDayDebugTick] = useState(0);

  const syncDayBoundary = (source = "periodic") => {
    const result = runDayBoundarySync({
      now: getCurrentDate(),
      source,
      reactMedicines: medicinesRef.current,
    });

    // didRollover の有無に関わらず、常に LS 起点の結果を React へ反映する
    // （バックグラウンドで persist 済み・UI 未更新の取り残しを防ぐ）
    suppressMedicinesPersistRef.current = true;
    medicinesRef.current = result.medicines;
    setMedicines(result.medicines);
    setHistory(result.history);
    setNow(getCurrentDate());
    setDayDebugTick((value) => value + 1);

    if (result.didRollover || result.didMigrate) {
      voiceReminderService.resetAll();
    }
    return Boolean(result.didRollover || result.didMigrate);
  };

  useEffect(() => {
    const clockTimer = window.setInterval(() => setNow(getCurrentDate()), 1000);
    const dayTimer = window.setInterval(
      () => syncDayBoundary("periodic-60s"),
      60_000,
    );
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(dayTimer);
    };
  }, []);

  useEffect(() => {
    medicinesRef.current = medicines;
  }, [medicines]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
    saveVoiceSettings(voiceSettings);
  }, [voiceSettings]);

  useEffect(() => {
    saveUiSettings(uiSettings);
  }, [uiSettings]);

  useEffect(() => {
    if (suppressMedicinesPersistRef.current) {
      suppressMedicinesPersistRef.current = false;
      return;
    }
    saveMedicines(medicines);
  }, [medicines]);

  useEffect(() => {
    voiceReminderService.setGetters({
      getMedicines: () => medicinesRef.current,
      getSettings: () => voiceSettingsRef.current,
    });
    voiceReminderService.start();
    return () => voiceReminderService.stop();
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return undefined;
    }
    const controller = startServiceWorkerUpdates({
      onUpdateAvailable: () => setUpdateAvailable(true),
      canAutoApplyUpdate: () => {
        try {
          // 日付またぎ処理を先に済ませ、競合を避ける
          syncDayBoundary("sw-auto-update");
          return canSafelyAutoUpdate({
            now: getDeviceDate(),
            settings: autoUpdateSettingsRef.current,
            medicines: medicinesRef.current,
            pendingConfirmOpen: pendingRef.current != null,
            isSpeaking: voiceReminderService.isSpeaking(),
            lastActiveDate: loadLastActiveDate(),
          });
        } catch {
          return false;
        }
      },
    });
    swUpdateRef.current = controller;
    return () => {
      controller.stop();
      swUpdateRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      installPromptRef.current = event;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    const onPageshow = () => {
      syncDayBoundary("pageshow");
    };
    const onFocus = () => {
      syncDayBoundary("focus");
    };
    const onVisibility = async () => {
      if (document.visibilityState === "visible") {
        syncDayBoundary("visibilitychange");
      }
      if (document.visibilityState !== "visible" || !wakeLockOn) return;
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch {
        setWakeLockOn(false);
      }
    };
    window.addEventListener("pageshow", onPageshow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pageshow", onPageshow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [wakeLockOn]);

  const todayKey = toDateKey(now);
  const deviceNow = getDeviceDate();
  const dayDebug = useMemo(
    () =>
      collectDaySyncDebugSnapshot({
        medicines,
        now,
      }),
    [medicines, now, dayDebugTick],
  );
  const entries = useMemo(
    () => sortDoseEntries(listDoseEntries(medicines)),
    [medicines],
  );
  const todayHistoryEntries = useMemo(
    () => historyEntriesFromMedicines(medicines),
    [medicines],
  );
  const pastHistoryKeys = useMemo(
    () => listPastHistoryKeys(history, todayKey),
    [history, todayKey],
  );
  const doneCount = entries.filter(({ dose }) => dose.status === "done").length;
  const nextOpen = getNextOpenDose(medicines);
  const allDone = entries.length > 0 && doneCount === entries.length;

  const showToast = (message) => setToast(message);

  const applyTestDateAndSync = (nextSettings) => {
    const saved = saveTestDateSettings(nextSettings);
    setTestDateSettings(saved);
    const result = runDayBoundarySync({
      now: getCurrentDate(),
      source: "test-date",
      reactMedicines: medicinesRef.current,
    });
    suppressMedicinesPersistRef.current = true;
    medicinesRef.current = result.medicines;
    setMedicines(result.medicines);
    setHistory(result.history);
    setNow(getCurrentDate());
    setDayDebugTick((value) => value + 1);
    if (result.didRollover || result.didMigrate) {
      voiceReminderService.resetAll();
    }
    return result;
  };

  const handleToggleTestDate = (enabled) => {
    if (!enabled) {
      clearTestDateSettings();
      setTestDateSettings(loadTestDateSettings());
      syncDayBoundary("test-date-off");
      showToast("端末の日付に戻しました");
      return;
    }
    const dateKey =
      testDateSettings.dateKey || getCurrentDateKey(getDeviceDate());
    applyTestDateAndSync({ enabled: true, dateKey });
  };

  const handleTestDatePick = (dateKey) => {
    if (!dateKey) return;
    applyTestDateAndSync({ enabled: true, dateKey });
  };

  const handleAdvanceTestDate = () => {
    const result = applyTestDateAndSync(
      nextTestDateSettings(testDateSettings, getDeviceDate()),
    );
    if (result.didRollover) {
      showToast("1日進め、履歴を保存してリセットしました");
    } else {
      showToast(`テスト日付：${formatTestDateLabel(getCurrentDateKey())}`);
    }
  };

  const handleConfirmTodayReset = () => {
    const result = resetTodayAndResume({
      reactMedicines: medicinesRef.current,
      deviceNow: getDeviceDate(),
    });
    setTestDateSettings(loadTestDateSettings());
    suppressMedicinesPersistRef.current = true;
    medicinesRef.current = result.medicines;
    setMedicines(result.medicines);
    setHistory(result.history);
    setNow(getCurrentDate());
    setDayDebugTick((value) => value + 1);
    setConfirmTodayReset(false);
    setSheet(null);
    voiceReminderService.resetAll();
    showToast("今日の状態をリセットしました。通常運転を再開します。");
  };

  const requestComplete = (medicine, dose) => {
    setPending({ medicine, dose });
  };

  const confirmComplete = () => {
    if (!pending) return;
    const { medicine, dose } = pending;
    voiceReminderService.notifyCompleted(medicine.id, dose.id);
    setMedicines((current) => completeDose(current, medicine.id, dose.id));
    showToast(`${medicine.name}（${dose.label}）を使用済みにしました`);
    setPending(null);
  };

  const cancelComplete = () => setPending(null);

  const handleUndo = (medicine, dose) => {
    voiceReminderService.notifyUndone(medicine.id, dose.id);
    setMedicines((current) => undoDose(current, medicine.id, dose.id));
  };

  const handleSensorTrial = () => {
    const next = getNextOpenDose(medicines);
    if (!next) {
      showToast("未了の予定はありません");
      return;
    }
    requestComplete(next.medicine, next.dose);
  };

  const handleInstall = async () => {
    const promptEvent = installPromptRef.current;
    if (promptEvent) {
      promptEvent.prompt();
      installPromptRef.current = null;
      return;
    }
    showToast("ブラウザメニューから「ホーム画面に追加」を選んでください");
  };

  const handleApplyUpdate = async () => {
    const applied = await swUpdateRef.current?.applyUpdate?.();
    if (!applied) {
      showToast("更新の準備がまだ完了していません。少し待って再度お試しください");
    }
  };

  const toggleWakeLock = async () => {
    if (wakeLockOn) {
      await wakeLockRef.current?.release?.();
      wakeLockRef.current = null;
      setWakeLockOn(false);
      return;
    }
    if (!("wakeLock" in navigator)) {
      showToast("このブラウザは画面の常時表示に対応していません");
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      wakeLockRef.current.addEventListener("release", () => {
        setWakeLockOn(false);
        wakeLockRef.current = null;
      });
      setWakeLockOn(true);
      unlockSpeech();
    } catch {
      showToast("画面の常時表示を開始できませんでした");
    }
  };

  const resetPrototype = () => {
    voiceReminderService.resetAll();
    setMedicines(cloneSeed());
    setHistory(loadHistory());
    showToast("試作データを初期状態に戻しました");
    setSheet(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">●</span>
          <div>
            <strong>目薬みまもり</strong>
            <small>家族共有モード</small>
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="設定を開く"
          onClick={() => setSheet("settings")}
        >
          ⚙
        </button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">今日の点眼</p>
          <h1>{formatDateHeading(now)}</h1>
          <p className="clock">{formatClock(deviceNow)}</p>
        </div>
        <div className={`summary ${allDone ? "complete" : ""}`}>
          <span className="summary-icon">{allDone ? "✓" : "◷"}</span>
          <div>
            <strong>
              {doneCount} / {entries.length} 回 完了
            </strong>
            <small>
              {allDone
                ? "本日の点眼は完了しました"
                : nextOpen
                  ? `次は ${nextOpen.dose.time}・${nextOpen.medicine.name}（${nextOpen.dose.label}）`
                  : "予定はありません"}
            </small>
          </div>
        </div>
      </section>

      {updateAvailable && (
        <section className="update-banner" role="status">
          <div>
            <strong>新しいバージョンがあります</strong>
            <small>最新版に更新できます。点眼データはそのまま残ります</small>
          </div>
          <button type="button" onClick={handleApplyUpdate}>
            更新する
          </button>
        </section>
      )}

      {uiSettings.showInstallBanner && (
        <section className="android-banner">
          <div className="android-icon">▣</div>
          <div>
            <strong>Androidタブレットに設置</strong>
            <small>ホーム画面から全画面で起動できます</small>
          </div>
          <button type="button" onClick={handleInstall}>
            アプリとして追加
          </button>
          <button
            type="button"
            className="banner-dismiss"
            aria-label="設置の案内を閉じる"
            onClick={() =>
              setUiSettings((current) => ({
                ...current,
                showInstallBanner: false,
              }))
            }
          >
            ×
          </button>
        </section>
      )}

      <section className="cards" aria-label="今日の目薬一覧">
        {medicines.map((medicine) => {
          const statuses = medicine.doses.map((dose) =>
            displayStatus(dose, now),
          );
          const cardState = statuses.every((status) => status === "done")
            ? "done"
            : statuses.includes("late")
              ? "late"
              : "";
          const badgeState = statuses.every((status) => status === "done")
            ? "done"
            : statuses.includes("late")
              ? "late"
              : "upcoming";

          return (
            <article
              key={medicine.id}
              className={`drop-card medicine-card ${cardState}`}
              style={{ "--medicine-color": medicine.color }}
            >
              <div className="medicine-visual">
                <div className="bottle-cap" />
                <div className="bottle">
                  <span>{medicine.shortName}</span>
                </div>
              </div>
              <div className="drop-info">
                <span className={`badge ${badgeState}`}>
                  1日 {medicine.doses.length}回
                </span>
                <h2>{medicine.name}</h2>
                <p className="medicine-times">
                  {[...medicine.doses]
                    .sort((a, b) => a.time.localeCompare(b.time))
                    .map((dose) => `${dose.label} ${dose.time}`)
                    .join("・")}
                </p>
              </div>
              <div className="dose-list">
                {[...medicine.doses]
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((dose) => {
                    const status = displayStatus(dose, now);
                    const pastWindow =
                      status !== "done" &&
                      isPastReminderWindow(
                        getScheduledAt(dose.time, now).getTime(),
                        now.getTime(),
                        voiceSettings.reminderWindowMinutes,
                      );
                    return (
                      <div key={dose.id} className={`dose-row ${status}`}>
                        <div className="dose-status">
                          {status === "done" ? "✓" : "◷"}
                        </div>
                        <div className="dose-label">
                          <strong>{dose.label}</strong>
                          <span>{dose.time}</span>
                        </div>
                        <div className="dose-result">
                          {status === "done" ? (
                            <>
                              <strong>使用済み</strong>
                              <small>{dose.completedAt}に確認</small>
                            </>
                          ) : pastWindow ? (
                            <>
                              <strong>未使用</strong>
                              <small>
                                予定時刻から
                                {voiceSettings.reminderWindowMinutes}
                                分以上経過
                              </small>
                            </>
                          ) : (
                            <>
                              <strong>
                                {status === "late" ? "未使用" : "予定あり"}
                              </strong>
                              <small>まだ使用していません</small>
                            </>
                          )}
                        </div>
                        {status === "done" ? (
                          <button
                            type="button"
                            className="mini-action"
                            onClick={() => handleUndo(medicine, dose)}
                          >
                            取り消す
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mini-action primary"
                            onClick={() => requestComplete(medicine, dose)}
                          >
                            使用済みにする
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </article>
          );
        })}
      </section>

      <section className="sensor-panel">
        <div className="sensor-dot">
          <span />
        </div>
        <div>
          <strong>冷蔵庫センサー</strong>
          <small>試作モード・接続待ち</small>
        </div>
        <div className="sensor-actions">
          <button type="button" onClick={handleSensorTrial}>
            次の取り出し検知を試す
          </button>
          <span>A・Bを個別に認識</span>
        </div>
      </section>

      <section className="tablet-panel">
        <div>
          <strong>タブレット常設モード</strong>
          <small>
            共有場所で画面を見やすい状態に保ちます。音声通知は画面表示中のみ動作します
          </small>
        </div>
        <button
          type="button"
          className={wakeLockOn ? "on" : ""}
          onClick={toggleWakeLock}
        >
          画面を常時表示
        </button>
      </section>

      <nav className="bottom-nav">
        <button
          type="button"
          className={sheet === null ? "active" : ""}
          onClick={() => setSheet(null)}
        >
          <span>⌂</span>
          今日
        </button>
        <button
          type="button"
          className={sheet === "history" ? "active" : ""}
          onClick={() => setSheet("history")}
        >
          <span>↺</span>
          履歴
        </button>
        <button
          type="button"
          className={sheet === "settings" ? "active" : ""}
          onClick={() => setSheet("settings")}
        >
          <span>⚙</span>
          設定
        </button>
      </nav>

      {sheet === "history" && (
        <div className="modal-backdrop" onClick={() => setSheet(null)}>
          <div
            className="modal sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="close"
              aria-label="閉じる"
              onClick={() => setSheet(null)}
            >
              ×
            </button>
            <p className="eyebrow">使用履歴</p>
            <h2>日付別の記録</h2>
            <div className="history-list">
              <section className="history-day-block">
                <h3>{formatDateHeading(now)}</h3>
                {todayHistoryEntries.map((entry) => (
                  <div
                    key={`today-${entry.medicineId}-${entry.doseId}`}
                    className="history-entry"
                  >
                    <strong>
                      {entry.medicineName} {entry.label}
                    </strong>
                    <span
                      className={
                        entry.status === "done" ? "all-done" : "pending-label"
                      }
                    >
                      {formatHistoryStatus(entry, { isToday: true })}
                    </span>
                  </div>
                ))}
              </section>
              {pastHistoryKeys.map((dateKey) => (
                <section key={dateKey} className="history-day-block">
                  <h3>{formatDateHeading(parseDateKey(dateKey))}</h3>
                  {(history[dateKey] ?? []).map((entry) => (
                    <div
                      key={`${dateKey}-${entry.medicineId}-${entry.doseId}`}
                      className="history-entry"
                    >
                      <strong>
                        {entry.medicineName} {entry.label}
                      </strong>
                      <span
                        className={
                          entry.status === "done" ? "all-done" : "unused-label"
                        }
                      >
                        {formatHistoryStatus(entry, { isToday: false })}
                      </span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet === "settings" && (
        <div className="modal-backdrop" onClick={() => setSheet(null)}>
          <div
            className="modal sheet settings-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="close"
              aria-label="閉じる"
              onClick={() => setSheet(null)}
            >
              ×
            </button>
            <p className="eyebrow">設定</p>
            <h2>目薬と使用時刻</h2>
            <p className="settings-help">
              目薬ごとに、1日の使用回数を自由に追加できます。
            </p>
            {medicines.map((medicine) => (
              <div key={medicine.id} className="medicine-setting">
                <div className="medicine-name-row">
                  <b style={{ background: medicine.color }}>
                    {medicine.shortName}
                  </b>
                  <input
                    aria-label={medicine.name}
                    value={medicine.name}
                    onChange={(event) =>
                      setMedicines((current) =>
                        updateMedicine(current, medicine.id, {
                          name: event.target.value,
                        }),
                      )
                    }
                  />
                  <span>1日 {medicine.doses.length}回</span>
                </div>
                {medicine.doses.map((dose) => (
                  <div key={dose.id} className="dose-setting">
                    <input
                      aria-label="時間帯"
                      value={dose.label}
                      onChange={(event) =>
                        setMedicines((current) =>
                          updateDose(current, medicine.id, dose.id, {
                            label: event.target.value,
                          }),
                        )
                      }
                    />
                    <input
                      aria-label="時刻"
                      type="time"
                      value={dose.time}
                      onChange={(event) => {
                        voiceReminderService.notifyUndone(medicine.id, dose.id);
                        setMedicines((current) =>
                          updateDose(current, medicine.id, dose.id, {
                            time: event.target.value,
                          }),
                        );
                      }}
                    />
                    {medicine.doses.length > 1 && (
                      <button
                        type="button"
                        aria-label="この時刻を削除"
                        onClick={() => {
                          voiceReminderService.notifyCompleted(
                            medicine.id,
                            dose.id,
                          );
                          setMedicines((current) =>
                            removeDose(current, medicine.id, dose.id),
                          );
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="add-dose"
                  onClick={() =>
                    setMedicines((current) => addDose(current, medicine.id))
                  }
                >
                  ＋ 使用時刻を追加
                </button>
              </div>
            ))}
            <label className="toggle-row">
              <span>
                <strong>設置の案内</strong>
                <small>Androidタブレットに設置バナーを表示します。オフにすると画面が広がります</small>
              </span>
              <input
                type="checkbox"
                checked={uiSettings.showInstallBanner}
                onChange={(event) =>
                  setUiSettings((current) => ({
                    ...current,
                    showInstallBanner: event.target.checked,
                  }))
                }
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>タブレット通知</strong>
                <small>各予定時刻から15分後</small>
              </span>
              <input
                type="checkbox"
                checked={tabletNotify}
                onChange={(event) => setTabletNotify(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Alexa通知</strong>
                <small>各予定時刻から30分後</small>
              </span>
              <input
                type="checkbox"
                checked={alexaNotify}
                onChange={(event) => setAlexaNotify(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>音声再通知</strong>
                <small>画面を付けたまま、未点眼ならタブレットが読み上げます</small>
              </span>
              <input
                type="checkbox"
                checked={voiceSettings.enabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  if (enabled) unlockSpeech();
                  setVoiceSettings((current) => ({ ...current, enabled }));
                }}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>再通知スケジュール</strong>
                <small>
                  本番は{PRODUCTION_REMINDER_INTERVAL_MINUTES}分間隔・
                  {PRODUCTION_REMINDER_WINDOW_MINUTES}
                  分で終了。確認時はテスト（
                  {TEST_REMINDER_INTERVAL_MINUTES}分 /{" "}
                  {TEST_REMINDER_WINDOW_MINUTES}分）を選べます
                </small>
              </span>
              <select
                className="interval-select"
                aria-label="再通知スケジュール"
                value={isTestReminderPreset(voiceSettings) ? "test" : "production"}
                onChange={(event) => {
                  const preset =
                    event.target.value === "test"
                      ? testReminderPreset()
                      : productionReminderPreset();
                  setVoiceSettings((current) => ({
                    ...current,
                    ...preset,
                  }));
                }}
              >
                <option value="production">
                  運用 {PRODUCTION_REMINDER_INTERVAL_MINUTES}分 /{" "}
                  {PRODUCTION_REMINDER_WINDOW_MINUTES}分
                </option>
                <option value="test">
                  テスト {TEST_REMINDER_INTERVAL_MINUTES}分 /{" "}
                  {TEST_REMINDER_WINDOW_MINUTES}分
                </option>
              </select>
            </label>
            <button
              type="button"
              className="secondary-action large"
              onClick={() => {
                unlockSpeech();
                voiceReminderService.speakTest();
              }}
            >
              音声テスト
            </button>
            <button
              type="button"
              className="primary-action large"
              onClick={() => {
                setSheet(null);
                showToast("設定を保存しました");
              }}
            >
              設定を保存
            </button>
            <button
              type="button"
              className="text-action"
              onClick={resetPrototype}
            >
              試作データを初期状態に戻す
            </button>

            <section className="dev-test-section">
              <p className="eyebrow">開発・テスト</p>
              <h3>テスト日付</h3>
              <p className="settings-help">
                通常運用では端末の実日時を使います。日次リセットと履歴の確認専用です。音声・自動更新の時刻は端末時計のままです。
              </p>
              {testDateSettings.enabled && testDateSettings.dateKey && (
                <p className="test-date-banner" role="status">
                  テスト日付使用中：
                  {formatTestDateLabel(testDateSettings.dateKey)}
                </p>
              )}
              <label className="toggle-row">
                <span>
                  <strong>テスト日付を使用</strong>
                  <small>ONにすると日付判定だけ差し替えます</small>
                </span>
                <input
                  type="checkbox"
                  checked={testDateSettings.enabled}
                  onChange={(event) =>
                    handleToggleTestDate(event.target.checked)
                  }
                />
              </label>
              <label className="test-date-picker">
                <span>日付選択</span>
                <input
                  type="date"
                  aria-label="テスト日付"
                  value={
                    testDateSettings.dateKey ||
                    getCurrentDateKey(getDeviceDate())
                  }
                  onChange={(event) => handleTestDatePick(event.target.value)}
                />
              </label>
              <div className="dev-test-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={handleAdvanceTestDate}
                >
                  ＋1日進める
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => handleToggleTestDate(false)}
                >
                  端末の日付に戻す
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => syncDayBoundary("debug-manual")}
                >
                  日次チェックを今すぐ実行
                </button>
                <button
                  type="button"
                  className="secondary-action danger-action"
                  onClick={() => setConfirmTodayReset(true)}
                >
                  今日の状態をリセットして再開
                </button>
              </div>

              <div className="day-debug-panel">
                <h3>日次デバッグ</h3>
                <p className="settings-help">
                  実機の日跨ぎ調査用です。テスト日付OFF時も raw 値を確認できます。
                </p>
                <dl className="day-debug-list">
                  <div>
                    <dt>getDeviceDate()</dt>
                    <dd>{dayDebug.deviceDateKey}</dd>
                  </div>
                  <div>
                    <dt>getCurrentDateKey()</dt>
                    <dd>{dayDebug.currentDateKey}</dd>
                  </div>
                  <div>
                    <dt>megusuri-last-active-date</dt>
                    <dd>{dayDebug.lastActiveDate ?? "(null)"}</dd>
                  </div>
                  <div>
                    <dt>megusuri-test-date-v1</dt>
                    <dd>
                      enabled={String(dayDebug.testDateSettings.enabled)} /{" "}
                      dateKey={dayDebug.testDateSettings.dateKey ?? "(null)"}
                      <br />
                      raw={dayDebug.testDateRaw ?? "(null)"}
                      <br />
                      日付判定へ影響=
                      {dayDebug.testDateAffectsClock ? "YES" : "NO"}
                    </dd>
                  </div>
                  <div>
                    <dt>megusuri-daily-reset-migrated-v1</dt>
                    <dd>
                      {dayDebug.dailyResetMigrated ? "1" : "0"} (raw=
                      {dayDebug.dailyResetMigratedRaw ?? "(null)"})
                    </dd>
                  </div>
                  <div>
                    <dt>日次チェック最終実行</dt>
                    <dd>
                      {dayDebug.lastCheckAt ?? "(未実行)"}
                      <br />
                      source={dayDebug.lastCheckSource ?? "-"} / didRollover=
                      {String(dayDebug.lastCheckDidRollover)} / didMigrate=
                      {String(dayDebug.lastCheckDidMigrate)}
                    </dd>
                  </div>
                  <div>
                    <dt>最後に日次リセットした日付</dt>
                    <dd>{dayDebug.lastRolloverDateKey ?? "(なし)"}</dd>
                  </div>
                </dl>
                <p className="day-debug-doses-title">各dose status</p>
                <ul className="day-debug-doses">
                  {dayDebug.doses.map((dose) => (
                    <li key={`${dose.medicineId}-${dose.doseId}`}>
                      {dose.medicineName} {dose.label} {dose.time}:{" "}
                      <strong>{dose.status}</strong>
                      {dose.completedAt ? ` (${dose.completedAt})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      )}

      {pending && (
        <div className="modal-backdrop" onClick={cancelComplete}>
          <div
            className="modal confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-icon">✓</div>
            <h2>
              {pending.medicine.name} の {pending.dose.label}{" "}
              の分を使用しましたか？
            </h2>
            <p>
              この回だけを使用済みにします。 ほかの時間の予定はそのまま残ります。
            </p>
            <button
              type="button"
              className="primary-action large"
              onClick={confirmComplete}
            >
              はい、使用しました
            </button>
            <button
              type="button"
              className="secondary-action large"
              onClick={cancelComplete}
            >
              まだ使用していません
            </button>
          </div>
        </div>
      )}

      {confirmTodayReset && (
        <div
          className="modal-backdrop"
          onClick={() => setConfirmTodayReset(false)}
        >
          <div
            className="modal confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>今日の点眼状態をリセットしますか？</h2>
            <p>
              本日の「使用済み」状態はすべて未使用に戻ります。
              過去の履歴と目薬の設定は削除されません。
            </p>
            <button
              type="button"
              className="primary-action large"
              onClick={handleConfirmTodayReset}
            >
              リセットして再開
            </button>
            <button
              type="button"
              className="secondary-action large"
              onClick={() => setConfirmTodayReset(false)}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
