/* eslint-disable func-names */
/** Babel */
require("core-js/stable");
require("regenerator-runtime/runtime");
// Core
const { contextBridge, ipcRenderer } = require("electron");
const { app } = require("@electron/remote");

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

// Work around Electron Windows bug where built-in confirm/alert cause input
// fields (including CodeMirror editors) to lose the visible caret and stop
// accepting text until the window is re-focused.
// See: https://github.com/electron/electron/issues/20400
//
// contextIsolation is enabled (default since Electron 12), so the preload's
// window is isolated from the renderer's window. Assigning
// window.confirm = ... here only affects the preload world, NOT the web
// page. To override the renderer's window.confirm we:
//   1. Expose a synchronous helper (__rqConfirmSync) via contextBridge that
//      uses ipcRenderer.sendSync to call the main process.
//   2. In main.ts, after dom-ready, inject JS that replaces window.confirm
//      with a call to window.__rqConfirmSync.
if (process.platform === "win32") {
  contextBridge.exposeInMainWorld("__rqConfirmSync", (message) => {
    // sendSync blocks the renderer until the main process replies.
    return ipcRenderer.sendSync("rq:show-confirm-dialog", String(message ?? ""));
  });
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
