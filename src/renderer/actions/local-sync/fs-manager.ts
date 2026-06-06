import { type Static } from "@sinclair/typebox";
import semver from "semver";
import {
  appendPath,
  createFsResource,
  getAlternateName,
  getIdFromPath,
  getNameOfResource,
  getNewNameIfQuickCreate,
  getNormalizedPath,
  mapSuccessfulFsResult,
  parseJsonContent,
  removeUndefinedFromRoot,
  sanitizeFsResourceName,
} from "./common-utils";
import {
  COLLECTION_AUTH_FILE,
  COLLECTION_VARIABLES_FILE,
  CONFIG_FILE,
  DESCRIPTION_FILE,
  ENVIRONMENT_VARIABLES_FOLDER,
  GLOBAL_ENV_FILE,
  WORKSPACE_CONFIG_FILE_VERSION,
} from "./constants";
import {
  createFolder,
  deleteFsResource,
  getFileNameFromPath,
  getIfFileExists,
  getParentFolderPath,
  parseFile,
  parseFileRaw,
  parseFileResultToApi,
  parseFileToApi,
  parseFileToEnv,
  parseFolderToCollection,
  parseToEnvironmentEntity,
  readdir,
  readFileSync,
  rename,
  sanitizeFsResourceList,
  stat,
  writeContent,
  writeContentRaw,
} from "./fs-utils";
import {
  ApiRecord,
  Auth,
  Config,
  EnvironmentRecord,
  AuthType,
  ApiEntryType,
  RequestContentType,
  ApiMethods,
} from "./schemas";
import {
  API,
  APIEntity,
  Collection,
  CollectionRecord,
  Environment,
  EnvironmentVariableValue,
  ErrorCode,
  ErroredRecord,
  FileResource,
  FileSystemResult,
  FileTypeEnum,
  FsResource,
} from "./types";
import {
  ApiRecordFileType,
  AuthRecordFileType,
  CollectionVariablesRecordFileType,
  EnvironmentRecordFileType,
  parseFileType,
  ReadmeRecordFileType,
} from "./file-types/file-types";
import { isEmpty } from "lodash";
import { HandleError } from "./decorators/handle-error.decorator";
import { FsIgnoreManager } from "./fsIgnore-manager";
import { fileIndex } from "./file-index";
export class ResourceNotFound extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class FsManager {
  private rootPath: string;

  private config: Static<typeof Config>;

  private fsIgnoreManager: FsIgnoreManager;

  constructor(
    rootPath: string,
    readonly exposedWorkspacePaths: Map<string, unknown>
  ) {
    this.rootPath = getNormalizedPath(rootPath);
    this.config = {} as Static<typeof Config>;
    this.fsIgnoreManager = new FsIgnoreManager(this.rootPath, this.config);
  }

