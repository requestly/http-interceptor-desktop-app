import axios, { AxiosInstance } from "axios";
import { readFileSync } from "fs";
import { HttpsProxyAgent, HttpsProxyAgentOptions } from "https-proxy-agent";
import { ClientRequest, RequestOptions } from "agent-base";
import { Socket } from "net";
import http from "http";
import https from "https";
import {
  addCookiesToRequest,
  storeCookiesFromResponse,
} from "./cookiesHelpers";

const LOCAL_IPV4 = "127.0.0.1";
const LOCAL_IPV6 = "::1";
const LOCAL_UNSPECIFIED = "0.0.0.0";

const checkConnection = (host: string, port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new Socket();
    const timeout = 1000;

    socket.setTimeout(timeout);

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
};


const createLocalhostLookup = async (port: number) => {
  const ipv6Works = await checkConnection(LOCAL_IPV6, port).catch(() => false);
  const targetIp = ipv6Works ? LOCAL_IPV6 : LOCAL_IPV4;
  const targetFamily = ipv6Works ? 6 : 4;

  return (_lookupHostname: string, _options: any, callback: any) => {
    callback(null, targetIp, targetFamily);
  };
};

class PatchedHttpsProxyAgent extends HttpsProxyAgent {
  ca: unknown;

  constructor(opts: HttpsProxyAgentOptions) {
    super(opts);
    this.ca = opts.ca;
  }

  async callback(req: ClientRequest, opts: RequestOptions) {
    return super.callback(req, Object.assign(opts, { ca: this.ca }));
  }
}

interface ProxyConfig {
  ip: string;
  port: number;
  rootCertPath: string;
}

let proxiedAxios: AxiosInstance;
let proxiedAxiosWithSessionCookies: AxiosInstance;
let proxyConfig: ProxyConfig;

function createAxiosInstance(
  config: ProxyConfig,
  enableRQProxy: boolean = false,
  addStoredCookies: boolean = false
): AxiosInstance {
  let instance: AxiosInstance;
  if (enableRQProxy) {
    instance = axios.create({
      proxy: false,
      httpAgent: new HttpsProxyAgent(`http://${config.ip}:${config.port}`),
      httpsAgent: new PatchedHttpsProxyAgent({
        host: config.ip,
        port: config.port,
        ca: readFileSync(config.rootCertPath),
      }),
    });
  } else {
    instance = axios.create({ proxy: false });

    instance.interceptors.request.use(async (requestConfig: any) => {
      const { url: requestUrl, sslVerificationDisabled } = requestConfig;

      if (!requestUrl) {
        return requestConfig;
      }

      const url = new URL(requestUrl);
      const { hostname, port: urlPort, protocol } = url;
      const port = urlPort ? parseInt(urlPort, 10) : (protocol === "https:" ? 443 : 80);

      const isLocalhost = hostname === "localhost" 
        || hostname === LOCAL_IPV4
        || hostname === `[${LOCAL_IPV6}]`
        || hostname === LOCAL_UNSPECIFIED;

      if (isLocalhost) {
        const lookup = await createLocalhostLookup(port);
        const agentOptions = {
          lookup,
          rejectUnauthorized: sslVerificationDisabled !== true, // false = skip SSL verification, true = enforce certificate validation
        };

        requestConfig.httpAgent = new http.Agent({ lookup });
        requestConfig.httpsAgent = new https.Agent(agentOptions);

        // Node.js skips DNS lookup for raw IP literals, so the custom lookup
        // above has no effect. Rewrite the URL to the concrete working IP.
        if (hostname !== "localhost") {
          const ipv6Works = await checkConnection(LOCAL_IPV6, port).catch(() => false);
          const targetIp = ipv6Works ? `[${LOCAL_IPV6}]` : LOCAL_IPV4;

          if (hostname !== targetIp) {
            requestConfig.url = requestUrl.replace(hostname, targetIp);
          }
        }
      } else if (sslVerificationDisabled) {
          // Handle standard web requests where SSL is bypassed
        requestConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
      }

      return requestConfig;
    });
  }

  instance.interceptors.response.use(storeCookiesFromResponse);
  if (addStoredCookies) {
    instance.interceptors.request.use(addCookiesToRequest);
  }
  return instance;
}

export const createOrUpdateAxiosInstance = (
  newProxyConfig: ProxyConfig
): AxiosInstance => {
  proxyConfig = {
    ...(proxyConfig || {}),
    ...newProxyConfig,
  };

  try {
    proxiedAxios = createAxiosInstance(proxyConfig, false);
    proxiedAxiosWithSessionCookies = createAxiosInstance(
      proxyConfig,
      false,
      true
    );
  } catch (error) {
    /* Do nothing */
    console.error("Error creating or updating Axios instance:", error);
  }

  return proxiedAxios;
};

/* 
[Intentional] add cookies by default. In line with emulating browser behaviour.
  A better name could be excludeCredentials=false .
  did this because a flag called `withCredentials` has now been released for extension
*/
const getProxiedAxios = (includeCredentials: boolean = true): AxiosInstance => {
  if (includeCredentials)
    return proxiedAxiosWithSessionCookies ?? proxiedAxios ?? axios;
  return proxiedAxios ?? axios;
};

export default getProxiedAxios;
