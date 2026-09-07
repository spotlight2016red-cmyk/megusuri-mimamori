export const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" };
export const UPDATE_CHECK_INTERVAL_MS = 60_000;

/**
 * 新しい waiting worker があるかを判定する。
 * 初回インストール（controller 無し）ではバナーを出さない。
 */
export function shouldAnnounceWaitingWorker(registration, hasController) {
  return Boolean(registration?.waiting) && Boolean(hasController);
}

export function shouldAnnounceInstalledWorker(workerState, hasController) {
  return workerState === "installed" && Boolean(hasController);
}

/**
 * Service Worker の登録・更新検知・ユーザー操作での切替を管理する。
 * localStorage には一切触れない。
 */
export function startServiceWorkerUpdates({
  onUpdateAvailable,
  register = (url) => navigator.serviceWorker.register(url),
  swUrl = "/sw.js",
  checkIntervalMs = UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  if (!("serviceWorker" in navigator)) {
    return {
      checkForUpdate: async () => {},
      applyUpdate: async () => false,
      stop: () => {},
    };
  }

  let registration = null;
  let userRequestedUpdate = false;
  let announced = false;
  let intervalId = null;

  const announce = () => {
    if (announced) return;
    announced = true;
    onUpdateAvailable?.();
  };

  const watchInstalling = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (
        shouldAnnounceInstalledWorker(
          worker.state,
          Boolean(navigator.serviceWorker.controller),
        )
      ) {
        announce();
      }
    });
  };

  const bindRegistration = (reg) => {
    registration = reg;
    if (
      shouldAnnounceWaitingWorker(
        reg,
        Boolean(navigator.serviceWorker.controller),
      )
    ) {
      announce();
    }
    reg.addEventListener("updatefound", () => {
      watchInstalling(reg.installing);
    });
  };

  const checkForUpdate = async () => {
    try {
      if (!registration) {
        const reg = await register(swUrl);
        bindRegistration(reg);
      }
      await registration?.update?.();
      if (
        shouldAnnounceWaitingWorker(
          registration,
          Boolean(navigator.serviceWorker.controller),
        )
      ) {
        announce();
      }
    } catch {
      // オフライン等では無視
    }
  };

  const applyUpdate = async () => {
    if (!registration?.waiting) {
      await checkForUpdate();
    }
    if (!registration?.waiting) return false;
    userRequestedUpdate = true;
    registration.waiting.postMessage(SKIP_WAITING_MESSAGE);
    return true;
  };

  const onControllerChange = () => {
    if (!userRequestedUpdate) return;
    window.location.reload();
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      checkForUpdate();
    }
  };

  const onPageshow = () => {
    checkForUpdate();
  };

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange,
  );
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageshow);

  checkForUpdate();
  intervalId = window.setInterval(() => {
    checkForUpdate();
  }, checkIntervalMs);

  return {
    checkForUpdate,
    applyUpdate,
    stop() {
      if (intervalId != null) window.clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageshow);
    },
  };
}
