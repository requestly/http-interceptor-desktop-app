import {USER_PREFERENCE} from "../types/action-types";
import { StorageAction } from "../types/storage-action";
import BaseActionProcessor from "./base";
import StoreWrapper from "../store-wrapper";

class UserPreferenceActionProcessor extends BaseActionProcessor {
  constructor(store: StoreWrapper) {
    super(store);
  }
  private updateKeyInLogConfig = (key: any, value: any) => {
    const loggingConfig = this.store.get("localFileLogConfig") ?? {}
    this.store.set({
      localFileLogConfig: {
        ...loggingConfig,
        [key]: value
      }
    })
  }
  private getKeyFromLogingConfig = (key: any) => {
    const loggingConfig = this.store.get("localFileLogConfig")
    if(loggingConfig) {
      return loggingConfig[key]
    }
    return undefined;
  }
  process = ({ type, payload }: StorageAction) => {
    switch(type) {
      case USER_PREFERENCE.GET_ALL:
        return this.store.getAll()
      case USER_PREFERENCE.GET_DEFAULT_PORT:
        return this.store.get("defaultPort")
      case USER_PREFERENCE.UPDATE_DEFAULT_PORT:
        this.store.set({"defaultPort": payload?.data})
        break;
      case USER_PREFERENCE.GET_ALLOW_INSECURE_CERTS:
        return !!this.store.get("allowInsecureCerts")
      case USER_PREFERENCE.UPDATE_ALLOW_INSECURE_CERTS: {
        // RQ-2425: fail CLOSED. Only enable insecure TLS for an explicit boolean
        // `true`, or a recognized truthy boolean-string (IPC may serialize
        // booleans). A missing key, object, or unknown value stays `false`
        // (secure). The previous `?? payload?.data` fallback made `{}` truthy and
        // could silently enable insecure TLS.
        // @ts-ignore
        const raw = payload?.data?.allowInsecureCerts;
        let value = false;
        if (typeof raw === "boolean") {
          value = raw;
        } else if (typeof raw === "string") {
          value = raw === "true" || raw === "1";
        }
        this.store.set({ allowInsecureCerts: value })
        break;
      }
      case USER_PREFERENCE.GET_COMPLETE_LOGGING_CONFIG:
        return this.store.get("localFileLogConfig")

      case USER_PREFERENCE.GET_IS_LOGGING_ENABLED: {
        return !!this.getKeyFromLogingConfig("isEnabled")
      }
      case USER_PREFERENCE.GET_LOCAL_LOG_STORE_PATH: {
        return this.getKeyFromLogingConfig("storePath") ?? ""
      }
      case USER_PREFERENCE.GET_LOG_FILTER: {
        return this.getKeyFromLogingConfig("filter") ?? []
      }
      
      case USER_PREFERENCE.SET_IS_LOGGING_ENABLED: {
        // @ts-ignore
        let isEnabledPayload = payload?.data?.isLocalLoggingEnabled
        if (typeof isEnabledPayload === "boolean") {
          this.updateKeyInLogConfig("isEnabled", isEnabledPayload)
        }

        if(typeof isEnabledPayload === "string") { // serialization in IPC
          if(
            isEnabledPayload === "false" || 
            isEnabledPayload === "0"
          ) {
            this.updateKeyInLogConfig("isEnabled", false)
          } else {
            this.updateKeyInLogConfig("isEnabled", true)
          }
        }

        break;
      }
      case USER_PREFERENCE.SET_STORE_PATH:
        // @ts-ignore
        const storePath = payload?.data?.logStorePath
        if (storePath) {
          this.updateKeyInLogConfig("storePath", storePath)
        }
        break;
      case USER_PREFERENCE.SET_FILTER:
        // @ts-ignore
        const filter = payload?.data?.localLogFilterfilter
        if (filter) {
          this.updateKeyInLogConfig("filter", filter)
        }
        break;

      default:
        console.log("unexpected user preference action", type, payload)
    }
  };
}

export default UserPreferenceActionProcessor