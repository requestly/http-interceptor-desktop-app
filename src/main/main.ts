/* eslint-disable */
/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import "core-js/stable";
import "regenerator-runtime/runtime";
// Initialize Sentry for main process
import "../utils/sentryInit";
import * as Sentry from "@sentry/electron/main";
import path from "path";
import {
  app,
  BrowserWindow,
  shell,
  dialog,
  Tray,
  Menu,
  clipboard,
  ipcMain,
} from "electron";
import log from "electron-log";
import MenuBuilder from "./menu";
import {
  registerMainProcessCommonEvents,
  registerMainProcessEvents,
  registerMainProcessEventsForWebAppWindow,
  trackRecentlyAccessedFile,
} from "./events";
/** Storage - State */
import "./actions/initGlobalState";
import AutoUpdate from "../lib/autoupdate";
import { getReadyToQuitApp } from "./actions/cleanup";
import fs from "fs";
import logger from "../utils/logger";
import { setupIPCForwardingToWebApp } from "./actions/setupIPCForwarding";
import { saveCookies } from "./actions/cookiesHelpers";

// Global error handlers for main process
process.on("uncaughtException", (error) => {
  logger.error("[Main Process] Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, _promise) => {
  logger.error("[Main Process] Unhandled Rejection:", reason);
});

if (process.env.IS_SETAPP_BUILD === "true") {
  log.log("[SETAPP] build identified")
  const setappFramework = require("@setapp/framework-wrapper");
  setappFramework.SetappManager.shared.reportUsageEvent(setappFramework.SETAPP_USAGE_EVENT.USER_INTERACTION);
  log.log("[SETAPP] integration complete")
}

// Init remote so that it could be consumed in renderer
const remote = require("@electron/remote/main");
remote.initialize();

// Browser windows
let webAppWindow: BrowserWindow | null = null;
let loadingScreenWindow: BrowserWindow | null = null;

let tray: Tray | null = null;

let customWebAppURL: string | null = null;

const RESOURCES_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "assets")
  : path.join(__dirname, "../../assets");

const getAssetPath = (...paths: string[]): string => {
  return path.join(RESOURCES_PATH, ...paths);
};

const isDevelopment =
  process.env.NODE_ENV === "development" || process.env.DEBUG_PROD === "true";

if (isDevelopment) {
  const sourceMapSupport = require("source-map-support");
  sourceMapSupport.install();
}

if (isDevelopment) {
  require("electron-debug")();
}

