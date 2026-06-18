// UTILS
import { ip } from "address";

import { RQProxyProvider } from "@requestly/requestly-proxy";
import RulesDataSource from "../../lib/proxy-interface/rulesFetcher";

import getNextAvailablePort from "../getNextAvailablePort";
// CONFIG
import { staticConfig } from "../../config";
// SENTRY
import * as Sentry from "@sentry/browser";
import startHelperServer, { stopHelperServer } from "../startHelperServer";
import logger from "utils/logger";
import { getDefaultProxyPort, getAllowInsecureCerts } from "../storage/cacheUtils";
import { handleCARegeneration } from "../apps/os/ca/utils";
import { startHelperSocketServer, stopHelperSocketServer } from "../helperSocketServer";
import portfinder from "portfinder";
import LoggerService from "renderer/lib/proxy-interface/loggerService";
import { addShutdownHandler } from "../shutdown";

declare global {
  interface Window {
    proxy: any;
  }
}

interface IStartProxyResult {
  success: Boolean;
  port: number | null;
  proxyIp: any;
  helperServerPort?: any;
}

const { CERTS_PATH, ROOT_CERT_PATH } = staticConfig;

const DEFAULT_HELPER_SERVER_PORT = 7040;
const DEFAULT_SOCKET_SERVER_PORT = 59763;

function startProxyFromModule(PROXY_PORT: number) {
  const proxyConfig = {
    port: PROXY_PORT,
    // @ts-ignore
    certPath: CERTS_PATH,
    rootCertPath: ROOT_CERT_PATH,
    onCARegenerated: handleCARegeneration,
    // RQ-2425: user-controlled toggle for upstream TLS verification.
    // Defaults to false (verify) unless the user enabled insecure requests.
    allowInsecureCerts: getAllowInsecureCerts(),
  };
  RQProxyProvider.createInstance(
    proxyConfig,
    new RulesDataSource(),
    new LoggerService(),
  );
  window.proxy = RQProxyProvider.getInstance().proxy;
}

export function stopProxyServer() {
  if(window.proxy) {
    window.proxy.close();
  }
}

// this automatically stops the old server before starting the new one
export default async function startProxyServer(
  proxyPort?: number,
  shouldStartHelperServer = true
): Promise<IStartProxyResult> {
  // Check if proxy is already listening. If so, close it
  try {
    stopProxyServer();
    logger.log("A proxy server was closed");
  } catch (error) {
    Sentry.captureException(error);
    logger.log("A proxy server close req was made but no proxy was up");
  }
  const proxyIp = ip()!;
  const targetPort = proxyPort || getDefaultProxyPort();

  const result: IStartProxyResult = {
    success: true,
    port: targetPort,
    proxyIp,
  };

  // start the proxy server
  const FINAL_PROXY_PORT = await getNextAvailablePort(targetPort);
  if (!FINAL_PROXY_PORT) {
    result.success = false;
    return result;
  }
  result.port = FINAL_PROXY_PORT;

  global.rq.proxyServerStatus = { port: FINAL_PROXY_PORT };

  startProxyFromModule(result.port);

  // start the helper server if not already running
  if (shouldStartHelperServer) {
    const HELPER_SERVER_PORT = await getNextAvailablePort(
      DEFAULT_HELPER_SERVER_PORT
    );

    result.helperServerPort = HELPER_SERVER_PORT;

    if (!HELPER_SERVER_PORT) {
      result.success = false;
      return result;
    }
    await startHelperServer(HELPER_SERVER_PORT);
  }

  const HELPER_SOCKET_SERVER_PORT = await portfinder.getPortPromise({
    port: DEFAULT_SOCKET_SERVER_PORT,
    stopPort: DEFAULT_SOCKET_SERVER_PORT + 4, // 5 ports for fallback
  });
  startHelperSocketServer(HELPER_SOCKET_SERVER_PORT);

  // fix-me: this does not remove existing handlers when restarting. 
  // For now that doesn't have side effects
  addShutdownHandler(() => {
    stopProxyServer();
    stopHelperServer();
    stopHelperSocketServer();
  }) 

  return result;
}
