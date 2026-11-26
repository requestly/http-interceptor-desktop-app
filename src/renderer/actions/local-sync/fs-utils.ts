import {
  API,
  APIEntity,
  Collection,
  Environment,
  EnvironmentVariableValue,
  ErrorCode,
  FileResource,
  FileSystemResult,
  FileTypeEnum,
  FolderResource,
  FsResource,
  UnwrappedPromise,
} from "./types";
import {
  appendPath,
  createFileSystemError,
  createFsResource,
  getIdFromPath,
  getNameOfResource,
  getNormalizedPath,
  parseRaw,
} from "./common-utils";
import {
  COLLECTION_AUTH_FILE,
  COLLECTION_VARIABLES_FILE,
  CONFIG_FILE,
  CORE_CONFIG_FILE_VERSION,
  DESCRIPTION_FILE,
  DS_STORE_FILE,
  ENVIRONMENT_VARIABLES_FOLDER,
  GIT_FOLDER,
  GIT_IGNORE_FILE,
  GLOBAL_CONFIG_FILE_NAME,
  GLOBAL_CONFIG_FOLDER_PATH,
  GLOBAL_ENV_FILE,
} from "./constants";
import { Static, TSchema } from "@sinclair/typebox";
import {
  EnvironmentRecord,
  Variables,
  EnvironmentVariableType,
  Auth,
  GlobalConfig,
  ApiRecord,
  AuthType,
} from "./schemas";
import { Stats } from "node:fs";
import { FileType } from "./file-types/file-type.interface";
import {
  ApiRecordFileType,
  AuthRecordFileType,
  CollectionVariablesRecordFileType,
  EnvironmentRecordFileType,
  GlobalConfigRecordFileType,
  ReadmeRecordFileType,
} from "./file-types/file-types";
import path from "node:path";
import { FsService } from "./fs/fs.service";
import type { FsIgnoreManager } from "./fsIgnore-manager";
import { fileIndex } from "./file-index";

// TODO: Fix the delimiters added by electron on file paths
function sanitizePath(rawPath: string) {
  return rawPath;
}

