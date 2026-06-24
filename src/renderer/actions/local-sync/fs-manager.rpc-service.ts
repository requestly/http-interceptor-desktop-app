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
      "createRecord",
      this.fsManager.createRecord.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "createRecordWithId",
      this.fsManager.createRecordWithId.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "updateRecord",
      this.fsManager.updateRecord.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "deleteRecord",
      this.fsManager.deleteRecord.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "deleteRecords",
      this.fsManager.deleteRecords.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "moveRecord",
      this.fsManager.moveRecord.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "moveRecords",
      this.fsManager.moveRecords.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "getCollection",
      this.fsManager.getCollection.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "createCollection",
      this.fsManager.createCollection.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "createCollectionWithId",
      this.fsManager.createCollectionWithId.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "deleteCollection",
      this.fsManager.deleteCollection.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "deleteCollections",
      this.fsManager.deleteCollections.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "renameCollection",
      this.fsManager.renameCollection.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "moveCollection",
      this.fsManager.moveCollection.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "moveCollections",
      this.fsManager.moveCollections.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "setCollectionVariables",
      this.fsManager.setCollectionVariables.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "getAllEnvironments",
      this.fsManager.getAllEnvironments.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "createEnvironment",
      this.fsManager.createEnvironment.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "updateEnvironment",
      this.fsManager.updateEnvironment.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "duplicateEnvironment",
      this.fsManager.duplicateEnvironment.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "updateCollectionDescription",
      this.fsManager.updateCollectionDescription.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "updateCollectionAuthData",
      this.fsManager.updateCollectionAuthData.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "writeRawRecord",
      this.fsManager.writeRawRecord.bind(this.fsManager)
    );
    this.exposeMethodOverIPC(
      "getRawFileData",
      this.fsManager.getRawFileData.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "createCollectionFromCompleteRecord",
      this.fsManager.createCollectionFromCompleteRecord.bind(this.fsManager)
    );

    this.exposeMethodOverIPC(
      "excludeFile",
      this.fsManager.excludeFile.bind(this.fsManager)
    );

    // hack
    await waitForInit();
  }
}
