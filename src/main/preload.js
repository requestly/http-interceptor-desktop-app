/* eslint-disable func-names */
/** Babel */
require("core-js/stable");
require("regenerator-runtime/runtime");
// Core
const { contextBridge } = require("electron");

const DesktopStorageService = require("./preload-apis/DesktopStorageService");
// Sub
const IPC = require("./preload-apis/IPC");
const STATE_MANAGEMENT = require("./preload-apis/AppState");

let appVersion = null;
const isSetappBuild = process.env.IS_SETAPP_BUILD === "true";

if (process.env.NODE_ENV === "development") {
  appVersion = require("../../package.json").version;
} else {
  // Passed by the main process (webPreferences.additionalArguments).
  const versionArg = process.argv.find((arg) => arg.startsWith("--rq-app-version="));
  appVersion = versionArg ? versionArg.slice("--rq-app-version=".length) : null;
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
