import { type Static } from "@sinclair/typebox";
import semver from "semver";
import {
  appendPath,
  createFsResource,
  getIdFromPath,
  getNameOfResource,
  getNormalizedPath,
  mapSuccessfulFsResult,
  parseJsonContent,
} from "./common-utils";
import {
  COLLECTION_AUTH_FILE,
  CONFIG_FILE,
  GLOBAL_ENV_FILE,
  WORKSPACE_CONFIG_FILE_VERSION,
} from "./constants";
import {
  getFileNameFromPath,
  parseFile,
  parseFileRaw,
  parseFileResultToApi,
  parseFileToApi,
  parseFolderToCollection,
  readdir,
  readFileSync,
  sanitizeFsResourceList,
  stat,
  writeContent,
  writeContentRaw,
} from "./fs-utils";
import {
  ApiRecord,
  Auth,
  Config,
  AuthType,
  ApiEntryType,
  RequestContentType,
  ApiMethods,
} from "./schemas";
import {
  API,
  APIEntity,
  Collection,
  Environment,
  ErrorCode,
  ErroredRecord,
  FileSystemResult,
  FileTypeEnum,
  FsResource,
} from "./types";
import {
  ApiRecordFileType,
  AuthRecordFileType,
  EnvironmentRecordFileType,
} from "./file-types/file-types";
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
    if (rawConfig.type === "error") {
      throw new Error(
        `Could not load config from ${CONFIG_FILE}. ${rawConfig.error.message}`
      );
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
}
