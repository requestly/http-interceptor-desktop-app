import { ACCESSED_FILES } from "../lib/storage/types/action-types";

/**
 * RQ-3110 — seal the `get-file-contents` allowlist against renderer poisoning.
 *
 * `get-file-contents` confines reads to files recorded in the RecentlyAccessedFiles
 * store. That confinement is only worth anything if the renderer cannot write to
 * the store. It could: the `rq-storage:storage-action` IPC forwarded any action
 * straight to `storageService.processAction`, so JS in webAppWindow ran
 *
 *   invokeEventInMain("rq-storage:storage-action",
 *     { type: "ACCESSED_FILES:ADD", payload: { data: { filePath: "<target>", … } } })
 *   invokeEventInMain("get-file-contents", { filePath: "<target>" })
 *
 * and read any file on disk — the original Critical finding, straight through the
 * fix (BrowserStack Security retest, 2026-07-21).
 *
 * ADD is the ONLY action that can grant read access, so it is the only one refused:
 *   ADD         — refused. This is the poisoning primitive.
 *   REMOVE      — allowed. Only shrinks the allowlist; the web app uses it so users
 *                 can clear entries from the recents list.
 *   GET_ALL /
 *   GET_CATEGORY— allowed. Reads. The renderer already renders this list.
 *
 * Main-process consent paths are unaffected: `trackRecentlyAccessedFile` calls
 * `storageService.processAction` directly, never through IPC, and it is reached only
 * from `dialog.showOpenDialog` results and the OS file-association handler — i.e.
 * only from a real user gesture.
 *
 * Note the comparison is exact-match, which is safe rather than lax: the processor
 * itself dispatches on `type === ACCESSED_FILES.ADD`, so a case-variant string that
 * slipped past this gate would not trigger ADD either.
 */
export const RENDERER_FORBIDDEN_STORAGE_ACTIONS: ReadonlySet<string> = new Set([
  ACCESSED_FILES.ADD,
]);

/**
 * True if a storage action arriving over IPC may be forwarded to the storage service.
 */
export const isStorageActionAllowedFromRenderer = (action: unknown): boolean => {
  const type = (action as { type?: unknown } | null | undefined)?.type;
  if (typeof type !== "string") {
    // Not a dispatchable action — the processor matches `type` by strict equality,
    // so a non-string can never select a mutating branch.
    return true;
  }
  return !RENDERER_FORBIDDEN_STORAGE_ACTIONS.has(type);
};
