import path from "path";
import { unescape } from "querystring";
import fs from "fs";
import os from "os";
import { app, dialog, ipcMain, shell } from "electron";
/** ACTIONS */
import startBackgroundProcess from "./actions/startBackgroundProcess";
import { getState, setState } from "./actions/stateManagement";
import logNetworkRequest from "./actions/logNetworkRequest";
import logNetworkRequestV2 from "./actions/logNetworkRequestV2";
import getCurrentNetworkLogs from "./actions/getCurrentNetworkLogs";
import * as PrimaryStorageService from "./actions/initPrimaryStorage";
import storageService from "../lib/storage";
import { isStorageActionAllowedFromRenderer } from "./storage-action-gate";
import {
  deleteNetworkRecording,
  getAllNetworkSessions,
  getSessionRecording,
  storeSessionRecording,
} from "./actions/networkSessionStorage";
// todo: refactor main.ts to only export core entities like webappWindow
// and then build these utilites elsewhere
// eslint-disable-next-line import/no-cycle
import createTrayMenu, { loadWebAppUrl, isAllowedWebAppUrl } from "./main";
import { registerDeprecatedSecretsManagerHandlers } from "./actions/secretsManagerDeprecated";

const getFileCategory = (fileExtension) => {
  switch (fileExtension) {
    case ".har":
      return "har";
    case ".rqly":
      // in future we can also store rules here...
      return "web-session";
    default:
      return "unknown";
  }
};

export async function trackRecentlyAccessedFile(filePath) {
  const fileExtension = path.extname(filePath);

  const fileName = path.basename(filePath, fileExtension);
  const fileCategory = getFileCategory(fileExtension);
  const accessTs = Date.now();

  const fileRecord = {
    category: fileCategory,
    filePath,
    name: fileName,
    lastAccessedTs: accessTs,
  };

  storageService.processAction({
    type: "ACCESSED_FILES:ADD",
    payload: {
      data: fileRecord,
    },
  });
}

function removeFileFromAccessRecords(filePath) {
  storageService.processAction({
    type: "ACCESSED_FILES:REMOVE",
    payload: {
      data: filePath,
    },
  });
}

// RQ-3110: the renderer (nodeIntegration: false) must not be able to read
// arbitrary files via get-file-contents. Confine reads to files the user
// actually opened through the app — the recently-accessed records. Both the
// requested path and the stored paths are resolved with realpathSync so
// symlinks and ".." traversal can't escape, and a look-alike path can't match.
function isAccessedFilePathAllowed(requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath) {
    return false;
  }
  let resolved;
  try {
    resolved = fs.realpathSync(requestedPath);
  } catch (e) {
    return false;
  }
  const accessedFiles =
    storageService.processAction({ type: "ACCESSED_FILES:GET_ALL" }) || [];
  return accessedFiles.some((record) => {
    try {
      return fs.realpathSync(record.filePath) === resolved;
    } catch (e) {
      return false;
    }
  });
}

// These events do not require the browser window
export const registerMainProcessEvents = () => {
  ipcMain.on("background-process-started", () => {
    global.backgroundProcessStarted = true;
  });
  ipcMain.handle("start-background-process", startBackgroundProcess);
  /** Main Process State Management */
  ipcMain.handle("get-state", getState);
  ipcMain.handle("set-state", setState);
  /** Network Logs */
  ipcMain.handle("get-current-network-logs", getCurrentNetworkLogs);
  /** Storage Service */
  ipcMain.handle(
    "get-storage-super-object",
    PrimaryStorageService.getStorageSuperObject
  );
  ipcMain.handle("get-storage-object", (event, keyArg) =>
    PrimaryStorageService.getStorageObject(keyArg)
  );
  ipcMain.handle("set-storage-object", (event, objectArg) =>
    PrimaryStorageService.setStorageObject(objectArg)
  );
  ipcMain.handle("delete-item", (event, keyArg) =>
    PrimaryStorageService.deleteItem(keyArg)
  );
  ipcMain.handle("clear-storage", PrimaryStorageService.clearStorage);

  ipcMain.handle("rq-storage:storage-action", (event, storageAction) => {
    // RQ-3110: this channel used to forward any action verbatim, which made the
    // RecentlyAccessedFiles store — the allowlist get-file-contents consults —
    // renderer-writable. A foothold in webAppWindow could ACCESSED_FILES:ADD its
    // target path and then read it back. See storage-action-gate.ts.
    if (!isStorageActionAllowedFromRenderer(storageAction)) {
      console.warn(
        "Refused storage action from renderer:",
        storageAction?.type,
        "- this action can only originate in the main process."
      );
      return null;
    }
    return storageService.processAction(storageAction);
  });
};