  async init() {
    try {
      this.config = this.parseConfig();
      const migrationResult =
        await this.checkAndMigrateWorkspaceToLatestVersion(this.config);
      if (migrationResult.type === "error") {
        throw new Error(`Migration failed: ${migrationResult.error.message}`);
      }
      this.fsIgnoreManager = new FsIgnoreManager(this.rootPath, this.config);

      // Calling these methods to initialise file index
      await this.getAllRecords();
      await this.getAllEnvironments();
    } catch (error) {
      throw new Error(
        `Failed to initialize FsManager: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  reload() {
    this.config = this.parseConfig();
    this.fsIgnoreManager = new FsIgnoreManager(this.rootPath, this.config);
  }

  private parseConfig() {
    const configFile = this.createRawResource({
      path: appendPath(this.rootPath, CONFIG_FILE),
      type: "file",
    });
    const rawConfig = readFileSync(configFile.path);
    
    // Only return a default config if the error is ENOENT (file not found)
    if (rawConfig.type === "error") {
      if (rawConfig.error && rawConfig.error.code === ErrorCode.NotFound) {
        console.log(
          `Config file not found at ${configFile.path}. Using default configuration.`
        );
        const defaultConfig: Static<typeof Config> = {
          version: WORKSPACE_CONFIG_FILE_VERSION,
          exclude: [],
        };
        return defaultConfig;
      } else {
        // For any other error (e.g., permission denied), rethrow
        throw new Error(
          `Could not load config from ${CONFIG_FILE}. ${rawConfig.error.message}`
        );
      }
    }
    const parsedConfig = parseJsonContent(rawConfig.content, Config);
    if (parsedConfig.type === "error") {
      throw new Error(
        `Could not load config from ${CONFIG_FILE}. ${parsedConfig.error.message}`
      );
    }
    const { content: config } = parsedConfig;

    return config;
  }

  private async checkAndMigrateWorkspaceToLatestVersion(
    config: Static<typeof Config>
  ): Promise<FileSystemResult<void>> {
    try {
      if (!semver.valid(config.version)) {
        throw new Error(`Invalid version format: ${config.version}`);
      }

      return await this.migrateToVersion(
        config.version,
        WORKSPACE_CONFIG_FILE_VERSION
      );
    } catch (error: any) {
      return {
        type: "error",
        error: {
          code: ErrorCode.MigrationFailed,
          message: `Failed to migrate workspace records: ${error.message}`,
          path: this.rootPath,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
  }

  private async migrateToVersion(
    currentVersion: string,
    targetVersion: string
  ): Promise<FileSystemResult<void>> {
    if (semver.gte(currentVersion, targetVersion)) {
      return { type: "success" };
    }

    let nextVersion: string;
    let migrationResult: FileSystemResult<void>;

    if (semver.lt(currentVersion, "0.0.2")) {
      migrationResult = await this.migrateFromV1ToV2();
      nextVersion = "0.0.2";
    } else if (semver.lt(currentVersion, "0.0.3")) {
      migrationResult = await this.migrateFromV2ToV3();
      nextVersion = "0.0.3";
    } else {
      throw new Error(
        `No migration path available from version ${currentVersion} to ${targetVersion}`
      );
    }

    if (migrationResult.type === "error") {
      return migrationResult;
    }

    return this.migrateToVersion(nextVersion, targetVersion);
  }

  private async migrateFromV1ToV2(): Promise<FileSystemResult<void>> {
    try {
      const allRecordsResult = await this.getAllRecords();
      if (allRecordsResult.type === "error") {
        throw new Error(
          `Failed to get records: ${allRecordsResult.error.message}`
        );
      }

      const { erroredRecords } = allRecordsResult.content;

      const apiRecordsToMigrate = erroredRecords.filter(
        (record) => record.type === "api"
      );

      for (const record of apiRecordsToMigrate) {
        try {
          const recordMigrationResult = await this.migrateApiRecordToV2(
            record.path
          );
          if (recordMigrationResult.type === "error") {
            console.error(
              `Failed to migrate API record ${record.path}:`,
              recordMigrationResult.error.message
            );
            // Continue with other records even if one fails
          }
        } catch (error) {
          console.error(`Failed to migrate API record ${record.path}:`, error);
          // Continue with other records even if one fails
        }
      }

      const versionUpdateResult = await this.updateWorkspaceConfigVersion(
        "0.0.2"
      );
      if (versionUpdateResult.type === "error") {
        return versionUpdateResult;
      }

      return { type: "success" };
    } catch (error: any) {
      return {
        type: "error",
        error: {
          code: ErrorCode.MigrationFailed,
          message: `Failed to migrate from V1 to V2: ${error.message}`,
          path: this.rootPath,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
  }

  private async migrateFromV2ToV3(): Promise<FileSystemResult<void>> {
    try {
      const allRecordsResult = await this.getAllRecords();
      if (allRecordsResult.type === "error") {
        throw new Error(
          `Failed to get records: ${allRecordsResult.error.message}`
        );
      }

      const { records } = allRecordsResult.content;

      const collectionRecords = records.filter(
        (record) => record.type === "collection"
      ) as Collection[];

      for (const collection of collectionRecords) {
        try {
          const authFilePath = appendPath(collection.id, COLLECTION_AUTH_FILE);

          const authFileExists = await stat(authFilePath)
            .then((result) => {
              if (result.type === "error") {
                return false;
              }
              return true;
            })
            .catch(() => false);

          if (authFileExists) {
            // eslint-disable-next-line
            continue;
          }

          const authData: Static<typeof Auth> = {
            authConfigStore: {},
            currentAuthType: AuthType.INHERIT,
          };

          const authFileResource = this.createRawResource({
            path: authFilePath,
            type: "file",
          });

          const writeResult = await writeContent(
            authFileResource,
            authData,
            new AuthRecordFileType()
          );

          if (writeResult.type === "error") {
            console.error(
              `Failed to create auth.json for collection ${collection.id}:`,
              writeResult.error.message
            );
          }
        } catch (error) {
          console.error(
            `Failed to process collection ${collection.id}:`,
            error
          );
          // Continue with other collections
        }
      }

      const versionUpdateResult = await this.updateWorkspaceConfigVersion(
        "0.0.3"
      );
      if (versionUpdateResult.type === "error") {
        return versionUpdateResult;
      }

      return { type: "success" };
    } catch (error: any) {
      return {
        type: "error",
        error: {
          code: ErrorCode.MigrationFailed,
          message: `Failed to migrate from V2 to V3: ${error.message}`,
          path: this.rootPath,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
  }

  private async migrateApiRecordToV2(
    path: string
  ): Promise<FileSystemResult<void>> {
    try {
      const fileResource = this.createRawResource({
        path,
        type: "file",
      });

      const rawContentResult = await parseFileRaw({
        resource: fileResource,
      });

      if (rawContentResult.type === "error") {
        return rawContentResult;
      }

      const rawContent = rawContentResult.content;
      let oldRecordData: any;

      try {
        oldRecordData = JSON.parse(rawContent);
      } catch (error: any) {
        throw new Error(
          `Failed to parse record data while migrating from V1 to V2: ${error.message}`
        );
      }

      const newRecordData: Static<typeof ApiRecord> = {
        name: oldRecordData.name,
        request: {
          url: oldRecordData.url,
          auth: oldRecordData.auth || {
            authConfigStore: {},
            currentAuthType: AuthType.INHERIT,
          },
          scripts: oldRecordData.scripts || {
            preRequest: "",
            postResponse: "",
          },
          type: ApiEntryType.HTTP,
          headers: oldRecordData.headers || [],
          queryParams: oldRecordData.queryParams || [],
          method: oldRecordData.method || ApiMethods.GET,
          body: oldRecordData.body || null,
          contentType: oldRecordData.contentType || RequestContentType.RAW,
          includeCredentials: oldRecordData.includeCredentials || false,
        },
      };

      const writeResult = await writeContent(
        fileResource,
        newRecordData,
        new ApiRecordFileType()
      );
      if (writeResult.type === "error") {
        return writeResult;
      }

      return { type: "success" };
    } catch (error: any) {
      return {
        type: "error",
        error: {
          code: ErrorCode.MigrationFailed,
          message: `Failed to migrate API record: ${error.message}`,
          path,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
  }

  private async updateWorkspaceConfigVersion(
    newVersion: string
  ): Promise<FileSystemResult<void>> {
    try {
      if (!semver.valid(newVersion)) {
        throw new Error(`Invalid version format: ${newVersion}`);
      }

      const currentConfig = this.config;
      if (!currentConfig || Object.keys(currentConfig).length === 0) {
        return {
          type: "error",
          error: {
            code: ErrorCode.MigrationFailed,
            message: "No valid config available for version update",
            path: this.rootPath,
            fileType: FileTypeEnum.UNKNOWN,
          },
        };
      }

      const newConfig: Static<typeof Config> = {
        ...currentConfig,
        version: newVersion,
      };

      const configFile = this.createRawResource({
        path: appendPath(this.rootPath, CONFIG_FILE),
        type: "file",
      });

      const writeResult = await writeContentRaw(
        configFile,
        JSON.stringify(newConfig, null, 2)
      );
      if (writeResult.type === "error") {
        return writeResult;
      }

      this.config = newConfig;
      return { type: "success" };
    } catch (error: any) {
      return {
        type: "error",
        error: {
          code: ErrorCode.MigrationFailed,
          message: `Failed to update workspace config version: ${error.message}`,
          path: this.rootPath,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
  }

  private createResource<T extends FsResource["type"]>(params: {
    id: string;
    type: T;
  }) {
    const path = fileIndex.getPath(params.id);
    if (!path) {
      throw new ResourceNotFound(
        `Resource ${params.id} of type ${params.type} not found!`
      );
    }
    return createFsResource({
      path,
      rootPath: this.rootPath,
      type: params.type,
      exposedWorkspacePaths: this.exposedWorkspacePaths,
    });
  }

  private createRawResource<T extends FsResource["type"]>(params: {
    path: string;
    type: T;
  }) {
    return createFsResource({
      path: params.path,
      rootPath: this.rootPath,
      type: params.type,
      exposedWorkspacePaths: this.exposedWorkspacePaths,
    });
  }

  private async parseFolder(
    rootPath: string,
    type: APIEntity["type"]
  ): Promise<FileSystemResult<FsResource[]>> {
    const container: FsResource[] = [];
    const recursiveParser = async (path: string) => {
      const childrenResult = await readdir(path);
      if (childrenResult.type === "error") {
        return childrenResult;
      }
      // eslint-disable-next-line
      for (const child of childrenResult.content) {
        const resourcePath = appendPath(path, child);
        const resourceMetadataResult = await stat(resourcePath);
        if (resourceMetadataResult.type === "error") {
          return resourceMetadataResult;
        }

        if (resourceMetadataResult.content.isDirectory()) {
          container.push(
            this.createRawResource({
              path: resourcePath,
              type: "folder",
            })
          );
          await recursiveParser(resourcePath);
        } else {
          container.push(
            this.createRawResource({
              path: resourcePath,
              type: "file",
            })
          );
        }
      }
      return undefined;
    };

    const error = await recursiveParser(rootPath);
    if (error) {
      return error;
    }
    return {
      type: "success",
      content: sanitizeFsResourceList(
        rootPath,
        container,
        type,
        this.fsIgnoreManager
      ),
    };
  }

  // eslint-disable-next-line
  private generateFileName(rawName: string) {
    return `${sanitizeFsResourceName(rawName)}.json`;
  }

  private getEnvironmentsFolderPath() {
    const envFolderPath = appendPath(
      this.rootPath,
      ENVIRONMENT_VARIABLES_FOLDER
    );
    return envFolderPath;
  }

  private async getFileResourceWithNameVerification(params: {
    name?: string;
    id: string;
  }): Promise<FileSystemResult<FileResource>> {
    const existingFile = this.createResource({
      id: params.id,
      type: "file",
    });

    if (!params.name) {
      return {
        type: "success",
        content: existingFile,
      };
    }

    const existingFileName = getFileNameFromPath(existingFile.path);
    const sanitizedName = this.generateFileName(params.name);
    if (existingFileName === sanitizedName) {
      return {
        type: "success",
        content: existingFile,
      };
    }

    const parentPath = getParentFolderPath(existingFile);
    const newFilePath = appendPath(parentPath, sanitizedName);

    const newFileResource = this.createRawResource({
      path: newFilePath,
      type: "file",
    });

    const isSamePath =
      getNormalizedPath(existingFile.path).toLowerCase() ===
      getNormalizedPath(newFileResource.path).toLowerCase();
    const alreadyExists = await getIfFileExists(newFileResource);
    if (!isSamePath && alreadyExists) {
      return {
        type: "error",
        error: {
          message: `Resource with name '${sanitizedName}' already exists!`,
          fileType: FileTypeEnum.UNKNOWN,
          path: newFilePath,
          code: ErrorCode.EntityAlreadyExists,
        },
      };
    }

    const result = await rename(existingFile, newFileResource);

    if (result.type === "error") {
      return result;
    }

    return {
      type: "success",
      content: newFileResource,
    };
  }

  @HandleError
  async getRecord(id: string): Promise<FileSystemResult<API>> {
    const resource = this.createResource({
      id,
      type: "file",
    });
    const fileResult = await parseFile({
      resource,
      fileType: new ApiRecordFileType(),
    });
    if (fileResult.type === "error") {
      return fileResult;
    }

    const parseResult = parseFileResultToApi(
      this.rootPath,
      resource,
      fileResult
    );
    return parseResult;
  }

  @HandleError
  async getCollection(id: string): Promise<FileSystemResult<Collection>> {
    const resource = this.createResource({
      id,
      type: "folder",
    });

    const parseResult = parseFolderToCollection(this.rootPath, resource);
    return parseResult;
  }

  @HandleError
  async getAllRecords(): Promise<
    FileSystemResult<{
      records: APIEntity[];
      erroredRecords: ErroredRecord[];
    }>
  > {
    const resourceContainerResult = await this.parseFolder(
      this.rootPath,
      "api"
    );
    if (resourceContainerResult.type === "error") {
      return resourceContainerResult;
    }
    const entities: APIEntity[] = [];
    const erroredRecords: ErroredRecord[] = [];
    // eslint-disable-next-line
    for (const resource of resourceContainerResult.content) {
      const entityParsingResult: FileSystemResult<APIEntity> | undefined =
        await (async () => {
          if (resource.type === "folder") {
            return parseFolderToCollection(this.rootPath, resource).then(
              (result) =>
                mapSuccessfulFsResult(
                  result,
                  (successfulResult) => successfulResult.content
                )
            );
          }
          return parseFileToApi(this.rootPath, resource).then((result) =>
            mapSuccessfulFsResult(
              result,
              (successfulResult) => successfulResult.content
            )
          );
        })();

      if (entityParsingResult?.type === "error") {
        erroredRecords.push({
          id: getIdFromPath(resource.path),
          name: getFileNameFromPath(entityParsingResult.error.path),
          path: entityParsingResult.error.path,
          error: entityParsingResult.error.message,
          type: entityParsingResult.error.fileType,
        });
        // eslint-disable-next-line
        continue;
      }

      if (entityParsingResult) {
        entities.push(entityParsingResult.content);
      }
    }

    return {
      type: "success",
      content: {
        records: entities,
        erroredRecords,
      },
    };
  }

  @HandleError
  async getAllEnvironments(): Promise<
    FileSystemResult<{
      environments: Environment[];
      erroredRecords: ErroredRecord[];
    }>
  > {
    const fileType = new EnvironmentRecordFileType();
    const resourceContainerResult = await this.parseFolder(
      this.rootPath,
      "environment"
    );
    if (resourceContainerResult.type === "error") {
      return resourceContainerResult;
    }
    const entities: Environment[] = [];
    const erroredRecords: ErroredRecord[] = [];
    // eslint-disable-next-line
    for (const resource of resourceContainerResult.content) {
      if (resource.type === "file") {
        const parsedResult = await parseFile({
          resource,
          fileType,
        });
        if (parsedResult.type === "error") {
          erroredRecords.push({
            id: getIdFromPath(resource.path),
            name: getNameOfResource(resource),
            path: parsedResult.error.path,
            error: parsedResult.error.message,
            type: fileType.type,
          });
          // eslint-disable-next-line
          continue;
        }
        if (parsedResult) {
          const isGlobal = resource.path.endsWith(`/${GLOBAL_ENV_FILE}`);
          entities.push({
            type: "environment",
            id: getIdFromPath(resource.path),
            name: parsedResult.content.name,
            variables: parsedResult.content.variables,
            isGlobal,
          });
        }
      }
    }
    return {
      type: "success",
      content: {
        environments: entities,
        erroredRecords,
      },
    };
  }

  @HandleError
  async createRecord(
    content: Static<typeof ApiRecord>,
    collectionId?: string,
    idToUse?: string
  ): Promise<FileSystemResult<API>> {
    const parentFolderResource = this.createResource({
      id: collectionId || getIdFromPath(this.rootPath),
      type: "folder",
    });
    const sanitizedName = sanitizeFsResourceName(content.name);

    const newName = getNewNameIfQuickCreate({
      name: sanitizedName,
      baseName: sanitizedName,
      parentPath: getNormalizedPath(parentFolderResource.path),
    });

    content.name = newName;

    const path = appendPath(
      parentFolderResource.path,
      this.generateFileName(content.name)
    );
    const resource = this.createRawResource({
      path,
      type: "file",
    });

    const alreadyExists = await getIfFileExists(resource);
    if (alreadyExists) {
      throw new Error(`Record '${content.name}' already exists!`);
    }

    const writeResult = await writeContent(
      resource,
      content,
      new ApiRecordFileType(),
      {
        useId: idToUse,
        performExistenceCheck: true,
      }
    );
    if (writeResult.type === "error") {
      return writeResult;
    }

    return parseFileToApi(this.rootPath, resource);
  }

  @HandleError
  async createRecordWithId(
    content: Static<typeof ApiRecord>,
    id: string,
    collectionId?: string
  ): Promise<FileSystemResult<API>> {
    return this.createRecord(content, collectionId, id);
  }

  @HandleError
  async deleteRecord(id: string): Promise<FileSystemResult<void>> {
    try {
      const resource = this.createResource({
        id,
        type: "file",
      });
      const deleteResult = await deleteFsResource(resource);
      if (deleteResult.type === "error") {
        return deleteResult;
      }

      return {
        type: "success",
      };
    } catch (e) {
      if (e instanceof ResourceNotFound) {
        return {
          type: "success",
        };
      }

      throw e;
    }
  }

  @HandleError
  async deleteRecords(ids: string[]): Promise<FileSystemResult<void>> {
    // eslint-disable-next-line no-restricted-syntax
    for (const id of ids) {
      const result = await this.deleteRecord(id);
      if (result.type === "error") {
        return result;
      }
    }

    return {
      type: "success",
    };
  }

  @HandleError
  async createCollection(
    name: string,
    collectionId?: string,
    idToUse?: string
  ): Promise<FileSystemResult<Collection>> {
    const folderResource = this.createResource({
      id: collectionId || getIdFromPath(this.rootPath),
      type: "folder",
    });
    const newName = getNewNameIfQuickCreate({
      name: sanitizeFsResourceName(name),
      baseName: "New collection",
      parentPath: getNormalizedPath(folderResource.path),
    });

    name = newName;

    const path = appendPath(folderResource.path, name);
    const resource = this.createRawResource({
      path,
      type: "folder",
    });
    const createResult = await createFolder(resource, {
      errorIfExist: true,
      useId: idToUse,
    });
    if (createResult.type === "error") {
      return createResult;
    }

    const authWriteResult = await this.updateCollectionAuthData(
      getIdFromPath(createResult.content.resource.path),
      {
        authConfigStore: {},
        currentAuthType: AuthType.INHERIT,
      }
    );
    if (authWriteResult.type === "error") {
      return authWriteResult;
    }

    return parseFolderToCollection(this.rootPath, resource);
  }

  @HandleError
  async createCollectionWithId(
    name: string,
    id: string,
    collectionId?: string
  ): Promise<FileSystemResult<Collection>> {
    return this.createCollection(name, collectionId, id);
  }

  @HandleError
  async deleteCollection(id: string): Promise<FileSystemResult<void>> {
    try {
      const resource = this.createResource({
        id,
        type: "folder",
      });
      const deleteResult = await deleteFsResource(resource);
      if (deleteResult.type === "error") {
        return deleteResult;
      }

      return {
        type: "success",
      };
    } catch (e) {
      if (e instanceof ResourceNotFound) {
        return {
          type: "success",
        };
      }

      throw e;
    }
  }

  @HandleError
  async deleteCollections(ids: string[]): Promise<FileSystemResult<void>> {
    // eslint-disable-next-line no-restricted-syntax
    for (const id of ids) {
      const result = await this.deleteCollection(id);
      if (result.type === "error") {
        return result;
      }
    }
    return {
      type: "success",
    };
  }

  @HandleError
  async renameCollection(
    id: string,
    newName: string
  ): Promise<FileSystemResult<Collection>> {
    const specialCharRegex = /[!@#$%^&*(),.?":{}|<>]/g;
    if (specialCharRegex.test(newName)) {
      return {
        type: "error",
        error: {
          code: ErrorCode.WrongInput,
          message: "Collection name should not contain special characters.",
          path: id,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
    const folderResource = this.createResource({
      id,
      type: "folder",
    });
    const parentPath = getParentFolderPath(folderResource);

    const newFolderResource = this.createResource({
      id: getIdFromPath(appendPath(parentPath, newName)),
      type: "folder",
    });

    const renameResult = await rename(folderResource, newFolderResource);
    if (renameResult.type === "error") {
      return renameResult;
    }

    return parseFolderToCollection(this.rootPath, renameResult.content);
  }

  @HandleError
  async updateCollectionDescription(
    id: string,
    description: string
  ): Promise<FileSystemResult<string>> {
    const collectionFolder = this.createResource({
      id,
      type: "folder",
    });
    const descriptionFileResource = this.createRawResource({
      path: appendPath(collectionFolder.path, DESCRIPTION_FILE),
      type: "file",
    });
    if (!description.length) {
      const deleteResult = await deleteFsResource(descriptionFileResource);
      if (deleteResult.type === "error") {
        return deleteResult;
      }
      return {
        type: "success",
        content: "",
      };
    }

    const writeResult = await writeContent(
      descriptionFileResource,
      description,
      new ReadmeRecordFileType()
    );
    if (writeResult.type === "error") {
      return writeResult;
    }
    return {
      type: "success",
      content: description,
    };
  }

  @HandleError
  async updateCollectionAuthData(
    id: string,
    authData: Static<typeof Auth>
  ): Promise<FileSystemResult<Static<typeof Auth>>> {
    const collectionFolder = this.createResource({
      id,
      type: "folder",
    });

    const authFileResource = this.createRawResource({
      path: appendPath(collectionFolder.path, COLLECTION_AUTH_FILE),
      type: "file",
    });

    const writeResult = await writeContent(
      authFileResource,
      authData,
      new AuthRecordFileType()
    );
    if (writeResult.type === "error") {
      return writeResult;
    }
    return {
      type: "success",
      content: authData,
    };
  }

  @HandleError
  async moveCollection(
    id: string,
    newParentId: string
  ): Promise<FileSystemResult<Collection>> {
    const parentPath = newParentId.length
      ? fileIndex.getPath(newParentId)
      : this.rootPath;
    if (!parentPath) {
      throw new Error(`Path not found for collection/root id ${newParentId}`);
    }
    const folderResource = this.createResource({
      id,
      type: "folder",
    });
    const resourceName = getNameOfResource(folderResource);

    const newFolderResource = this.createRawResource({
      path: appendPath(parentPath, resourceName),
      type: "folder",
    });

    const renameResult = await rename(folderResource, newFolderResource);
    if (renameResult.type === "error") {
      return renameResult;
    }

    return parseFolderToCollection(this.rootPath, renameResult.content);
  }

  @HandleError
  async moveCollections(
    ids: string[],
    newParentId: string
  ): Promise<FileSystemResult<Collection[]>> {
    const movedCollections: Collection[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const id of ids) {
      const result = await this.moveCollection(id, newParentId);
      if (result.type === "error") {
        return result;
      }
      movedCollections.push(result.content);
    }

    return {
      type: "success",
      content: movedCollections,
    };
  }

  @HandleError
  async moveRecord(
    id: string,
    newParentId: string
  ): Promise<FileSystemResult<API>> {
    const parentPath = newParentId.length
      ? fileIndex.getPath(newParentId)
      : this.rootPath;
    if (!parentPath) {
      throw new Error(`Path not found for collection/root id ${newParentId}`);
    }
    const fileResource = this.createResource({
      id,
      type: "file",
    });
    const resourceName = getNameOfResource(fileResource);

    const newFileResource = this.createRawResource({
      path: appendPath(parentPath, resourceName),
      type: "file",
    });

    const renameResult = await rename(fileResource, newFileResource);
    if (renameResult.type === "error") {
      return renameResult;
    }

    return parseFileToApi(this.rootPath, renameResult.content);
  }

  @HandleError
  async moveRecords(
    ids: string[],
    newParentId: string
  ): Promise<FileSystemResult<API[]>> {
    const movedRecords: API[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const id of ids) {
      const result = await this.moveRecord(id, newParentId);
      if (result.type === "error") {
        return result;
      }
      movedRecords.push(result.content);
    }

    return {
      type: "success",
      content: movedRecords,
    };
  }

  @HandleError
  async setCollectionVariables(
    id: string,
    variables: Record<string, EnvironmentVariableValue>
  ): Promise<FileSystemResult<Collection>> {
    const folder = this.createResource({
      id,
      type: "folder",
    });
    const varsPath = appendPath(folder.path, COLLECTION_VARIABLES_FILE);
    const file = this.createRawResource({
      path: varsPath,
      type: "file",
    });

    if (!Object.keys(variables).length) {
      const deleteResult = await deleteFsResource(file);
      if (deleteResult.type === "error") {
        return deleteResult;
      }

      return parseFolderToCollection(this.rootPath, folder);
    }

    const parsedVariables = parseToEnvironmentEntity(variables);

    const writeResult = await writeContent(
      file,
      parsedVariables,
      new CollectionVariablesRecordFileType()
    );
    if (writeResult.type === "error") {
      return writeResult;
    }

    return parseFolderToCollection(this.rootPath, folder);
  }

  @HandleError
  async updateRecord(
    patch: Partial<Static<typeof ApiRecord>>,
    id: string
  ): Promise<FileSystemResult<API>> {
    const fileType = new ApiRecordFileType();
    removeUndefinedFromRoot(patch);
    let fileResourceResult = await this.getFileResourceWithNameVerification({
      id,
      name: patch.name,
    });

    if (fileResourceResult.type === "error") {
      return fileResourceResult;
    }

    const fileResource = fileResourceResult.content;

    const parsedRecordResult = await parseFile({
      resource: fileResource,
      fileType,
    });

    if (parsedRecordResult.type === "error") {
      return parsedRecordResult;
    }
    const { content: currentRecord } = parsedRecordResult;
    const updatedRecord: Static<typeof ApiRecord> = {
      ...currentRecord,
      ...patch,
    };
    const writeResult = await writeContent(
      fileResource,
      updatedRecord,
      fileType
    );
    if (writeResult.type === "error") {
      return writeResult;
    }

    return parseFileToApi(this.rootPath, fileResource);
  }

  @HandleError
  async writeRawRecord(
    id: string,
    rawRecord: string,
    rawfileType: string
  ): Promise<FileSystemResult<unknown>> {
    const fileResource = this.createResource({
      id,
      type: "file",
    });
    const fileType = parseFileType(rawfileType);
    const parsedRecord = fileType.parse(rawRecord);
    if (parsedRecord.type === "error") {
      return {
        type: "error",
        error: {
          code: ErrorCode.UNKNOWN,
          message: parsedRecord.error.message,
          path: fileResource.path,
          fileType: fileType.type,
        },
      };
    }

    const writeResult = await writeContentRaw(
      fileResource,
      parsedRecord.content
    );
    return writeResult;
  }

  @HandleError
  async createEnvironment(
    environmentName: string,
    isGlobal: boolean
  ): Promise<FileSystemResult<Environment>> {
    const environmentFolderPath = this.getEnvironmentsFolderPath();
    const environmentFolderResource = this.createRawResource({
      path: environmentFolderPath,
      type: "folder",
    });
    const folderCreationResult = await createFolder(environmentFolderResource);
    if (folderCreationResult.type === "error") {
      return folderCreationResult;
    }

    const sanitizedEnvName = sanitizeFsResourceName(environmentName);
    const newName = getNewNameIfQuickCreate({
      name: sanitizedEnvName,
      baseName: sanitizedEnvName,
      parentPath: getNormalizedPath(environmentFolderPath),
    });

    environmentName = newName;

    const envFile = this.createRawResource({
      path: appendPath(
        environmentFolderPath,
        isGlobal ? GLOBAL_ENV_FILE : this.generateFileName(environmentName)
      ),
      type: "file",
    });

    const alreadyExists = await getIfFileExists(envFile);
    if (alreadyExists) {
      throw new Error(`Environment '${environmentName}' already exists!`);
    }

    const content = {
      name: environmentName,
      variables: {},
    };

    const writeResult = await writeContent(
      envFile,
      content,
      new EnvironmentRecordFileType(),
      {
        performExistenceCheck: true,
      }
    );
    if (writeResult.type === "error") {
      return writeResult;
    }
    return parseFileToEnv(envFile);
  }

  @HandleError
  async updateEnvironment(
    id: string,
    patch:
      | { name: string }
      | { variables: Record<string, EnvironmentVariableValue> }
  ): Promise<FileSystemResult<Environment>> {
    const fileType = new EnvironmentRecordFileType();
    removeUndefinedFromRoot(patch);
    let fileResourceResult = await this.getFileResourceWithNameVerification({
      id,
      name: (patch as any).name,
    });

    if (fileResourceResult.type === "error") {
      return fileResourceResult;
    }

    const fileResource = fileResourceResult.content;

    const parsedRecordResult = await parseFile({
      resource: fileResource,
      fileType,
    });

    if (parsedRecordResult.type === "error") {
      return parsedRecordResult;
    }
    const { content } = parsedRecordResult;

    const updatedRecord: Static<typeof EnvironmentRecord> = {
      ...content,
    };

    if ("variables" in patch) {
      updatedRecord.variables = parseToEnvironmentEntity(patch.variables);
    }
    if ("name" in patch) {
      updatedRecord.name = patch.name;
    }

    const writeResult = await writeContent(
      fileResource,
      updatedRecord,
      fileType
    );
    if (writeResult.type === "error") {
      return writeResult;
    }

    return parseFileToEnv(fileResource);
  }

  @HandleError
  async duplicateEnvironment(
    id: string
  ): Promise<FileSystemResult<Environment>> {
    const fileType = new EnvironmentRecordFileType();
    const fileResource = this.createResource({
      id,
      type: "file",
    });
    if (fileResource.path.endsWith(GLOBAL_ENV_FILE)) {
      return {
        type: "error",
        error: {
          code: ErrorCode.UNKNOWN,
          message: "Global environment cannnot be copied!",
          path: fileResource.path,
          fileType: FileTypeEnum.UNKNOWN,
        },
      };
    }
    const originalEnvironment = await parseFile({
      resource: fileResource,
      fileType,
    });

    if (originalEnvironment.type === "error") {
      return originalEnvironment;
    }

    const { content } = originalEnvironment;

    const newEnvironmentContent: Static<typeof EnvironmentRecord> = {
      name: `${content.name} (copy)`,
      variables: content.variables,
    };
    const path = appendPath(
      this.getEnvironmentsFolderPath(),
      this.generateFileName(newEnvironmentContent.name)
    );
    const resource = this.createRawResource({
      path,
      type: "file",
    });
    const writeResult = await writeContent(
      resource,
      newEnvironmentContent,
      fileType,
      {
        performExistenceCheck: true,
      }
    );
    if (writeResult.type === "error") {
      return writeResult;
    }

    return parseFileToEnv(resource);
  }

  @HandleError
  async getRawFileData(id: string): Promise<FileSystemResult<string>> {
    const fileResource = this.createResource({
      id,
      type: "file",
    });
    const parsedRecordResult = await parseFileRaw({
      resource: fileResource,
    });
    if (parsedRecordResult.type === "error") {
      return parsedRecordResult;
    }
    return parsedRecordResult;
  }

  @HandleError
  async createCollectionFromCompleteRecord(
    collection: CollectionRecord,
    id: string
  ): Promise<FileSystemResult<Collection>> {
    const parentPath = collection.collectionId.length
      ? fileIndex.getPath(collection.collectionId)
      : this.rootPath;
    if (!parentPath) {
      throw new Error(`Could not find path for id ${collection.collectionId}`);
    }

    const sanitizedName = sanitizeFsResourceName(collection.name);

    // Handle name conflicts for imported/duplicated collections (root and nested)
    const newName = getNewNameIfQuickCreate({
      name: sanitizedName,
      baseName: sanitizedName,
      parentPath: getNormalizedPath(parentPath),
    });

    collection.name = newName;

    const path = appendPath(
      parentPath,
      sanitizeFsResourceName(collection.name)
    );
    const collectionFolder = this.createRawResource({
      path,
      type: "folder",
    });
    const createResult = await createFolder(collectionFolder, {
      errorIfExist: true,
      useId: id,
    });
    if (createResult.type === "error") {
      return createResult;
    }

    if (collection.description?.length) {
      const descriptionFile = this.createRawResource({
        path: appendPath(collectionFolder.path, DESCRIPTION_FILE),
        type: "file",
      });
      const writeResult = await writeContent(
        descriptionFile,
        collection.description,
        new ReadmeRecordFileType()
      );
      if (writeResult.type === "error") {
        return writeResult;
      }
    }

    if (
      collection.data.auth &&
      !isEmpty(collection.data.auth) &&
      collection.data.auth.currentAuthType !== AuthType.NO_AUTH
    ) {
      const authFile = this.createRawResource({
        path: appendPath(collectionFolder.path, COLLECTION_AUTH_FILE),
        type: "file",
      });
      const writeResult = await writeContent(
        authFile,
        collection.data.auth,
        new AuthRecordFileType()
      );
      if (writeResult.type === "error") {
        return writeResult;
      }
    }

    if (!isEmpty(collection.data.variables)) {
      const variablesFile = this.createRawResource({
        path: appendPath(collectionFolder.path, COLLECTION_VARIABLES_FILE),
        type: "file",
      });
      const parsedVariables = parseToEnvironmentEntity(
        collection.data.variables
      );
      const writeResult = await writeContent(
        variablesFile,
        parsedVariables,
        new CollectionVariablesRecordFileType()
      );
      if (writeResult.type === "error") {
        return writeResult;
      }
    }

    return parseFolderToCollection(this.rootPath, collectionFolder);
  }
}
