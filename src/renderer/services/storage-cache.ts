import { RQProxyProvider } from "@requestly/requestly-proxy";
import { ipcRenderer } from "electron";
import storageService from "lib/storage";
import { STORE_NAME } from "lib/storage/constants";
import ACTION_TYPES from "lib/storage/types/action-types";
import startProxyServer from "renderer/actions/proxy/startProxyServer";

class StorageCacheService {
  constructor() {
    this.init();
  }

  init = () => {
    this.updateCache(STORE_NAME.SSL_PROXYING);
    this.updateCache(STORE_NAME.USER_PREFERENCE);
  };

  updateCache = (storeName: string) => {
    if (!storeName) {
      console.log("Storage Name not provided");
    }

    switch (storeName) {
      case STORE_NAME.SSL_PROXYING:
        global.rq.sslProxyingStorage = storageService.processAction({
          type: ACTION_TYPES.SSL_PROXYING.GET_ALL,
        });
        console.log(`Updated ${storeName} cache`);

        // Hack: For timing out tunnel in case of inclusionList/ExclusionList Change
        this.destroySSLTunnels();
        break;
      case STORE_NAME.USER_PREFERENCE:
        const newUserPreferences = storageService.processAction({
          type: ACTION_TYPES.USER_PREFERENCE.GET_ALL,
        })
        global.rq.userPreferences = newUserPreferences
        console.log(`Updated ${storeName} cache`);

        // RQ-2425: apply the "allow insecure SSL" toggle live on the running
        // proxy — no proxy/app restart needed.
        let appliedLive = false;
        try {
          const rqProxy: any = RQProxyProvider.getInstance();
          if (rqProxy?.setAllowInsecureCerts) {
            rqProxy.setAllowInsecureCerts(!!newUserPreferences?.allowInsecureCerts);
            appliedLive = true;
          }
        } catch (e) {
          console.log("Failed to apply allowInsecureCerts live", e);
        }

        // Restart the proxy only when the port actually changed (or as a fallback
        // when settings couldn't be applied live, e.g. an older proxy build).
        const newPort = newUserPreferences?.defaultPort;
        const currentPort = global.rq.proxyServerStatus?.port;
        if ((newPort && currentPort && newPort !== currentPort) || !appliedLive) {
          this.restartProxyServer(newPort)
        }
        break;
      default:
        console.log(`${storeName} cache not found`);
    }
  };

  getCache = (storeName: STORE_NAME) => {
    if (!storeName) {
      console.log("Storage Name not provided");
    }

    switch (storeName) {
      case STORE_NAME.SSL_PROXYING:
        return global.rq.sslProxyingStorage;
      case STORE_NAME.USER_PREFERENCE:
        return global.rq.userPreferences;
      default:
        console.log(`${storeName} cache not found`);
    }

    return;
  };

  destroySSLTunnels = () => {
    // Check if behvaiour breaks when working with multiple tunnels
    console.log("Destroying tunnels");
    console.log(global.rq.sslTunnelingSocketsMap);
    Object.values(global.rq.sslTunnelingSocketsMap || {}).forEach((socket) => {
      try {
        console.log("Tunnel destroyed");
        socket.destroy();
      } catch {
        console.log("Failed to destroy tunnel");
      }
    });
    global.rq.sslTunnelingSocketsMap = {};
  };

  restartProxyServer = async (port: number) => {
    // check to not trigger restart when proxy has not even started yet
    if(RQProxyProvider.rqProxyInstance){
      console.log("restarting proxy server on new port")
      const result = await startProxyServer(port, false)
      if(result.success) {
        ipcRenderer.invoke("proxy-restarted", {
          port: result.port,
          proxyIp: result.proxyIp
        })
      }
    }
  }
}

const storageCacheService = new StorageCacheService();
export default storageCacheService;
