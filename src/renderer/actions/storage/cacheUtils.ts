// todo: move to some appropriate location
import UserPreferenceFetcher from "renderer/lib/proxy-interface/userPreferenceFetcher";

export const getCurrentProxyPort = () => {
  return global.rq.proxyServerStatus?.port || null
}

export const getDefaultProxyPort = () => {
  // Load user preferences
  const userPreferences = new UserPreferenceFetcher();
  return userPreferences.getConfig().defaultPort;
}

export const getAllowInsecureCerts = (): boolean => {
  const userPreferences = new UserPreferenceFetcher();
  return !!userPreferences.getConfig()?.allowInsecureCerts;
}

export const getLocalFileLogConfig = () => {
  const userPreferences = new UserPreferenceFetcher();
  const { localFileLogConfig }= userPreferences.getConfig()
  if (!localFileLogConfig) {
    return null;
  }
  return localFileLogConfig;
}