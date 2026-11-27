import { SecretProviderConfig, SecretProviderType } from "../types";
import { AbstractEncryptedStorage } from "../encryptedStorage/AbstractEncryptedStorage";
import { AbstractSecretProvider } from "../providerService/AbstractSecretProvider";

export interface ProvidersManifest {
  version: string;
  providers: {
    id: string;
    storagePath: string;
    type: SecretProviderType;
  }[];
}

export abstract class AbstractProviderRegistry {
  protected encryptedStorage: AbstractEncryptedStorage;

  protected providers: Map<string, AbstractSecretProvider> = new Map();

  constructor(encryptedStorage: AbstractEncryptedStorage) {
    this.encryptedStorage = encryptedStorage;
  }

  abstract initialize(): Promise<void>;

  protected abstract createProviderInstance(
    config: SecretProviderConfig
  ): AbstractSecretProvider;

  protected abstract loadManifest(): Promise<ProvidersManifest>;

  protected abstract saveManifest(manifest: ProvidersManifest): Promise<void>;

  abstract getAllProviderConfigs(): Promise<SecretProviderConfig[]>;

  abstract getProviderConfig(id: string): Promise<SecretProviderConfig | null>;

  abstract setProviderConfig(config: SecretProviderConfig): Promise<void>;

  abstract deleteProviderConfig(id: string): Promise<void>;

  abstract getProvider(providerId: string): AbstractSecretProvider | null;
}
