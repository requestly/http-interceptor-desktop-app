// Initialize Sentry for background renderer (must be first)
import "../utils/sentryInit";
import logger from "../utils/logger";
import { ipcRenderer } from "electron";

const initGlobalNamespace = () => {
  global.rq = global.rq || {};
};

initGlobalNamespace();

// Global error handlers for background renderer
process.on("uncaughtException", (error) => {
  logger.error("[Background Renderer] Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, _promise) => {
  logger.error("[Background Renderer] Unhandled Rejection:", reason);
});

window.addEventListener("error", (event) => {
  if(event.error){
    logger.error("[Background Renderer] Window Error:", event.error);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  logger.error("[Background Renderer] Unhandled Promise Rejection:", event.reason);
});

// ACTIONS
import initEventHandlers from "./actions/initEventHandlers";
// import initPrimaryStorageCache from "./actions/storage/initPrimaryStorageCache";
import initRulesCache from "./actions/storage/initRulesCache";
import initGroupsCache from "./actions/storage/initGroupsCache";
import { initAppManager } from "./actions/apps";
import "./types";
import { FsManagerBuilderRPCService } from "./actions/local-sync/fs-manager-builder.rpc-service";
import { clearStoredLogs } from "./lib/proxy-interface/loggerService";

// initPrimaryStorageCache();
initRulesCache();
initGroupsCache();
/* IPC */
initEventHandlers();
initAppManager();
/* stored logs */
clearStoredLogs();

// import "../utils/sentryInit";
// const LocalFileSyncer = new LocalFileSync();
// LocalFileSyncer.init();

// const TestServiceServer = new TestService();

// eslint-disable-next-line no-unused-vars, no-new
new FsManagerBuilderRPCService();

// Signal to main process that background is fully initialized and ready to receive IPC calls
ipcRenderer.send("background-process-ready");
