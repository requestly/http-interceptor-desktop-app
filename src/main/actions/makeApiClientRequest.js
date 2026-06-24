import getProxiedAxios from "./getProxiedAxios";
import AdvancedFormData from "form-data";

const fs = require("fs");

const makeApiClientRequest = async ({ apiRequest }) => {
  try {
    const { method = "GET" } = apiRequest;
    let headers = {};
    let { body, url } = apiRequest;

    if (apiRequest?.queryParams.length) {
      const urlObj = new URL(apiRequest.url);
      const searchParams = new URLSearchParams(urlObj.search);
      apiRequest.queryParams.forEach(({ key, value }) => {
        searchParams.append(key, value);
      });
      urlObj.search = searchParams.toString();
      url = urlObj.toString();
    }

    apiRequest?.headers.forEach(({ key, value }) => {
      headers[key] = value;
    });

    if (apiRequest.contentType === "application/x-www-form-urlencoded") {
      const formData = new FormData();
      body?.forEach(({ key, value }) => {
        formData.append(key, value);
      });
      body = new URLSearchParams(formData);
    }

    if (apiRequest.body && apiRequest.contentType === "multipart/form-data") {
      const formData = new AdvancedFormData();
      apiRequest.body.forEach(({ key, value }) => {
        if (Array.isArray(value)) {
          const files = value
            .map((entry) => {
              const stream = entry?.path
                ? fs.createReadStream(entry.path)
                : null;
              if (stream) {
                return {
                  stream,
                  fileName: entry.name || entry.path.split("/").pop(),
                };
              }
              return null;
            })
            .filter(Boolean);
          files.forEach(({ stream, fileName }) => {
            try {
              formData.append(key, stream, fileName);
            } catch (error) {
              console.error(
                `Error appending file to formData for key ${key}:`,
                error
              );
            }
          });
        } else {
          formData.append(key, value);
        }
      });
      body = formData;
      headers = {
        "content-type": `${formData.getHeaders()}`,
        ...headers,
      };
    }

    const requestStartTime = performance.now();
    const axios = getProxiedAxios(apiRequest.includeCredentials);

    const hasJsonContentType = (() => {
      const contentTypeHeader = Object.keys(headers).find(
        (key) => key.toLowerCase() === "content-type"
      );

      return headers[contentTypeHeader]
        ?.toLowerCase()
        ?.includes("application/json");
    })();

    let transformRequest;

    // Body would always be a string here but to double check
    if (hasJsonContentType && typeof body === "string") {
      try {
        JSON.parse(body);
        // Valid JSON → let axios handle it (default behavior of transformRequest)
      } catch {
        // Invalid JSON → bypass axios to send raw
        // otherwise axios will double stringify the body to make it a valid JSON string
        transformRequest = [(data) => data];
      }
    }

    const response = await axios({
      url,
      method,
      headers,
      data: body,
      transformRequest,
      responseType: "arraybuffer",
      withCredentials: false,
      validateStatus: () => {
        return true;
      },
      // Pass the SSL flag down for the interceptor to handle
      sslVerificationDisabled: apiRequest.sslVerificationDisabled === true,
    });
    const responseTime = performance.now() - requestStartTime;

    const responseHeaders = [];
    Object.entries(response.headers).forEach(([key, value]) => {
      responseHeaders.push({ key, value });
    });

    const contentType = responseHeaders.find(
      (header) => header.key.toLowerCase() === "content-type"
    )?.value;

    let responseBody;

    if (contentType?.includes("image/")) {
      const raw = Buffer.from(response.data).toString("base64");
      responseBody = `data:${contentType};base64,${raw}`;
    } else {
      responseBody = new TextDecoder().decode(response.data);
    }

    const responseURL = response.request?.res?.responseUrl;

    return {
      body: responseBody,
      time: responseTime,
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
      redirectedUrl: responseURL !== url ? responseURL : "",
    };
  } catch (e) {
    console.log("Error while making api client request", e);
    return {
      error: e.message,
    };
  }
};

export default makeApiClientRequest;
