/* eslint-disable */
import { enable as enableWebContents } from "@electron/remote/main";
import { captureException } from "@sentry/browser";
/** Babel */
require("core-js/stable");
require("regenerator-runtime/runtime");
const path = require("path");
// CORE
// Utils
const { BrowserWindow } = require("electron");
const logger = require("../../utils/logger");
// State Management
const { getState, setState } = require("./stateManagement");
const { setupIPCForwardingToBackground } = require("./setupIPCForwarding");

const resolveBackgroundPath = (htmlFileName) => {
  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT || 1212;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, "../renderer/", htmlFileName)}`;
};

const startBackgroundProcess = async () => {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    let backgroundWindow = await getState("backgroundWindow");
    if (!backgroundWindow) {
      try {
        backgroundWindow = await setState(null, {
          stateName: "backgroundWindow",
          // Background Process Window
          newValue: new BrowserWindow({
            width: 800,
            height: 600,
            show:
              process.env.NODE_ENV === "development" ||
              process.env.DEBUG_PROD === "true",
            webPreferences: {
              nodeIntegration: true,
              contextIsolation: false,
              enableRemoteModule: true,
            },
          }),
        });
        enableWebContents(backgroundWindow.webContents);
      } catch (error) {
        console.error(error);
        captureException(error);
        resolve(false);
        return;
      }
    } else {
      logger.log(
        "startBackgroundProcess: A background windows already exists. Cancelling."
      );
      resolve(true);
      return;
    }

    global.backgroundWindow = backgroundWindow;

    // Load background code
    backgroundWindow.loadURL(resolveBackgroundPath("index.html"));

    // Open the DevTools in dev mode
    if (
      process.env.NODE_ENV === "development" ||
      process.env.DEBUG_PROD === "true"
    )
    {
      backgroundWindow.webContents.once('dom-ready', () => {
        backgroundWindow.webContents.openDevTools();
      })
    }
    
    backgroundWindow.on('close', (event) => {
      if (!global.isQuitting) {
        event.preventDefault();
        backgroundWindow.hide();
      }
      return false;
    });

    // Setup IPC forwarding
    setupIPCForwardingToBackground(backgroundWindow);

    // Set state
    global.isBackgroundProcessActive = true;

    backgroundWindow.on("closed", () => {
      console.error("Background window closed unexpectedly");
      captureException(new Error("Background window closed unexpectedly"));
    })
       
    backgroundWindow.webContents.on("did-finish-load", () => {
      resolve(true);
    });

  });
};

export default startBackgroundProcess;
