import { RPCServiceOverIPC } from "renderer/lib/RPCServiceOverIPC";
import { getAllWorkspaces, removeWorkspace } from "./fs-utils";
import { FsManagerRPCService } from "./fs-manager.rpc-service";
import { getNormalizedPath } from "./common-utils";
import { ErrorCode, FileSystemError, FileTypeEnum } from "./types";

// Local workspaces only held data for the in-app API client, which is deprecated: the web
// app shows a permanent migration modal. Existing workspaces can still be listed, opened
// (read-only) and removed, so their data stays reachable; creating or adding one is refused.
const localWorkspacesNotSupported = async (): Promise<FileSystemError> => ({
  type: "error",
  error: {
    message:
      "Local workspaces are no longer supported in this app. Use the Requestly API Client app.",
    path: "",
    fileType: FileTypeEnum.UNKNOWN,
    code: ErrorCode.NotPermitted,
  },
});

const isRegisteredWorkspace = async (rootPath: string): Promise<boolean> => {
  if (typeof rootPath !== "string" || !rootPath) {
    return false;
  }
  const result = await getAllWorkspaces();
  if (result.type !== "success") {
    return false;
  }
  const requested = getNormalizedPath(rootPath);
  return result.content.some(
    (workspace) => getNormalizedPath(workspace.path) === requested
  );
};

export class FsManagerBuilderRPCService extends RPCServiceOverIPC {
  static NAMESPACE = "local_sync_builder";

  private exposedWorkspacePaths = new Map<string, FsManagerRPCService>();

  constructor() {
    super(FsManagerBuilderRPCService.NAMESPACE);
    this.init();
  }

  init() {
    this.exposeMethodOverIPC("createWorkspaceFolder", localWorkspacesNotSupported);
    this.exposeMethodOverIPC("createDefaultWorkspace", localWorkspacesNotSupported);
    this.exposeMethodOverIPC("openExistingLocalWorkspace", localWorkspacesNotSupported);
    this.exposeMethodOverIPC("checkIsWorkspacePathAvailable", localWorkspacesNotSupported);
    this.exposeMethodOverIPC("getAllWorkspaces", getAllWorkspaces);
    this.exposeMethodOverIPC("removeWorkspace", removeWorkspace);
    this.exposeMethodOverIPC("build", this.build.bind(this));
    this.exposeMethodOverIPC("reload", this.reload.bind(this));
  }

  async build(rootPath: string) {
    // Only a workspace already in the global config: the web app must not be able to
    // open a file service on an arbitrary folder.
    if (!(await isRegisteredWorkspace(rootPath))) {
      throw new Error("Not a registered local workspace");
    }
    if (this.exposedWorkspacePaths.has(rootPath)) {
      console.log("not building again");
      return;
    }
    const manager = new FsManagerRPCService(
      rootPath,
      this.exposedWorkspacePaths
    );
    await manager.init();
    this.exposedWorkspacePaths.set(rootPath, manager);
  }

  async reload(rootPath: string) {
    const manager = this.exposedWorkspacePaths.get(rootPath);
    if (!manager) {
      throw new Error(`FsManager not found for root path: ${rootPath}`);
    }
    manager.reload();
  }
}
