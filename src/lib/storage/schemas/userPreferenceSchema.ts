import { DEFAULT_PROXY_PORT, DEFAULT_LOCAL_FILE_LOG_CONFIG } from "../constants";

export const userPreferenceSchema = {
  defaultPort: {
    type: "number",
    default: DEFAULT_PROXY_PORT
  },

  // RQ-2425: when true, the proxy skips upstream TLS certificate verification
  // (lets users reach self-signed / internal upstreams). Secure (false) by default.
  allowInsecureCerts: {
    type: "boolean",
    default: false
  },

  localFileLogConfig: {
    type: "object",
    properties: {
      isEnabled: {
        type: "boolean",
      },
      storePath: {
        type: "string",
      },
      filter: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    default: DEFAULT_LOCAL_FILE_LOG_CONFIG,
  }
}