import { captureException } from "@sentry/browser";
import { ipcRenderer } from "electron";

/**
 * Used to create a RPC like service in the Background process.
 * Has a corresponding Adapter class in the webapp repository.
 * --------------------------------
 * - Expects each RPC method to be exposed individually using `exposeMethodOverIPC`.
 * - Requires Arguments and Responses of those methods to be serializable. (limitation imposed by electron IPC)
 * - Currently only allows one generic fire-and-forget event channel for the service to send events to the webapp -> relayed over "send-from-background-to-webapp" channel.
 */
export class RPCServiceOverIPC {
  private RPC_CHANNEL_PREFIX: string;

  private LIVE_EVENTS_CHANNEL: string;

  constructor(serviceName: string) {
    this.RPC_CHANNEL_PREFIX = `${serviceName}-`;
    this.LIVE_EVENTS_CHANNEL = `SERVICE-${serviceName}-LIVE-EVENTS`;
  }

  generateChannelNameForMethod(method: Function) {
    return `${this.RPC_CHANNEL_PREFIX}${method.name}`;
  }

  protected exposeMethodOverIPC(
    exposedMethodName: string,
    method: (..._args: any[]) => Promise<any>
  ) {
    const channelName = `${this.RPC_CHANNEL_PREFIX}${exposedMethodName}`;
    ipcRenderer.on(channelName, async (_event, incomingData) => {
      // Detect new envelope format { payload, replyChannel } vs old direct payload format
      const hasNewFormat =
        incomingData != null &&
        typeof incomingData === "object" &&
        !Array.isArray(incomingData) &&
        "replyChannel" in incomingData;

      const actualArgs = hasNewFormat ? incomingData.payload : incomingData;
      const actualReplyChannel = hasNewFormat
        ? incomingData.replyChannel
        : `reply-${channelName}`;

      try {
        const result = await method(
          ...(Array.isArray(actualArgs) ? actualArgs : [actualArgs])
        );

        ipcRenderer.send(actualReplyChannel, {
          success: true,
          data: result,
        });
      } catch (error: any) {
        captureException(error);
        ipcRenderer.send(actualReplyChannel, {
          success: false,
          data: error.message,
        });
      }
    });
  }

  sendServiceEvent(event: any) {
    return ipcRenderer.send("send-from-background-to-webapp", {
      channel: this.LIVE_EVENTS_CHANNEL,
      payload: event,
    });
  }
}
