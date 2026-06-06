import { ipcMain } from "electron";

// --- Background readiness protocol ---
// Buffer IPC calls until the background process signals it's ready.
let isBackgroundReady = false;
let isBackgroundFailed = false;
const pendingCalls = [];
const BACKGROUND_READY_TIMEOUT_MS = 30_000;
const PER_CALL_TIMEOUT_MS = 60_000;

// Module-scoped refs so they can be cleaned up on background restart
let readyTimeoutId = null;
let onBackgroundReady = null;

const IPC_FORWARD_CHANNEL = "forward-event-from-webapp-to-background-and-await-reply";

export const setupIPCForwardingToBackground = (backgroundWindow) => {
  // Clean up previous invocation's timer and listener (background restart scenario)
  if (readyTimeoutId !== null) {
    clearTimeout(readyTimeoutId);
    readyTimeoutId = null;
  }
  if (onBackgroundReady !== null) {
    ipcMain.removeListener("background-process-ready", onBackgroundReady);
    onBackgroundReady = null;
  }
  ipcMain.removeHandler(IPC_FORWARD_CHANNEL);

  // Reset state
  isBackgroundReady = false;
  isBackgroundFailed = false;
  pendingCalls.length = 0;

  // Safety net: if background never signals ready, reject all buffered calls
  // and mark as failed so new calls are rejected immediately
  readyTimeoutId = setTimeout(() => {
    if (!isBackgroundReady) {
      isBackgroundFailed = true;
      while (pendingCalls.length > 0) {
        const { resolve } = pendingCalls.shift();
        resolve({
          success: false,
          data: "Background process failed to initialize in time",
        });
      }
    }
  }, BACKGROUND_READY_TIMEOUT_MS);

  onBackgroundReady = () => {
    clearTimeout(readyTimeoutId);
    readyTimeoutId = null;
    isBackgroundReady = true;
    isBackgroundFailed = false;

    // Flush all buffered calls in order
    while (pendingCalls.length > 0) {
      const { eventName, actualPayload, replyChannel, resolve } =
        pendingCalls.shift();
      try {
        forwardToBackground(
          backgroundWindow,
          eventName,
          actualPayload,
          replyChannel,
          resolve
        );
      } catch (err) {
        resolve({ success: false, data: `Flush error: ${err.message}` });
      }
    }
  };

  ipcMain.once("background-process-ready", onBackgroundReady);

  ipcMain.handle(
    IPC_FORWARD_CHANNEL,
    async (event, incomingData) => {
      const { actualPayload, eventName } = incomingData;

      // Unique reply channel per call to prevent concurrent calls to the same
      // method from stealing each other's responses via shared ipcMain.once listeners
      const callId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
      const replyChannel = `reply-${eventName}-${callId}`;

      return new Promise((resolve) => {
        // If background failed to init, reject immediately instead of buffering forever
        if (isBackgroundFailed) {
          resolve({
            success: false,
            data: "Background process is not available",
          });
          return;
        }

        if (!isBackgroundReady) {
          pendingCalls.push({
            eventName,
            actualPayload,
            replyChannel,
            resolve,
          });
          return;
        }

        forwardToBackground(
          backgroundWindow,
          eventName,
          actualPayload,
          replyChannel,
          resolve
        );
      });
    }
  );
};

function forwardToBackground(
  backgroundWindow,
  eventName,
  actualPayload,
  replyChannel,
  resolve
) {
  // Safety: clean up listener if background never replies (crash, unhandled error, etc.)
  const callTimeoutId = setTimeout(() => {
    ipcMain.removeAllListeners(replyChannel);
    resolve({ success: false, data: `IPC call timed out: ${eventName}` });
  }, PER_CALL_TIMEOUT_MS);

  ipcMain.once(replyChannel, (responseEvent, responsePayload) => {
    clearTimeout(callTimeoutId);
    resolve(responsePayload);
  });

  try {
    backgroundWindow.webContents.send(eventName, {
      payload: actualPayload,
      replyChannel,
    });
  } catch (err) {
    clearTimeout(callTimeoutId);
    ipcMain.removeAllListeners(replyChannel);
    resolve({ success: false, data: `Send failed: ${err.message}` });
  }
}

export const setupIPCForwardingToWebApp = (webAppWindow) => {
  ipcMain.handle(
    "forward-event-from-background-to-webapp-and-await-reply",
    async (event, incomingData) => {
      return new Promise((resolve) => {
        const { actualPayload, eventName } = incomingData;
        ipcMain.once(`reply-${eventName}`, (responseEvent, responsePayload) => {
          resolve(responsePayload);
        });
        webAppWindow.webContents.send(eventName, actualPayload);
      });
    }
  );

  ipcMain.on("send-from-background-to-webapp", (event, incomingData) => {
    const { payload, channel } = incomingData;
    console.log("Sending to webapp", channel, payload);
    webAppWindow.webContents.send(channel, payload);
  });
};