// These events require browser window
export const registerMainProcessEventsForWebAppWindow = (webAppWindow) => {
  // TODO: Remove this when all users shifted to 1.4.0.
  ipcMain.on("log-network-request", (event, message) =>
    logNetworkRequest(event, message, webAppWindow)
  );

  ipcMain.on("log-network-request-v2", (event, message) =>
    logNetworkRequestV2(event, message, webAppWindow)
  );

  // Open handle for async source detection
  ipcMain.handle("app-detected", async (event, payload) => {
    webAppWindow?.send("app-detected", payload);
  });

  ipcMain.handle("browser-connected", async (event, payload) => {
    webAppWindow?.send("browser-connected", payload);
  });

  ipcMain.handle("browser-disconnected", async (event, payload) => {
    webAppWindow?.send("browser-disconnected", payload);
  });

  // Open handle for async browser close
  ipcMain.handle("browser-closed", async (event, payload) => {
    webAppWindow?.send("browser-closed", payload);
  });

  // Open handle for async browser close
  ipcMain.handle("proxy-restarted", async (event, payload) => {
    webAppWindow?.send("proxy-restarted", payload);
  });

  // hacky implementation for syncing addition and deletion
  const resendAllNetworkLogs = async () => {
    const res = await getAllNetworkSessions();
    webAppWindow?.send("network-sessions-updated", res);
  };

  ipcMain.handle("get-all-network-sessions", async () => {
    const networkSessions = await getAllNetworkSessions();
    return networkSessions;
  });

  ipcMain.handle("get-network-session", async (event, payload) => {
    const { id } = payload;
    const result = await getSessionRecording(id);
    return result;
  });

  ipcMain.handle("delete-network-session", async (event, payload) => {
    const { id } = payload;
    try {
      await deleteNetworkRecording(id);
    } catch (e) {
      console.info("Error while deleting ", id);
      console.info(e);
    }
    return resendAllNetworkLogs();
  });

  ipcMain.handle("save-network-session", async (event, payload) => {
    const { har, name, originalFilePath } = payload;
    const id = await storeSessionRecording(har, name, originalFilePath);
    return id;
  });

  ipcMain.on("proxy-config-updated", (_, payload) => {
    createTrayMenu(payload?.ip, payload?.port);
  });

  /* HACKY: Forces regeneration by deleting old cert and closes app */
  ipcMain.handle("renew-ssl-certificates", async () => {
    const pathToCurrentCA = path.resolve(
      unescape(app.getPath("appData")),
      "Requestly",
      ".tmp",
      "certs",
      "ca.pem"
    );
    fs.unlinkSync(pathToCurrentCA);
    webAppWindow?.close();
  });

  ipcMain.handle("change-webapp-url", async (event, payload) => {
    try {
      const url = payload?.url;
      // RQ-3113: validate type, then enforce the origin allowlist. The previous
      // guard was inverted (it only ran new URL(url) when url was falsy), so any
      // real string reached loadWebAppUrl unchecked.
      if (typeof url !== "string") {
        return { success: false, error: "Invalid URL provided" };
      }
      if (!isAllowedWebAppUrl(url)) {
        return { success: false, error: "URL not allowed" };
      }
      await loadWebAppUrl(url);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error?.message ?? "Error changing webapp URL:",
      };
    }
  });

  ipcMain.handle("browse-and-load-file", (event, payload) => {
    console.log("browse-and-load-file payload", payload);
    const category = payload?.category || "unknown";
    const getCategoryFilter = (categoryFilter) => {
      switch (categoryFilter) {
        case "har":
          return [{ name: "HAR Files", extensions: [".har"] }];
        case "web-session":
          return [{ name: "Requestly Files", extensions: [".rqly"] }];
        default:
          return [
            { name: "Requestly Files", extensions: [".rqly"] },
            { name: "HAR Files", extensions: [".har"] },
          ];
      }
    };

    const dialogOptions = {};
    dialogOptions.properties = ["openFile"];
    dialogOptions.filters = [
      ...getCategoryFilter(category),
      { name: "All Files", extensions: ["*"] },
    ];
    return dialog
      .showOpenDialog(dialogOptions)
      .then((result) => {
        const { canceled, filePaths } = result;
        if (canceled || !filePaths?.length) {
          return null;
        }

        const filePath = filePaths[0];
        trackRecentlyAccessedFile(filePath);
        const fileName = path.basename(filePath);
        const fileCategory = getFileCategory(path.extname(filePath));
        const contents = fs.readFileSync(filePath, "utf-8");
        return { filePath, name: fileName, category: fileCategory, contents };
      })
      .catch((err) => {
        console.log(err);
        return null;
      });
  });

  ipcMain.handle("get-file-contents", async (event, payload) => {
    const filePath = payload?.filePath;
    // RQ-3110: only read files the user opened through the app. Disallowed paths
    // return the same "not found" the caller already handles — no read, and no
    // existence oracle for arbitrary paths.
    if (!isAccessedFilePathAllowed(filePath)) {
      return "err:NOT FOUND";
    }
    try {
      const fileContents = fs.readFileSync(filePath, "utf-8");
      if (!fileContents) {
        throw new Error("File is empty");
      }
      return fileContents;
    } catch (e) {
      console.log(e);
      // delete file from recently accessed
      removeFileFromAccessRecords(filePath);
      return "err:NOT FOUND";
    }
  });

  ipcMain.handle("helper-server-hit", () => {
    webAppWindow?.send("helper-server-hit");
  });

  // Deprecated with the in-app API client: inert handlers, nothing stored or fetched.
  registerDeprecatedSecretsManagerHandlers();
};

