import { RPCServiceOverIPC } from "renderer/lib/RPCServiceOverIPC";
import { FsManager } from "./fs-manager";

async function waitForInit() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(""), 800);
  });
}

export class FsManagerRPCService extends RPCServiceOverIPC {
  private fsManager: FsManager;

  constructor(
    readonly rootPath: string,
    readonly exposedWorkspacePaths: Map<string, unknown>
  ) {
    super(`local_sync: ${rootPath}`);
    this.fsManager = new FsManager(rootPath, this.exposedWorkspacePaths);
  }

  reload() {
    this.fsManager.reload();
  }

  async init(): Promise<void> {
    try {
      await this.fsManager.init();
    } catch (error) {
      // console.log("FsManagerRPCService init", error);
      throw new Error(
        `Failed to initialize FsManager for ${this.rootPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.exposeMethodOverIPC(
      "getAllRecords",
      this.fsManager.getAllRecords.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "getRecord",
      this.fsManager.getRecord.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "getCollection",
      this.fsManager.getCollection.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "getAllEnvironments",
      this.fsManager.getAllEnvironments.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "getRawFileData",
      this.fsManager.getRawFileData.bind(this.fsManager)
    );

    // hack
    await waitForInit();
  }
}
