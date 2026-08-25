const completedAtFormat = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatCompletedAt(date = new Date()) {
  return completedAtFormat.format(date);
}

/**
 * Shared completion path for the "使用済みにする" button and future
 * weight-sensor events. Preserves unknown fields on the medicine/dose objects.
 */
export function completeDose(medicines, medicineId, doseId, now = new Date()) {
  return medicines.map((medicine) => {
    if (medicine.id !== medicineId) return medicine;
    return {
      ...medicine,
      doses: medicine.doses.map((dose) => {
        if (dose.id !== doseId) return dose;
        return {
          ...dose,
          status: "done",
          completedAt: formatCompletedAt(now),
        };
      }),
    };
  });
}

export function undoDose(medicines, medicineId, doseId) {
  return medicines.map((medicine) => {
    if (medicine.id !== medicineId) return medicine;
    return {
      ...medicine,
      doses: medicine.doses.map((dose) => {
        if (dose.id !== doseId) return dose;
        const next = { ...dose, status: "upcoming" };
        delete next.completedAt;
        return next;
      }),
    };
  });
}