export async function getFsResourceStats(
  resource: FsResource
): Promise<FileSystemResult<Stats>> {
  try {
    const pathStats = await FsService.lstat(resource.path);
    return {
      type: "success",
      content: pathStats,
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}



export async function getIfFolderExists(resource: FolderResource) {
  const statsResult = await getFsResourceStats(resource);
  const doesFolderExist =
    statsResult.type === "error" ? false : statsResult.content.isDirectory();
  return doesFolderExist;
}

export async function getIfFileExists(resource: FileResource) {
  const statsResult = await getFsResourceStats(resource);
  const doesFileExist =
    statsResult.type === "error" ? false : statsResult.content.isFile();
  return doesFileExist;
}

async function hasWorkspaceConfigInAncestors(
  dirPath: string
): Promise<boolean> {
  let currentDir = sanitizePath(dirPath);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const configPath = appendPath(currentDir, CONFIG_FILE);

    const doesConfigFileExist = await getIfFileExists(createFsResource({
      rootPath: currentDir,
      path: configPath,
      type: "file",
    }));


    if (doesConfigFileExist) {
      return true;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return false;
}

export async function deleteFsResource(
  resource: FsResource
): Promise<FileSystemResult<{ resource: FsResource }>> {
  try {
    if (resource.type === "file") {
      const exists = await getIfFileExists(resource);
      if (!exists) {
        return {
          type: "success",
          content: {
            resource,
          },
        };
      }
      await FsService.unlink(resource.path);
      fileIndex.remove({
        type: "path",
        path: resource.path,
      });
    } else {
      const exists = await getIfFolderExists(resource);
      if (!exists) {
        return {
          type: "success",
          content: {
            resource,
          },
        };
      }
      await FsService.rmdir(resource.path, { recursive: true });
      fileIndex.remove({
        type: "path",
        path: resource.path,
      });
    }
    return {
      type: "success",
      content: {
        resource,
      },
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}

export async function createFolder(
  resource: FolderResource,
  options?: {
    errorIfExist?: boolean;
    createWithElevatedAccess?: boolean;
    useId?: string;
  }
): Promise<FileSystemResult<{ resource: FolderResource }>> {
  const { errorIfExist = false, createWithElevatedAccess = false } =
    options || {};
  try {
    const statsResult = await getFsResourceStats(resource);
    const doesFolderExist =
      statsResult.type === "error" ? false : statsResult.content.isDirectory();

    if (!doesFolderExist) {
      if (createWithElevatedAccess) {
        await FsService.mkdirWithElevatedAccess(resource.path, {
          recursive: true,
        });
      } else {
        await FsService.mkdir(resource.path, { recursive: true });
      }

      if (options?.useId) {
        fileIndex.addIdPath(options.useId, resource.path);
      } else {
        fileIndex.getId(resource.path);
      }
    } else if (errorIfExist) {
      return createFileSystemError(
        { message: "Folder already exists!" },
        resource.path,
        FileTypeEnum.UNKNOWN
      );
    }
    return {
      type: "success",
      content: {
        resource,
      },
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}

export async function rename<T extends FsResource>(
  oldResource: T,
  newResource: T
): Promise<FileSystemResult<T>> {
  try {
    const alreadyExists = await (async () => {
      if (newResource.type === "folder") {
        return getIfFolderExists(newResource);
      }
      return getIfFileExists(newResource);
    })();
    const isSamePath =
      getNormalizedPath(oldResource.path).toLowerCase() ===
      getNormalizedPath(newResource.path).toLowerCase();
    if (!isSamePath && alreadyExists) {
      return {
        type: "error",
        error: {
          message: "Entity already exists!",
          fileType: FileTypeEnum.UNKNOWN,
          path: newResource.path,
          code: ErrorCode.EntityAlreadyExists,
        },
      };
    }
    await FsService.rename(oldResource.path, newResource.path);
    fileIndex.movePath(oldResource.path, newResource.path);
    return {
      type: "success",
      content: newResource,
    } as FileSystemResult<T>;
  } catch (e: any) {
    return createFileSystemError(e, oldResource.path, FileTypeEnum.UNKNOWN);
  }
}

export async function copyRecursive<T extends FsResource>(
  sourceResource: T,
  destinationResource: T
): Promise<FileSystemResult<T>> {
  try {
    await FsService.cp(sourceResource.path, destinationResource.path, {
      recursive: true,
    });
    return {
      type: "success",
      content: destinationResource,
    } as FileSystemResult<T>;
  } catch (e: any) {
    return createFileSystemError(e, sourceResource.path, FileTypeEnum.UNKNOWN);
  }
}

export function serializeContentForWriting(content: string | Record<any, any>) {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content, null, 2);
}

export async function writeContent(
  resource: FileResource,
  content: Record<any, any> | string,
  fileType: FileType<any>,
  options?: {
    writeWithElevatedAccess?: boolean;
    performExistenceCheck?: boolean;
    useId?: string;
  }
): Promise<FileSystemResult<{ resource: FileResource }>> {
  try {
    const { writeWithElevatedAccess = false, performExistenceCheck = false } =
      options || {};

    if (performExistenceCheck) {
      const alreadyExists = await getIfFileExists(resource);
      if (alreadyExists) {
        return {
          type: "error",
          error: {
            message: "Entity already exists!",
            fileType: fileType.type,
            path: resource.path,
            code: ErrorCode.EntityAlreadyExists,
          },
        };
      }
    }

    const parsedContentResult = parseRaw(content, fileType.validator);
    if (parsedContentResult.type === "error") {
      return createFileSystemError(
        { message: parsedContentResult.error.message },
        resource.path,
        fileType.type
      );
    }

    console.log("writing at", resource.path);
    const serializedContent = serializeContentForWriting(content);
    if (writeWithElevatedAccess) {
      await FsService.writeFileWithElevatedAccess(
        resource.path,
        serializedContent
      );
    } else {
      await FsService.writeFile(resource.path, serializedContent);
    }
    if (options?.useId) {
      fileIndex.addIdPath(options.useId, resource.path);
    } else {
      fileIndex.getId(resource.path);
    }
    return {
      type: "success",
      content: {
        resource,
      },
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, fileType.type);
  }
}

export async function writeContentRaw(
  resource: FileResource,
  content: Record<any, any> | string,
  options?: {
    writeWithElevatedAccess?: boolean;
    useId?: string;
  }
): Promise<FileSystemResult<{ resource: FileResource }>> {
  try {
    const { writeWithElevatedAccess = false } = options || {};
    const serializedContent = serializeContentForWriting(content);

    console.log("writing at", resource.path);
    if (writeWithElevatedAccess) {
      await FsService.writeFileWithElevatedAccess(
        resource.path,
        serializedContent
      );
    } else {
      await FsService.writeFile(resource.path, serializedContent);
    }
    if (options?.useId) {
      fileIndex.addIdPath(options.useId, resource.path);
    } else {
      fileIndex.getId(resource.path);
    }

    return {
      type: "success",
      content: {
        resource,
      },
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}

export function readFileSync(pathToRead: string): FileSystemResult<string> {
  try {
    return {
      type: "success",
      content: FsService.readFileSync(pathToRead).toString(),
    };
  } catch (e: any) {
    return createFileSystemError(e, pathToRead, FileTypeEnum.UNKNOWN);
  }
}

export async function readdir(
  pathToRead: string
): Promise<
  FileSystemResult<UnwrappedPromise<ReturnType<typeof FsService.readdir>>>
> {
  try {
    return {
      type: "success",
      content: await FsService.readdir(pathToRead),
    };
  } catch (e: any) {
    return createFileSystemError(e, pathToRead, FileTypeEnum.UNKNOWN);
  }
}

export async function stat(
  pathToRead: string
): Promise<FileSystemResult<Stats>> {
  try {
    return {
      type: "success",
      content: await FsService.stat(pathToRead),
    };
  } catch (e: any) {
    return createFileSystemError(e, pathToRead, FileTypeEnum.UNKNOWN);
  }
}

export async function parseFile<
  V extends TSchema,
  F extends FileType<V>
>(params: {
  resource: FileResource;
  fileType: F;
}): Promise<FileSystemResult<Static<F["validator"]>>> {
  const { resource, fileType } = params;
  try {
    const content = (await FsService.readFile(resource.path)).toString();
    const parsedContentResult = fileType.parse(content);
    if (parsedContentResult.type === "error") {
      return createFileSystemError(
        { message: parsedContentResult.error.message },
        resource.path,
        fileType.type
      );
    }
    return parsedContentResult;
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}

export async function parseFileRaw(params: {
  resource: FileResource;
}): Promise<FileSystemResult<string>> {
  const { resource } = params;
  try {
    const content = (await FsService.readFile(resource.path)).toString();
    return {
      type: "success",
      content,
    };
  } catch (e: any) {
    return createFileSystemError(e, resource.path, FileTypeEnum.UNKNOWN);
  }
}

/* NOTE: This is the ONLY function that should write to the global config file.
         All global config mutations must go through this writer to avoid
         partial writes & concurrency issues. */
async function writeToGlobalConfig(
  config: Static<typeof GlobalConfig>
): Promise<FileSystemResult<{ resource: FileResource }>> {
  const originalPath = appendPath(
    GLOBAL_CONFIG_FOLDER_PATH,
    GLOBAL_CONFIG_FILE_NAME
  );
  const serialized = serializeContentForWriting(config);
  const globalConfigFileResource = createFsResource({
    rootPath: GLOBAL_CONFIG_FOLDER_PATH,
    path: originalPath,
    type: "file",
  });

  try {
    await FsService.mkdir(GLOBAL_CONFIG_FOLDER_PATH, { recursive: true });
  } catch (e: any) {
    return createFileSystemError(
      e,
      GLOBAL_CONFIG_FOLDER_PATH,
      FileTypeEnum.GLOBAL_CONFIG
    );
  }

  try {
    await FsService.writeFileWithElevatedAccess(originalPath, serialized);
  } catch (e: any) {
    return createFileSystemError(e, originalPath, FileTypeEnum.GLOBAL_CONFIG);
  }

  return {
    type: "success",
    content: { resource: globalConfigFileResource },
  };
}

async function getWorkspaceIdFromConfig(
  workspaceFolderPath: string | null
): Promise<string | null> {
  const globalConfigFileResource = createFsResource({
    rootPath: GLOBAL_CONFIG_FOLDER_PATH,
    path: appendPath(GLOBAL_CONFIG_FOLDER_PATH, GLOBAL_CONFIG_FILE_NAME),
    type: "file",
  });
  const readResult = await parseFile({
    resource: globalConfigFileResource,
    fileType: new GlobalConfigRecordFileType(),
  });

  if (readResult.type === "error") {
    return null;
  }
  const config = readResult.content;
  /**
   * NOTE: We need to normalize the path to ensure that the path is the same as the path in the config for comparison.
   * This is because the path may be passed in with different delimiters on different platforms.
   * For example, on Windows the path is passed with backslashes, while on Unix the path is passed with forward slashes, comparing them directly will fail.
   */
  const workspace = config.workspaces.find(
    (ws) => ws.path.replace(/[/\\]/g, '/') === workspaceFolderPath?.replace(/[/\\]/g, '/')
  );
  if (!workspace) {
    return null;
  }
  return workspace.id;
}


export async function createGlobalConfigFolder(): Promise<
  FileSystemResult<{ resource: FolderResource }>
> {
  try {
    return await createFolder(
      createFsResource({
        rootPath: GLOBAL_CONFIG_FOLDER_PATH,
        path: GLOBAL_CONFIG_FOLDER_PATH,
        type: "folder",
      }),
      {
        createWithElevatedAccess: true,
      }
    );
  } catch (e: any) {
    return createFileSystemError(
      e,
      GLOBAL_CONFIG_FOLDER_PATH,
      FileTypeEnum.UNKNOWN
    );
  }
}


export async function migrateGlobalConfig(oldConfig: any) {
  if (!oldConfig.version) {
    return {
      version: CORE_CONFIG_FILE_VERSION,
      workspaces: oldConfig,
    };
  }

  return oldConfig;
}

type WorkspaceValidationResult =
  | {
    valid: true;
    ws: Static<typeof GlobalConfig>["workspaces"][number];
  }
  | {
    valid: false;
    ws: Static<typeof GlobalConfig>["workspaces"][number];
    error: { message: string };
  };

async function validateWorkspace(
  ws: Static<typeof GlobalConfig>["workspaces"][number]
): Promise<WorkspaceValidationResult> {
  const prune = (message: string): WorkspaceValidationResult => {
    console.info(
      `[workspaces] Pruning workspace '${ws.name}' at '${ws.path}' (${message})`
    );
    return { valid: false, ws, error: { message } };
  };

  const workspacePath = (ws.path || "").trim();
  if (!workspacePath) {
    return prune("empty path entry");
  }

  if (!FsService.existsSync(workspacePath)) {
    return prune("path does not exist");
  }

  try {
    const dirStats = await FsService.lstat(workspacePath);
    if (!dirStats.isDirectory()) {
      return prune("not a directory");
    }
  } catch (e: any) {
    return prune(`failed to stat directory: ${e?.code || e?.message}`);
  }

  const configPath = appendPath(workspacePath, CONFIG_FILE);
  if (!FsService.existsSync(configPath)) {
    return prune(`missing '${CONFIG_FILE}'`);
  }

  try {
    const configStats = await FsService.lstat(configPath);
    if (!configStats.isFile()) {
      return prune(`'${CONFIG_FILE}' not a file`);
    }
  } catch (e: any) {
    return prune(`failed to stat '${CONFIG_FILE}': ${e?.code || e?.message}`);
  }

  return { valid: true, ws };
}

async function filterExistingWorkspaceFolders(
  workspaces: Static<typeof GlobalConfig>["workspaces"]
): Promise<{
  valid: Static<typeof GlobalConfig>["workspaces"];
  pruned: number;
}> {
  if (!workspaces.length) {
    return { valid: [], pruned: 0 };
  }

  const results = await Promise.all(workspaces.map(validateWorkspace));
  const valid = results.filter((r) => r.valid).map((r) => r.ws);

  return { valid, pruned: workspaces.length - valid.length };
}

export async function getAllWorkspaces(): Promise<
  FileSystemResult<Static<typeof GlobalConfig>["workspaces"]>
> {
  try {
    const globalConfigFileResource = createFsResource({
      rootPath: GLOBAL_CONFIG_FOLDER_PATH,
      path: appendPath(GLOBAL_CONFIG_FOLDER_PATH, GLOBAL_CONFIG_FILE_NAME),
      type: "file",
    });

    const readResult = await parseFileRaw({
      resource: globalConfigFileResource,
    });

    if (readResult.type === "error") {
      return readResult;
    }

    const { content } = readResult;
    const parsedContent: Static<typeof GlobalConfig> = JSON.parse(content);

    let effectiveConfig = parsedContent;
    if (parsedContent.version !== CORE_CONFIG_FILE_VERSION) {
      const migratedConfig = await migrateGlobalConfig(parsedContent);
      const migrateWriteResult = await writeToGlobalConfig(migratedConfig);
      if (migrateWriteResult.type === "error") {
        return migrateWriteResult;
      }
      effectiveConfig = migratedConfig;
    }

    const { valid, pruned } = await filterExistingWorkspaceFolders(
      effectiveConfig.workspaces
    );

    if (pruned > 0) {
      const updatedConfig: Static<typeof GlobalConfig> = {
        version: effectiveConfig.version || CORE_CONFIG_FILE_VERSION,
        workspaces: valid,
      };
      const pruneWriteResult = await writeToGlobalConfig(updatedConfig);
      if (pruneWriteResult.type === "error") {
        return pruneWriteResult;
      }
      return {
        type: "success",
        content: valid,
      };
    }

    return {
      type: "success",
      content: effectiveConfig.workspaces,
    };
  } catch (error: any) {
    return createFileSystemError(
      error,
      GLOBAL_CONFIG_FOLDER_PATH,
      FileTypeEnum.GLOBAL_CONFIG
    );
  }
}

export async function removeWorkspace(
  workspaceId: string,
  options: { deleteDirectory?: boolean } = {}
): Promise<FileSystemResult<void>> {
  try {
    const globalConfigFileResource = createFsResource({
      rootPath: GLOBAL_CONFIG_FOLDER_PATH,
      path: appendPath(GLOBAL_CONFIG_FOLDER_PATH, GLOBAL_CONFIG_FILE_NAME),
      type: "file",
    });

    const readResult = await parseFileRaw({
      resource: globalConfigFileResource,
    });

    if (readResult.type === "error") {
      // Global config missing is a catastrophic failure for local workspace operations.
      // Propagate the error (including NotFound) to callers.
      return readResult;
    }

    const config: Static<typeof GlobalConfig> = JSON.parse(readResult.content);

    const workspaceToRemove = config.workspaces.find(
      (ws) => ws.id === workspaceId
    );

    if (!workspaceToRemove) {
      // Workspace not found, so it's already "removed".
      return { type: "success" };
    }

    const updatedConfig: Static<typeof GlobalConfig> = {
      ...config,
      workspaces: config.workspaces.filter((ws) => ws.id !== workspaceId),
    };

    // First, write the updated global config. Only delete directory after success.
    const removeWriteResult = await writeToGlobalConfig(updatedConfig);
    if (removeWriteResult.type === "error") {
      return removeWriteResult;
    }

    if (options.deleteDirectory) {
      try {
        await FsService.rm(workspaceToRemove.path, {
          recursive: true,
          force: true,
        });
      } catch (e: any) {
        return createFileSystemError(
          e,
          workspaceToRemove.path,
          FileTypeEnum.UNKNOWN
        );
      }
    }

    return { type: "success" };
  } catch (error: any) {
    return createFileSystemError(
      error,
      GLOBAL_CONFIG_FOLDER_PATH,
      FileTypeEnum.GLOBAL_CONFIG
    );
  }
}

export function getParentFolderPath(fsResource: FsResource) {
  const { path: resourcePath } = fsResource;
  const parent = getNormalizedPath(path.dirname(resourcePath));
  return parent;
}

function getCollectionId(rootPath: string, fsResource: FsResource) {
  const parentPath = getParentFolderPath(fsResource);
  if (parentPath === rootPath) {
    return "";
  }

  return getIdFromPath(parentPath);
}

async function getCollectionVariables(
  rootPath: string,
  folder: FolderResource
): Promise<FileSystemResult<Static<typeof Variables>>> {
  const varsPath = appendPath(folder.path, COLLECTION_VARIABLES_FILE);
  const collectionVariablesExist = await FsService.lstat(varsPath)
    .then((stats) => stats.isFile())
    .catch(() => false);

  if (collectionVariablesExist) {
    return parseFile({
      resource: createFsResource({
        rootPath,
        path: varsPath,
        type: "file",
      }),
      fileType: new CollectionVariablesRecordFileType(),
    });
  }

  return {
    type: "success",
    content: {},
  } as FileSystemResult<Static<typeof Variables>>;
}

async function getCollectionDescription(
  rootPath: string,
  folder: FolderResource
): Promise<FileSystemResult<string>> {
  const descriptionPath = appendPath(folder.path, DESCRIPTION_FILE);
  const descriptionFileExists = await FsService.lstat(descriptionPath)
    .then((stats) => stats.isFile())
    .catch(() => false);

  if (descriptionFileExists) {
    return parseFile({
      resource: createFsResource({
        rootPath,
        path: descriptionPath,
        type: "file",
      }),
      fileType: new ReadmeRecordFileType(),
    });
  }

  return {
    type: "success",
    content: "",
  };
}

async function getCollectionAuthData(
  rootPath: string,
  folder: FolderResource
): Promise<FileSystemResult<Static<typeof Auth>>> {
  const authPath = appendPath(folder.path, COLLECTION_AUTH_FILE);
  const authFileExists = await FsService.lstat(authPath)
    .then((stats) => stats.isFile())
    .catch(() => false);

  if (authFileExists) {
    return parseFile({
      resource: createFsResource({
        rootPath,
        path: authPath,
        type: "file",
      }),
      fileType: new AuthRecordFileType(),
    });
  }

  return {
    type: "success",
    content: {
      authConfigStore: {},
      currentAuthType: AuthType.NO_AUTH,
    },
  } as FileSystemResult<Static<typeof Auth>>;
}

export async function parseFolderToCollection(
  rootPath: string,
  folder: FolderResource
): Promise<FileSystemResult<Collection>> {
  const collectionVariablesResult = await getCollectionVariables(
    rootPath,
    folder
  );
  if (collectionVariablesResult.type === "error") {
    return collectionVariablesResult;
  }

  const descriptionFileResult = await getCollectionDescription(
    rootPath,
    folder
  );
  if (descriptionFileResult.type === "error") {
    return descriptionFileResult;
  }

  const collectionAuthDataResult = await getCollectionAuthData(
    rootPath,
    folder
  );
  if (collectionAuthDataResult.type === "error") {
    return collectionAuthDataResult;
  }

  const collectionVariables = collectionVariablesResult.content;
  const collectionAuthData = collectionAuthDataResult.content;
  const collectionDescription = descriptionFileResult.content;

  const collection: Collection = {
    type: "collection",
    id: getIdFromPath(folder.path),
    name: getNameOfResource(folder),
    collectionId: getCollectionId(rootPath, folder),
    variables: collectionVariables,
    description: collectionDescription,
    auth: collectionAuthData,
  };

  const result: FileSystemResult<Collection> = {
    type: "success",
    content: collection,
  };

  return result;
}

export function parseFileResultToApi(
  rootPath: string,
  file: FileResource,
  parsedFileResult: FileSystemResult<Static<typeof ApiRecord>>
) {
  if (parsedFileResult.type === "error") {
    return parsedFileResult;
  }

  const { content: record } = parsedFileResult;

  const api: API = {
    type: "api",
    collectionId: getCollectionId(rootPath, file),
    id: getIdFromPath(file.path),
    data: {
      name: record.name,
      rank: record.rank,
      request: record.request,
    },
  };

  const result: FileSystemResult<API> = {
    type: "success",
    content: api,
  };

  return result;
}

export async function parseFileToApi(
  rootPath: string,
  file: FileResource
): Promise<FileSystemResult<API>> {
  const parsedFileResult = await parseFile({
    resource: file,
    fileType: new ApiRecordFileType(),
  });

  return parseFileResultToApi(rootPath, file, parsedFileResult);
}

export function sanitizeFsResourceList(
  rootPath: string,
  resources: FsResource[],
  type: APIEntity["type"],
  fsIgnoreManager: FsIgnoreManager
) {
  // eslint-disable-next-line no-unused-vars
  const checks: ((resource: FsResource) => boolean)[] = [
    (resource) => resource.path !== appendPath(rootPath, CONFIG_FILE),
    (resource) => !resource.path.endsWith(COLLECTION_VARIABLES_FILE),
    (resource) => !resource.path.endsWith(DESCRIPTION_FILE),
    (resource) => !resource.path.endsWith(COLLECTION_AUTH_FILE),
    (resource) => !resource.path.includes(DS_STORE_FILE),
    (resource) => !resource.path.includes(GIT_FOLDER),
    (resource) => !resource.path.includes(GIT_IGNORE_FILE),
    (resource) => !fsIgnoreManager.checkShouldIgnore(resource.path),
  ];
  if (type === "api") {
    checks.push(
      (resource) =>
        !resource.path.startsWith(
          getNormalizedPath(appendPath(rootPath, ENVIRONMENT_VARIABLES_FOLDER))
        )
    );
  }
  if (type === "collection") {
    checks.push(
      (resource) =>
        !resource.path.startsWith(
          getNormalizedPath(appendPath(rootPath, ENVIRONMENT_VARIABLES_FOLDER))
        ),
      (resource) => resource.type === "folder"
    );
  }
  if (type === "environment") {
    checks.push((resource) =>
      resource.path.startsWith(
        getNormalizedPath(appendPath(rootPath, ENVIRONMENT_VARIABLES_FOLDER))
      )
    );
  }

  const predicate = (resource: FsResource) =>
    checks.every((check) => check(resource));

  return resources.filter(predicate);
}

export async function parseFileToEnv(
  file: FileResource
): Promise<FileSystemResult<Environment>> {
  const parsedFileResult = await parseFile({
    resource: file,
    fileType: new EnvironmentRecordFileType(),
  });

  if (parsedFileResult.type === "error") {
    return parsedFileResult;
  }

  const { content } = parsedFileResult;

  const isGlobal = file.path.endsWith(`/${GLOBAL_ENV_FILE}`);
  const environment: Environment = {
    type: "environment",
    id: getIdFromPath(file.path),
    name: content.name,
    variables: content.variables,
    isGlobal,
  };

  const result: FileSystemResult<Environment> = {
    type: "success",
    content: environment,
  };

  return result;
}

export function parseToEnvironmentEntity(
  variables: Record<string, EnvironmentVariableValue>
) {
  const newVariables: Record<
    string,
    Static<(typeof EnvironmentRecord)["variables"]>
  > = {};
  // eslint-disable-next-line
  for (const key in variables) {
    newVariables[key] = {
      value: variables[key].syncValue,
      type:
        variables[key].type === EnvironmentVariableType.Secret
          ? EnvironmentVariableType.String
          : variables[key].type,
      id: variables[key].id,
      isSecret: variables[key].type === EnvironmentVariableType.Secret,
    };
  }

  return newVariables;
}

export function getFileNameFromPath(filePath: string) {
  if (filePath.endsWith("/")) {
    throw new Error('Path seems to be a folder, ends with "/"');
  }
  const parts = filePath.split("/");
  return parts[parts.length - 1];
}
