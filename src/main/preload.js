/* eslint-disable func-names */
/** Babel */
require("core-js/stable");
require("regenerator-runtime/runtime");
// Core
const { contextBridge } = require("electron");
const { app, dialog } = require("@electron/remote");

const DesktopStorageService = require("./preload-apis/DesktopStorageService");
// Sub
const IPC = require("./preload-apis/IPC");
const STATE_MANAGEMENT = require("./preload-apis/AppState");

let appVersion = null;
const isSetappBuild = process.env.IS_SETAPP_BUILD === "true";

if (process.env.NODE_ENV === "development") {
  appVersion = require("../../package.json").version;
} else {
  appVersion = app.getVersion();
}

// Work around Electron Windows bug where built-in alert/confirm cause
// input fields (including CodeMirror editors) to lose a visible caret and
// stop accepting text until the window is re-focused.
//
// See: https://github.com/electron/electron/issues/20400
// Instead of the browser's native confirm, delegate to Electron's
// dialog.showMessageBoxSync, which does not trigger the problematic
// focus behavior.
try {
  if (process.platform === "win32" && typeof window !== "undefined") {
    // Preserve any existing implementation in case something depends on it
    const originalConfirm = window.confirm;

    window.confirm = function (message) {
      try {
        const buttonIdx = dialog.showMessageBoxSync(null, {
          type: "question",
          buttons: ["OK", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          detail: String(message ?? ""),
          message: "",
        });
        return buttonIdx === 0;
      } catch (e) {
        // Fallback to original confirm if dialog fails for any reason
        return originalConfirm ? originalConfirm(message) : true;
      }
    };
  }
} catch (e) {
  // Best-effort override only; ignore any preload-time errors.
}

(function (window) {
  // Build the RQ object
  const RQ = window.RQ || {};
  RQ.DESKTOP = RQ.DESKTOP || {};

  // Application Info
  RQ.MODE = "DESKTOP";
  // TODO @Sachin: TMP VERSION as of now
  RQ.DESKTOP.VERSION = appVersion || "1.0";
  RQ.DESKTOP.IS_SETAPP_BUILD = isSetappBuild;
  // Services
  RQ.DESKTOP.SERVICES = RQ.DESKTOP.SERVICES || {};
  // Services - Storage Service
  RQ.DESKTOP.SERVICES.STORAGE_SERVICE = new DesktopStorageService();
  // Services - App State
  RQ.DESKTOP.SERVICES.STATE_MANAGEMENT = STATE_MANAGEMENT;
  // Services - IPC
  RQ.DESKTOP.SERVICES.IPC = IPC;

  // Expose to frontend
  contextBridge.exposeInMainWorld("RQ", RQ);
})(window);
