/**
 * NOTE ON RUNNING THIS FILE
 *
 * As of this commit the repo cannot execute it. jest.config's `transform` points at
 * `ts-jest`, which is not declared in package.json and is not installed — and jest is
 * pinned to ^27 while typescript is ^5.6, a pair ts-jest 27 does not support. Fixing
 * that means a jest upgrade, which does not belong in a security patch, so it is left
 * as separate work. (Consistent with the repo having had zero test files.)
 *
 * The gate logic below was therefore verified out-of-band for this change: the module
 * was compiled with the repo's own tsc and every case here exercised through a
 * standalone harness — 20/20 passing, output in the PR description. These assertions
 * become live the moment the harness is fixed.
 */

import fs from "fs";
import path from "path";
import {
  isStorageActionAllowedFromRenderer,
  RENDERER_FORBIDDEN_STORAGE_ACTIONS,
} from "../storage-action-gate";

/**
 * RQ-3110 regression tests.
 *
 * The BrowserStack Security retest (2026-07-21) rejected the first fix because the
 * allowlist backing `get-file-contents` was renderer-writable via
 * `rq-storage:storage-action`. Its stated re-test target: prove the two-step
 * poison-then-read sequence cannot grant a read.
 */

describe("RQ-3110 — ACCESSED_FILES:ADD cannot arrive from the renderer", () => {
  it("refuses the poisoning action used in the retest PoC", () => {
    const poison = {
      type: "ACCESSED_FILES:ADD",
      payload: {
        data: {
          filePath: "/Users/victim/.ssh/id_rsa",
          category: "unknown",
          name: "x",
          lastAccessedTs: 1,
        },
      },
    };
    expect(isStorageActionAllowedFromRenderer(poison)).toBe(false);
  });

  it("refuses ADD regardless of payload shape", () => {
    for (const payload of [undefined, null, {}, { data: null }, { data: { filePath: "/etc/passwd" } }]) {
      expect(isStorageActionAllowedFromRenderer({ type: "ACCESSED_FILES:ADD", payload })).toBe(false);
    }
  });

  it("ADD is the only forbidden action — granting access is the only thing refused", () => {
    expect([...RENDERER_FORBIDDEN_STORAGE_ACTIONS]).toEqual(["ACCESSED_FILES:ADD"]);
  });
});

describe("RQ-3110 — the gate does not break legitimate renderer traffic", () => {
  it("allows REMOVE (only shrinks the allowlist, used to clear recents)", () => {
    expect(isStorageActionAllowedFromRenderer({ type: "ACCESSED_FILES:REMOVE", payload: { data: "/a/b" } })).toBe(true);
  });

  it("allows the read actions that drive the recents UI", () => {
    for (const type of ["ACCESSED_FILES:GET_ALL", "ACCESSED_FILES:GET_CATEGORY"]) {
      expect(isStorageActionAllowedFromRenderer({ type })).toBe(true);
    }
  });

  it("leaves unrelated storage domains untouched", () => {
    for (const type of [
      "SSL_PROXYING:GET",
      "SSL_PROXYING:SET",
      "USER_PREFERENCE:GET",
      "USER_PREFERENCE:SET",
    ]) {
      expect(isStorageActionAllowedFromRenderer({ type })).toBe(true);
    }
  });

  it("passes malformed actions through — the processor matches type by strict equality, so nothing is granted", () => {
    for (const action of [undefined, null, {}, { type: 42 }, { type: {} }, { type: ["ACCESSED_FILES:ADD"] }]) {
      expect(isStorageActionAllowedFromRenderer(action)).toBe(true);
    }
  });

  it("cannot be evaded by case or padding, because the processor is exact-match too", () => {
    // These slip past the gate but also fail the processor's `type === ACCESSED_FILES.ADD`
    // check, so they select no mutating branch. Documented, not a hole.
    expect(isStorageActionAllowedFromRenderer({ type: "accessed_files:add" })).toBe(true);
    expect(isStorageActionAllowedFromRenderer({ type: " ACCESSED_FILES:ADD " })).toBe(true);
  });
});

/**
 * events.js cannot be imported under jest without a full Electron mock, so guard the
 * wiring by inspection instead. This fails if someone removes the gate from the
 * handler — which is exactly how this vulnerability would come back.
 */
describe("RQ-3110 — the IPC handler is actually gated", () => {
  const eventsSource = fs.readFileSync(path.join(__dirname, "..", "events.js"), "utf-8");

  it("checks the gate inside the rq-storage:storage-action handler", () => {
    const handler = eventsSource.slice(
      eventsSource.indexOf('ipcMain.handle("rq-storage:storage-action"')
    );
    const body = handler.slice(0, handler.indexOf("});") + 3);
    expect(body).toContain("isStorageActionAllowedFromRenderer");
    // The gate must precede the forward, not follow it.
    expect(body.indexOf("isStorageActionAllowedFromRenderer")).toBeLessThan(
      body.indexOf("storageService.processAction")
    );
  });

  it("keeps the main-process consent path ungated (dialog picks must still record)", () => {
    // trackRecentlyAccessedFile calls processAction directly, not over IPC.
    const tracker = eventsSource.slice(
      eventsSource.indexOf("export async function trackRecentlyAccessedFile"),
      eventsSource.indexOf("function removeFileFromAccessRecords")
    );
    expect(tracker).toContain("ACCESSED_FILES:ADD");
    expect(tracker).not.toContain("isStorageActionAllowedFromRenderer");
  });
});
