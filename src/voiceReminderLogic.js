/**
 * 音声再通知の純ロジック（DOM / speechSynthesis 非依存）。
 */

export function duePhrase(medicineName, doseLabel) {
  return `${medicineName}、${doseLabel}の点眼時間です`;
}

export function reminderPhrase(medicineName, doseLabel) {
  return `${medicineName}、${doseLabel}の点眼がまだ完了していません`;
}

export function finalReminderPhrase(medicineName, doseLabel) {
  return `${medicineName}、${doseLabel}の点眼がまだ確認できていません。確認してください`;
}

/**
 * 通知オフセット（分）。例: 10/30 → [0, 10, 20, 30]
 */
export function listReminderOffsetsMinutes(
  intervalMinutes = 10,
  windowMinutes = 30,
) {
  const interval = Math.max(1, Math.trunc(Number(intervalMinutes) || 1));
  const window = Math.max(interval, Math.trunc(Number(windowMinutes) || interval));
  const offsets = [0];
  for (let t = interval; t <= window; t += interval) {
    offsets.push(t);
  }
  if (offsets[offsets.length - 1] !== window) {
    offsets.push(window);
  }
  return offsets;
}

export function reminderKindForOffset(offsetMinutes, windowMinutes) {
  if (offsetMinutes <= 0) return "due";
  if (offsetMinutes >= windowMinutes) return "final";
  return "reminder";
}

export function phraseForReminderKind(kind, medicineName, doseLabel) {
  if (kind === "due") return duePhrase(medicineName, doseLabel);
  if (kind === "final") return finalReminderPhrase(medicineName, doseLabel);
  return reminderPhrase(medicineName, doseLabel);
}

export function isPastReminderWindow(
  scheduledMs,
  nowMs,
  windowMinutes,
) {
  const window = Math.max(0, Number(windowMinutes) || 0);
  return nowMs >= scheduledMs + window * 60 * 1000;
}

/**
 * 1 dose について、この瞬間に発火すべき通知を決める。
 * spokenOffsets: すでに発火済みのオフセット（分）の集合。
 */
export function planDoseReminder({
  nowMs,
  scheduledMs,
  spokenOffsets = [],
  intervalMinutes,
  windowMinutes,
  catchUpPastSlots = false,
}) {
  const offsets = listReminderOffsetsMinutes(intervalMinutes, windowMinutes);
  const spoken = new Set(
    [...spokenOffsets].map((value) => Number(value)).filter(Number.isFinite),
  );
  const windowEndMs = scheduledMs + offsets[offsets.length - 1] * 60 * 1000;

  if (nowMs < scheduledMs) {
    return {
      action: "wait",
      kind: null,
      offset: null,
      spokenOffsets: spoken,
      exhausted: false,
      offsets,
    };
  }

  // ページ再表示などで過去枠を二重発火しない
  if (catchUpPastSlots) {
    for (const offset of offsets) {
      const fireAt = scheduledMs + offset * 60 * 1000;
      if (nowMs > fireAt) spoken.add(offset);
    }
  }

  for (const offset of offsets) {
    const fireAt = scheduledMs + offset * 60 * 1000;
    if (nowMs < fireAt) {
      return {
        action: "wait",
        kind: null,
        offset: null,
        spokenOffsets: spoken,
        exhausted: false,
        offsets,
      };
    }
    if (spoken.has(offset)) continue;

    const kind = reminderKindForOffset(offset, offsets[offsets.length - 1]);
    const nextSpoken = new Set(spoken);
    nextSpoken.add(offset);
    return {
      action: "speak",
      kind,
      offset,
      spokenOffsets: nextSpoken,
      exhausted: false,
      offsets,
    };
  }

  return {
    action: nowMs >= windowEndMs ? "exhausted" : "wait",
    kind: null,
    offset: null,
    spokenOffsets: spoken,
    exhausted: nowMs >= windowEndMs,
    offsets,
  };
}

/**
 * tracker 新規作成時: すでに過ぎた枠は発火済み扱いにする（現在ちょうど到達した枠は残す）。
 */
export function initialSpokenOffsets(nowMs, scheduledMs, offsets) {
  const spoken = new Set();
  for (const offset of offsets) {
    const fireAt = scheduledMs + offset * 60 * 1000;
    if (nowMs > fireAt) spoken.add(offset);
  }
  return spoken;
}
