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
import { loadMedicines, saveMedicines } from "./storage.js";
import { displayStatus, formatClock, formatDateHeading } from "./time.js";
import {
  unlockSpeech,
  voiceReminderService,
} from "./voiceReminders.js";
import {
  PRODUCTION_REMINDER_INTERVAL_MINUTES,
  TEST_REMINDER_INTERVAL_MINUTES,
  loadVoiceSettings,
  saveVoiceSettings,
} from "./voiceSettings.js";

export default function App() {
  const [medicines, setMedicines] = useState(() => loadMedicines(cloneSeed()));
  const [now, setNow] = useState(() => new Date());
  const [sheet, setSheet] = useState(null);
  const [pending, setPending] = useState(null);
  const [toast, setToast] = useState("");
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const [tabletNotify, setTabletNotify] = useState(true);
  const [alexaNotify, setAlexaNotify] = useState(true);
  const [voiceSettings, setVoiceSettings] = useState(() => loadVoiceSettings());
  const wakeLockRef = useRef(null);
  const installPromptRef = useRef(null);
  const medicinesRef = useRef(medicines);
  const voiceSettingsRef = useRef(voiceSettings);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    medicinesRef.current = medicines;
  }, [medicines]);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
    saveVoiceSettings(voiceSettings);
  }, [voiceSettings]);

  useEffect(() => {
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
    const onVisibility = async () => {
      if (document.visibilityState !== "visible" || !wakeLockOn) return;
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      } catch {
        setWakeLockOn(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wakeLockOn]);

  const entries = useMemo(
    () => sortDoseEntries(listDoseEntries(medicines)),
    [medicines],
  );
  const doneCount = entries.filter(({ dose }) => dose.status === "done").length;
  const nextOpen = getNextOpenDose(medicines);
  const allDone = entries.length > 0 && doneCount === entries.length;

  const showToast = (message) => setToast(message);

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
          <p className="clock">{formatClock(now)}</p>
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

      <section className="android-banner">
        <div className="android-icon">▣</div>
        <div>
          <strong>Androidタブレットに設置</strong>
          <small>ホーム画面から全画面で起動できます</small>
        </div>
        <button type="button" onClick={handleInstall}>
          アプリとして追加
        </button>
      </section>

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
                          ) : (
                            <>
                              <strong>予定あり</strong>
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
            <h2>今日の記録</h2>
            <div className="history-list">
              {entries.map(({ medicine, dose }) => (
                <div key={dose.id} className="history-day compact">
                  <strong>
                    {medicine.name}・{dose.label}
                  </strong>
                  {dose.status === "done" ? (
                    <span className="all-done">✓ {dose.completedAt}</span>
                  ) : (
                    <span className="pending-label">予定 {dose.time}</span>
                  )}
                </div>
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
                <strong>再通知間隔</strong>
                <small>確認中は1分。運用時は10分に戻してください</small>
              </span>
              <select
                className="interval-select"
                aria-label="再通知間隔"
                value={voiceSettings.reminderIntervalMinutes}
                onChange={(event) =>
                  setVoiceSettings((current) => ({
                    ...current,
                    reminderIntervalMinutes: Number(event.target.value),
                  }))
                }
              >
                <option value={TEST_REMINDER_INTERVAL_MINUTES}>1分</option>
                <option value={PRODUCTION_REMINDER_INTERVAL_MINUTES}>
                  10分
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

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
