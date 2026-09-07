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
 * Service Worker の登録・更新検知・手動/安全帯自動切替を管理する。
 * localStorage には一切触れない（データ保持は呼び出し側の責務）。
 */
export function startServiceWorkerUpdates({
  onUpdateAvailable,
  canAutoApplyUpdate,
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
  let reloadRequested = false;
  let announced = false;
  let intervalId = null;
  let autoApplyInFlight = false;

  const announce = () => {
    if (announced) return;
    announced = true;
    try {
      onUpdateAvailable?.();
    } catch {
      // バナー表示失敗は無視
    }
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
        void maybeAutoApply();
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
      void maybeAutoApply();
    }
    reg.addEventListener("updatefound", () => {
      watchInstalling(reg.installing);
    });
  };

  const checkForUpdate = async ({ tryAuto = true } = {}) => {
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
        if (tryAuto) await maybeAutoApply();
      }
    } catch {
      // オフライン等では無視（翌日利用に影響させない）
    }
  };

  const applyUpdate = async () => {
    try {
      if (!registration?.waiting) {
        await checkForUpdate({ tryAuto: false });
      }
      if (!registration?.waiting) return false;
      reloadRequested = true;
      registration.waiting.postMessage(SKIP_WAITING_MESSAGE);
      return true;
    } catch {
      reloadRequested = false;
      return false;
    }
  };

  const maybeAutoApply = async () => {
    if (autoApplyInFlight || reloadRequested) return false;
    try {
      if (!registration?.waiting) return false;
      if (typeof canAutoApplyUpdate === "function") {
        let allowed = false;
        try {
          allowed = Boolean(canAutoApplyUpdate());
        } catch {
          return false;
        }
        if (!allowed) return false;
      } else {
        return false;
      }
      autoApplyInFlight = true;
      return await applyUpdate();
    } catch {
      return false;
    } finally {
      autoApplyInFlight = false;
    }
  };

  const onControllerChange = () => {
    if (!reloadRequested) return;
    try {
      window.location.reload();
    } catch {
      // reload 失敗でも通常利用は継続
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void checkForUpdate();
    }
  };

  const onPageshow = () => {
    void checkForUpdate();
  };

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange,
  );
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageshow);

  void checkForUpdate();
  intervalId = window.setInterval(() => {
    void checkForUpdate();
  }, checkIntervalMs);

  return {
    checkForUpdate,
    applyUpdate,
    maybeAutoApply,
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