export const registerMainProcessCommonEvents = () => {
  ipcMain.handle("open-file-dialog", async (event, options) => {
    const fileDialogPromise = dialog.showOpenDialog(options ?? {});
    return fileDialogPromise
      .then((result) => {
        const { canceled, filePaths } = result;
        if (canceled || !filePaths?.length) {
          return { canceled: true, files: [] };
        }
        const files = [];
        for (const filePath of filePaths) {
          const { size } = fs.statSync(filePath);
          const name = path.basename(filePath);
          // RQ-3110: a file chosen here is a user gesture, so record it as
          // accessed — get-file-contents is confined to accessed files, and
          // some flows (e.g. the API client collection-runner data file) read
          // the picked path back through that IPC.
          trackRecentlyAccessedFile(filePath);
          files.push({ path: filePath, name, size });
        }
        return { canceled, files };
      })
      .catch(console.error);
  });

  ipcMain.handle("open-folder-dialog", async (event, options = {}) => {
    const dialogOptions = {
      ...options,
      properties: ["openDirectory", "createDirectory"],
    };
    const folderDialogPromise = await dialog.showOpenDialog(dialogOptions);
    return folderDialogPromise;
  });

  ipcMain.handle("open-path-in-file-explorer", async (event, payload = {}) => {
    const { resourcePath } = payload;
    shell.openPath(resourcePath);
  });

};
