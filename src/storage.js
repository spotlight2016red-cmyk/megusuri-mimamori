export const STORAGE_KEY = "megusuri-medicines-v2";

export function loadMedicines(fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveMedicines(medicines) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines));
}
