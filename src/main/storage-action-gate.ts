import { ACCESSED_FILES } from "../lib/storage/types/action-types";

// RQ-3110: get-file-contents confines reads to files in the RecentlyAccessedFiles
// store, which is worthless if the renderer can write that store — and it could,
// via this channel (BrowserStack Security retest, 2026-07-21). ADD is the only
// action refused because granting access is the only thing worth refusing: REMOVE
// merely shrinks the allowlist and GET_* are reads, both used by the recents UI.
// The main-process consent path is unaffected — trackRecentlyAccessedFile calls
// processAction directly, reached only from a dialog pick or an OS file-open.
export const RENDERER_FORBIDDEN_STORAGE_ACTIONS: ReadonlySet<string> = new Set([
  ACCESSED_FILES.ADD,
]);

export const isStorageActionAllowedFromRenderer = (action: unknown): boolean => {
  const type = (action as { type?: unknown } | null | undefined)?.type;
  if (typeof type !== "string") {
    // The processor matches `type` by strict equality, so this selects no branch.
    return true;
  }
  return !RENDERER_FORBIDDEN_STORAGE_ACTIONS.has(type);
};
