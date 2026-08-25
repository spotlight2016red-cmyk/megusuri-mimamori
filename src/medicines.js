export const SEED_MEDICINES = [
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
        completedAt: "07:52",
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

export function cloneSeed() {
  return JSON.parse(JSON.stringify(SEED_MEDICINES));
}

export function listDoseEntries(medicines) {
  return medicines.flatMap((medicine) =>
    medicine.doses.map((dose) => ({ medicine, dose })),
  );
}

export function sortDoseEntries(entries) {
  return [...entries].sort((a, b) => a.dose.time.localeCompare(b.dose.time));
}

export function updateDose(medicines, medicineId, doseId, patch) {
  return medicines.map((medicine) => {
    if (medicine.id !== medicineId) return medicine;
    return {
      ...medicine,
      doses: medicine.doses.map((dose) =>
        dose.id === doseId ? { ...dose, ...patch } : dose,
      ),
    };
  });
}

export function updateMedicine(medicines, medicineId, patch) {
  return medicines.map((medicine) =>
    medicine.id === medicineId ? { ...medicine, ...patch } : medicine,
  );
}

export function addDose(medicines, medicineId) {
  return medicines.map((medicine) => {
    if (medicine.id !== medicineId) return medicine;
    return {
      ...medicine,
      doses: [
        ...medicine.doses,
        {
          id: `${medicine.id}-${Date.now()}`,
          label: "追加",
          time: "12:00",
          status: "upcoming",
        },
      ],
    };
  });
}

export function removeDose(medicines, medicineId, doseId) {
  return medicines.map((medicine) => {
    if (medicine.id !== medicineId) return medicine;
    if (medicine.doses.length <= 1) return medicine;
    return {
      ...medicine,
      doses: medicine.doses.filter((dose) => dose.id !== doseId),
    };
  });
}

export function getNextOpenDose(medicines) {
  return (
    sortDoseEntries(listDoseEntries(medicines)).find(
      ({ dose }) => dose.status !== "done",
    ) ?? null
  );
}
