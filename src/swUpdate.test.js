import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKIP_WAITING_MESSAGE,
  shouldAnnounceInstalledWorker,
  shouldAnnounceWaitingWorker,
} from "./swUpdate.js";

describe("swUpdate helpers", () => {
  it("SKIP_WAITING メッセージ形式を保つ", () => {
    assert.deepEqual(SKIP_WAITING_MESSAGE, { type: "SKIP_WAITING" });
  });

  it("controller があるときだけ waiting を案内する", () => {
    assert.equal(
      shouldAnnounceWaitingWorker({ waiting: {} }, true),
      true,
    );
    assert.equal(
      shouldAnnounceWaitingWorker({ waiting: {} }, false),
      false,
    );
    assert.equal(shouldAnnounceWaitingWorker({}, true), false);
  });

  it("installed かつ controller があるときだけ案内する", () => {
    assert.equal(shouldAnnounceInstalledWorker("installed", true), true);
    assert.equal(shouldAnnounceInstalledWorker("installed", false), false);
    assert.equal(shouldAnnounceInstalledWorker("installing", true), false);
  });
});
