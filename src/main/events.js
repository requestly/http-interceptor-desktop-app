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
import makeApiClientRequest from "./actions/makeApiClientRequest";
import storageService from "../lib/storage";
import {
  deleteNetworkRecording,
  getAllNetworkSessions,
  getSessionRecording,
  storeSessionRecording,
} from "./actions/networkSessionStorage";
import { createOrUpdateAxiosInstance } from "./actions/getProxiedAxios";
// todo: refactor main.ts to only export core entities like webappWindow
// and then build these utilites elsewhere
// eslint-disable-next-line import/no-cycle
import createTrayMenu, { loadWebAppUrl } from "./main";
import {
  fetchAndSaveSecrets,
  getSecretProviderConfig,
  getSecretValue,
  getSecretValues,
  initSecretsManager,
  listSecretProviders,
  listSecrets,
  removeSecretProviderConfig,
  removeSecretValue,
  removeSecretValues,
  setSecretProviderConfig,
  subscribeToProvidersChange,
  testSecretProviderConnection,
  testSecretProviderConnectionWithConfig,
} from "../lib/secretsManager";

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

const createFsResourceItem = (name, fsResourcePath, type) => ({
  name,
  path: fsResourcePath,
  type,
  ...(type === "directory" && { contents: [] }),
});

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
    createOrUpdateAxiosInstance(payload);
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
    createOrUpdateAxiosInstance(payload);
  });

  ipcMain.handle("does-file-exist", async (event, filePath) => {
    try {
      const exists = fs.existsSync(filePath);
      return exists;
    } catch (e) {
      console.error("Error checking file existence", e);
      return false;
    }
  });

  ipcMain.handle("get-api-response", async (event, payload) => {
    return makeApiClientRequest(payload);
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
      const { url } = payload;
      if (!url || typeof url !== "string") {
        new URL(url);
        return { success: false, error: "Invalid URL provided" };
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
    try {
      const fileContents = fs.readFileSync(payload.filePath, "utf-8");
      if (!fileContents) {
        throw new Error("File is empty");
      }
      return fileContents;
    } catch (e) {
      console.log(e);
      // delete file from recently accessed
      removeFileFromAccessRecords(payload.filePath);
      return "err:NOT FOUND";
    }
  });

  ipcMain.handle("helper-server-hit", () => {
    webAppWindow?.send("helper-server-hit");
  });

  ipcMain.handle("secretsManager:init", (event, { userId }) => {
    return initSecretsManager(userId);
  });

  ipcMain.handle("secretsManager:subscribeToProvidersChange", () => {
    subscribeToProvidersChange((providers) => {
      webAppWindow?.webContents.send(
        "secretsManager:providersChanged",
        providers
      );
    });
  });

  ipcMain.handle(
    "secretsManager:setSecretProviderConfig",
    (event, { config }) => {
      return setSecretProviderConfig(config);
    }
  );

  ipcMain.handle(
    "secretsManager:getSecretProviderConfig",
    (event, { providerId }) => {
      return getSecretProviderConfig(providerId);
    }
  );

  ipcMain.handle(
    "secretsManager:removeSecretProviderConfig",
    (event, { providerId }) => {
      return removeSecretProviderConfig(providerId);
    }
  );

  ipcMain.handle(
    "secretsManager:testProviderConnection",
    (event, { providerId }) => {
      return testSecretProviderConnection(providerId);
    }
  );

  ipcMain.handle(
    "secretsManager:testProviderConnectionWithConfig",
    (event, { config }) => {
      return testSecretProviderConnectionWithConfig(config);
    }
  );

  ipcMain.handle(
    "secretsManager:getSecretValue",
    (event, { providerId, secretReference }) => {
      return getSecretValue(providerId, secretReference);
    }
  );

  ipcMain.handle("secretsManager:getSecretValues", (event, { secrets }) => {
    return getSecretValues(secrets);
  });

  ipcMain.handle("secretsManager:fetchAndSaveSecrets", (event, { providerId, secretRefs }) => {
    return fetchAndSaveSecrets(providerId, secretRefs);
  });

  ipcMain.handle("secretsManager:listSecretProviders", () => {
    return listSecretProviders();
  });

  ipcMain.handle(
    "secretsManager:removeSecretValue",
    (event, { providerId, secretReference }) => {
      return removeSecretValue(providerId, secretReference);
    }
  );

  ipcMain.handle("secretsManager:removeSecretValues", (event, { secrets }) => {
    return removeSecretValues(secrets);
  });

  ipcMain.handle("secretsManager:listSecrets", (event, { providerId }) => {
    return listSecrets(providerId);
  });
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

  ipcMain.handle(
    "get-workspace-folder-preview",
    async (event, payload = {}) => {
      try {
        let { folderPath } = payload;

        if (!folderPath) {
          const homeDir = os.homedir();
          const documentsPath = path.join(homeDir, "Documents");

          if (
            fs.existsSync(documentsPath) &&
            fs.statSync(documentsPath).isDirectory()
          ) {
            folderPath = documentsPath;
          } else {
            folderPath = homeDir;
          }
        }

        // Checking if workspace folder exists
        const folderExists = fs.existsSync(folderPath);
        const existingContents = [];

        if (folderExists) {
          // Check if it's a directory
          const stats = fs.statSync(folderPath);
          if (!stats.isDirectory()) {
            throw new Error("Folder path is not a directory");
          }

          // Read existing directory contents at root level of workspace
          const items = fs.readdirSync(folderPath);

          for (const item of items) {
            const itemPath = path.join(folderPath, item);
            const itemStats = fs.statSync(itemPath);

            existingContents.push(
              createFsResourceItem(
                item,
                itemPath,
                itemStats.isDirectory() ? "directory" : "file"
              )
            );
          }

          existingContents.sort((a, b) => {
            const aIsDir = a.type === "directory";
            const bIsDir = b.type === "directory";
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.name.localeCompare(b.name);
          });
        }

        const newAdditions = {
          name: "Workspace folder",
          path: folderPath,
          type: "directory",
          contents: [
            {
              name: "environments",
              path: path.join(folderPath, "environments"),
              type: "directory",
              contents: [],
            },
            {
              name: "requestly.json",
              path: path.join(folderPath, "requestly.json"),
              type: "file",
            },
          ],
        };

        return {
          success: true,
          folderPath,
          existingContents,
          newAdditions,
        };
      } catch (error) {
        console.error("Error getting folder preview:", error);
        return {
          success: false,
          error: error.message,
          folderPath: payload.folderPath,
        };
      }
    }
  );
};
