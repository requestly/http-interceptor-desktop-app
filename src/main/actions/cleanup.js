const { app, ipcMain } = require("electron");

const cleanup = () => {
  if(global.backgroundProcessStarted) {
    if (global.backgroundWindow) {
      global.backgroundWindow.webContents.send("shutdown");
    } else {
      // No backgroundWindow. Quit directly without cleanup
      app.quit();
    }
  } else {
    app.quit();
  }
};


export const getReadyToQuitApp = async  () => {
  return new Promise((resolve) => {
    global.isQuitting = true;
    cleanup();
  
    if (global.backgroundWindow) {
      global.allowBackgroundWindowDestruction = true;

      let timeoutHandle;

      ipcMain.once("shutdown-success", () => {
        clearTimeout(timeoutHandle);
        if (
          global.backgroundWindow &&
          !global.backgroundWindow.isDestroyed()
        ) {
          if (global.backgroundWindow._originalDestroy) {
            global.backgroundWindow._originalDestroy();
          } else {
            global.backgroundWindow.destroy();
          }
        }
        resolve();
      });
      
      timeoutHandle = setTimeout(() => {
        if (global.backgroundWindow && !global.backgroundWindow.isDestroyed()) {
          if (global.backgroundWindow._originalDestroy) {
            global.backgroundWindow._originalDestroy();
          } else {
            global.backgroundWindow.destroy();
          }
        }
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  })
};