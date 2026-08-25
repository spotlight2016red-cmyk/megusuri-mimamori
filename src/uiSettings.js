export const UI_SETTINGS_KEY = "megusuri-ui-settings-v1";

export const DEFAULT_UI_SETTINGS = {
  showInstallBanner: true,
};

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function loadUiSettings() {
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_UI_SETTINGS,
        showInstallBanner: !isStandaloneApp(),
      };
    }
    const parsed = JSON.parse(raw);
    return {
      showInstallBanner: parsed.showInstallBanner !== false,
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

export function saveUiSettings(settings) {
  window.localStorage.setItem(
    UI_SETTINGS_KEY,
    JSON.stringify({
      showInstallBanner: Boolean(settings.showInstallBanner),
    }),
  );
}
