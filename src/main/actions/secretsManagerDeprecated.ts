import { ipcMain } from "electron";

// The secrets manager served only the in-app API client, which is deprecated: the web app
// now shows a permanent migration modal instead. The web app still calls these channels
// (for example secretsManager:init at startup for signed-in users), so they stay registered
// with the same result shapes, but nothing is stored, read or fetched any more:
// - reads answer with empty results;
// - init, subscribe and removals succeed with nothing to do;
// - saving a provider, testing a connection and fetching secrets return an error.
type SecretsVoidResult = { type: "success" };
type SecretsDataResult<T> = { type: "success"; data: T };
type SecretsErrorResult = { type: "error"; error: { code: string; message: string } };

const done: SecretsVoidResult = { type: "success" };
const empty = <T>(data: T): SecretsDataResult<T> => ({ type: "success", data });
const unavailable: SecretsErrorResult = {
  type: "error",
  error: {
    code: "unknown",
    message: "The secrets manager is no longer available in this app. Use the Requestly API Client app.",
  },
};

export const registerDeprecatedSecretsManagerHandlers = () => {
  ipcMain.handle("secretsManager:init", () => done);
  ipcMain.handle("secretsManager:subscribeToProvidersChange", () => undefined);
  ipcMain.handle("secretsManager:listSecretProviders", () => empty([]));
  ipcMain.handle("secretsManager:getSecretProviderConfig", () => empty(null));
  ipcMain.handle("secretsManager:setSecretProviderConfig", () => unavailable);
  ipcMain.handle("secretsManager:removeSecretProviderConfig", () => done);
  ipcMain.handle("secretsManager:testProviderConnection", () => unavailable);
  ipcMain.handle("secretsManager:testProviderConnectionWithConfig", () => unavailable);
  ipcMain.handle("secretsManager:getSecretValue", () => empty(null));
  ipcMain.handle("secretsManager:getSecretValues", () => empty([]));
  ipcMain.handle("secretsManager:fetchAndSaveSecrets", () => unavailable);
  ipcMain.handle("secretsManager:listSecrets", () => empty([]));
  ipcMain.handle("secretsManager:removeSecretValue", () => done);
  ipcMain.handle("secretsManager:removeSecretValues", () => done);
};