const installExtensions = async () => {
  const installer = require("electron-devtools-installer");
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ["REACT_DEVELOPER_TOOLS", "REDUX_DEVTOOLS"];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

export default function createTrayMenu(ip?: string, port?: number) {
  if (tray) {
    // tray is recreated when proxy parameters are ready
    tray.destroy();
    tray = null;
  }
  const proxyAddress = `${ip}:${port}`;
  const menuOptions: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Show Requestly",
      click: () => {
        if (webAppWindow && !webAppWindow.isDestroyed()) {
          if (webAppWindow.isMinimized()) {
            webAppWindow.restore();
          }
          webAppWindow.show();
          webAppWindow.focus();
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: `Listening On ${proxyAddress}`, // todo: get actual ip and port
      submenu: [
        {
          label: "Copy",
          click: () => {
            clipboard.writeText(proxyAddress);
          },
        },
        {
          label: "Copy IP",
          click: () => {
            clipboard.writeText(ip ?? "");
          },
        },
        {
          label: "Copy Port",
          click: () => {
            clipboard.writeText(port?.toString() ?? "");
          },
        },
      ],
    },
    {
      type: "separator",
    },
    {
      label: "📖 Documentation",
      click: () => {
        // todo: get link from constants
        const documentationURL = "https://docs.requestly.io";
        shell.openExternal(documentationURL);
      },
    },
    {
      label: "🐞 Report an Issue",
      click: () => {
        const issueURL =
          "https://github.com/requestly/requestly/issues/new/choose";
        shell.openExternal(issueURL);
      },
    },
    {
      label: "⭐ Give us a Star",
      click: () => {
        const repoURL = "https://github.com/requestly/requestly/";
        shell.openExternal(repoURL);
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        webAppWindow?.close();
      },
    },
  ];

  if (!ip || !port) {
    // for case when proxy is not ready
    menuOptions.splice(1, 2);
  }
  const trayMenu = Menu.buildFromTemplate(menuOptions);

  if (process.platform === "win32") {
    tray = new Tray(getAssetPath("iconTemplate@2x.ico"));
  } else {
    tray = new Tray(getAssetPath("iconTemplate.png"));
  }
  tray.setToolTip("Requestly App");
  tray.setContextMenu(trayMenu);
}

const getWebAppURL = (): string => {
  if (customWebAppURL) {
    return customWebAppURL;
  }
  return isDevelopment
    ? "http://localhost:3000"
    : "https://app.requestly.io";
};

// RQ-3113: webAppWindow holds the privileged preload bridge, so it must only
// ever load origins we own. Used both by the change-webapp-url IPC handler and
// as a navigation guard. Matches the full hostname (not substrings) so
// look-alikes like requestly.io.evil.com / xrequestly-dev.web.app are rejected.
// Firebase preview channels deploy to the requestly-dev hosting site, e.g.
// https://requestly-dev--<branch>-<hash>.web.app
const FIREBASE_PREVIEW_HOST = /^requestly-dev--[a-z0-9-]+\.web\.app$/;

export const isAllowedWebAppUrl = (rawUrl: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const host = parsed.hostname;

  // Local dev server — only in development builds, never in a packaged app.
  if (host === "localhost" || host === "127.0.0.1") {
    return isDevelopment;
  }

  // Everything else must be served over HTTPS.
  if (parsed.protocol !== "https:") {
    return false;
  }

  // Any requestly.io origin (app, beta, staging, EAP).
  if (host === "requestly.io" || host.endsWith(".requestly.io")) {
    return true;
  }

  // Beta/preview Firebase channels.
  if (FIREBASE_PREVIEW_HOST.test(host)) {
    return true;
  }

  return false;
};

let closingAccepted = false;
const createWindow = async () => {
  if (isDevelopment) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../assets");

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  let framelessOptions = {};

  // Only for OSX right now. Needs to be tested for linux and windows
  if (process.platform === "darwin") {
    framelessOptions = {
      frame: false,
      titleBarStyle: "hidden" as "hidden",
      trafficLightPosition: { x: 16, y: 16 },
    };
  }

  webAppWindow = new BrowserWindow({
    show: false,
    width: 1310,
    minWidth: 1100,
    height: 600,
    minHeight: 500,
    icon: getAssetPath("icon.png"),
    webPreferences: {
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
    ...framelessOptions,
  });
  webAppWindow.webContents.setVisualZoomLevelLimits(1, 3);

  new AutoUpdate(webAppWindow);
  remote.enable(webAppWindow.webContents);

  // TODO @sahil: Prod and Local Urls should be supplied by @requestly/requestly-core-npm package.
  const DESKTOP_APP_URL = getWebAppURL();
  webAppWindow.loadURL(DESKTOP_APP_URL, {
    extraHeaders: "pragma: no-cache\n",
  });

  // @ts-ignore
  webAppWindow.webContents.once(
    "did-fail-load",
    (
      _event,
      errorCode,
      _errorDescription,
      validatedUrl,
      isMainFrame,
      _frameProcessId,
      _frameRoutingId
    ) => {
      if (isMainFrame) {
        console.error(
          `did-fail-load errorCode=${errorCode} url=${validatedUrl}`
        );
        if (webAppWindow) webAppWindow.hide();
        dialog.showErrorBox(
          "No internet",
          "Unable to connect to Requestly servers. Make sure you're connected to the internet or try removing any active proxy."
        );
        app.quit();
      }
    }
  );

  webAppWindow.once("ready-to-show", () => {
    if (!webAppWindow) {
      throw new Error("Not expecting this to happen!");
    }
    if (process.env.START_MINIMIZED) {
      webAppWindow.minimize();
    } else {
      // Show Web app
      webAppWindow.maximize();
      // webAppWindow.setResizable(false);
      webAppWindow.show();
      webAppWindow.focus();

      executeOnWebAppReadyHandlers();
    }

    // Close loading splash screen
    if (loadingScreenWindow) {
      loadingScreenWindow.hide();
      loadingScreenWindow.close();
    }
  });

  webAppWindow.on("close", async (event) => {
    if (!closingAccepted) {
      event.preventDefault();
      webAppWindow?.webContents.send("initiate-app-close");
    }
  });

  webAppWindow.on("closed", async () => {
    saveCookies();
    await getReadyToQuitApp();
    webAppWindow = null;
    return;
  });
  const enableBGWindowDebug = () => {
    // Show bg window and toggle the devtools
    try {
      // Suppress Global object warnings
      const globalAny: any = global;

      // eslint-disable-next-line
      if (globalAny.backgroundWindow) {
        // Show Window
        // eslint-disable-next-line
        globalAny.backgroundWindow.show();

        // eslint-disable-next-line
        globalAny.backgroundWindow.webContents.openDevTools();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const menuBuilder = new MenuBuilder(webAppWindow, enableBGWindowDebug);
  menuBuilder.buildMenu();
  createTrayMenu();

  // Open urls in the user's browser
  webAppWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // RQ-3113: defense-in-depth. The IPC handler is the front door; this blocks
  // any other way the privileged window could be navigated off our origins
  // (in-page navigation, JS redirects, HTTP 3xx). SPA client-side routing uses
  // the History API and does not trigger these events, so this is transparent
  // to normal use; external links already open in the browser via the handler
  // above and the requestly:// deep-link flow.
  const blockDisallowedNavigation = (
    event: Electron.Event,
    targetUrl: string
  ) => {
    if (!isAllowedWebAppUrl(targetUrl)) {
      console.warn("Blocked navigation to disallowed URL:", targetUrl);
      event.preventDefault();
    }
  };
  webAppWindow.webContents.on("will-navigate", blockDisallowedNavigation);
  webAppWindow.webContents.on("will-redirect", blockDisallowedNavigation);
};

let onWebAppReadyHandlers: (() => void)[] = [];
function executeOnWebAppReadyHandlers() {
  if (onWebAppReadyHandlers.length > 0) {
    onWebAppReadyHandlers.forEach((callback) => {
      callback();
    });
    onWebAppReadyHandlers = [];
  }
}

function handleCustomProtocolURL(urlString: string) {
  webAppWindow?.show();
  webAppWindow?.focus();
  const url = new URL(urlString);
  // note: currently action agnostic, because it is only meant for redirection for now
  if (url.searchParams.has("route")) {
    const route = url.searchParams.get("route");
    webAppWindow?.webContents.send("deeplink-handler", route);
  }
}

// custom protocol (requestly) handler
app.on("open-url", (_event, rqUrl) => {
  if (webAppWindow && !webAppWindow.isDestroyed()) {
    handleCustomProtocolURL(rqUrl);
  } else {
    onWebAppReadyHandlers.push(() => handleCustomProtocolURL(rqUrl));
  }
});

async function handleFileOpen(filePath: string, webAppWindow?: BrowserWindow) {
  trackRecentlyAccessedFile(filePath);
  log.info("filepath opened", filePath);
  webAppWindow?.show();
  webAppWindow?.focus();
  try {
    const fileContents = await fs.promises.readFile(filePath, "utf8");
    const fileExtension = path.extname(filePath);
    const fileName = path.basename(filePath, fileExtension);

    const fileObject = {
      name: fileName,
      extension: fileExtension,
      contents: fileContents,
      path: filePath,
    };

    webAppWindow?.webContents.send("open-file", fileObject);
  } catch (error) {
    logger.error(`Error while reading file ${filePath}`, error);
    onWebAppReadyHandlers.push(() => handleFileOpen(filePath));
  }
}

app.on("open-file", async (event, filePath) => {
  event.preventDefault();
  if (webAppWindow && !webAppWindow.isDestroyed()) {
    handleFileOpen(filePath, webAppWindow);
  } else {
    logger.log("webAppWindow not ready");
    onWebAppReadyHandlers.push(() => handleFileOpen(filePath));
  }
  return;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  // Init loading screen
  loadingScreenWindow = new BrowserWindow({
    width: 200,
    height: 200,
    /// remove the window frame, so it will become a border-less window
    frame: false,
    /// and set the transparency, to remove any window background color
    transparent: true,
  });
  // User should not allow resizing it
  loadingScreenWindow.setResizable(false);

  loadingScreenWindow.once("show", async () => {
    // DO actual stuff
    // Register Basic IPC Events
    registerMainProcessEvents();
    // Create Renderer Window
    await createWindow();
    // Register Remaining IPC Events that involve browser windows
    setupIPCForwardingToWebApp(webAppWindow);
    registerMainProcessEventsForWebAppWindow(webAppWindow);
    registerMainProcessCommonEvents();

    if (process.platform === "win32") {
      // Set the path of electron.exe and your app.
      // These two additional parameters are only available on windows.
      // Setting this is required to get this working in dev mode.
      app.setAsDefaultProtocolClient("requestly", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient("requestly");
    }
  });
  loadingScreenWindow.loadURL(
    `file://${path.resolve(process.resourcesPath, "loadingScreen", "index.html")}`
  );
  loadingScreenWindow.show();
});

// Dont use any proxy
app.commandLine.appendSwitch("no-proxy-server");

/**
 * Add event listeners...
 */

app.on("window-all-closed", () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }

  // Hotfix- New window cant be recreated, better quit
  app.quit();
});

app
  .whenReady()
  .then(() => {
    app.on("activate", () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((err) => {
    console.log(err);
  });

ipcMain.handle("quit-app", (_event) => {
  closingAccepted = true;
  webAppWindow?.close();
});

export const loadWebAppUrl = async (newURL: string) => {
  if (!webAppWindow || webAppWindow.isDestroyed()) {
    throw new Error("Web app window is not available");
  }

  // RQ-3113: never trust the caller — re-check the origin before navigating the
  // privileged window, and never persist a disallowed URL into customWebAppURL.
  if (!isAllowedWebAppUrl(newURL)) {
    throw new Error("URL not allowed");
  }

  await webAppWindow.loadURL(newURL, {
    extraHeaders: "pragma: no-cache\n",
  });

  customWebAppURL = newURL;
  
  if (!webAppWindow.isVisible()) {
    webAppWindow.show();
  }
  
  webAppWindow.focus();
};

app.on("before-quit", () => {
  // cleanup when quitting has been finalised
  ipcMain.removeAllListeners();
  webAppWindow?.removeAllListeners();
  // @ts-expect-error BrowserWindow types are not being enforced for this variable
  backgroundWindow?.removeAllListeners();

  ipcMain.removeAllListeners();
  process.on("uncaughtException", (err) => {
    logger.error("Unhandled Exception while quitting:", err);
  });
  process.on("unhandledRejection", (err) => {
    logger.error("Unhandled Rejection while quitting:", err);
  });
});
