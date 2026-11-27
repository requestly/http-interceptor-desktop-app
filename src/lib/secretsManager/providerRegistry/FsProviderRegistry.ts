import * as fs from "fs";
import * as path from "path";
import { SecretProviderConfig, SecretProviderType } from "../types";
import { createProvider } from "../providerService/providerFactory";
import { AbstractProviderRegistry } from "./AbstractProviderRegistry";
import { AbstractEncryptedStorage } from "../encryptedStorage/AbstractEncryptedStorage";
import { AbstractSecretProvider } from "../providerService/AbstractSecretProvider";

const MANIFEST_FILENAME = "providers.json";



// Functions
// 1. initialize registry (create config dir if not exists)
// 2. list providers
// 3.

export class FileBasedProviderRegistry extends AbstractProviderRegistry {
  private manifestPath: string;

  private configDir: string;

  protected providers: Map<string, AbstractSecretProvider> = new Map();

  constructor(encryptedStorage: AbstractEncryptedStorage, configDir: string) {
    super(encryptedStorage);
    this.configDir = configDir;
    this.manifestPath = path.join(configDir, MANIFEST_FILENAME);
  }

  getProvider(providerId: string): AbstractSecretProvider | null {
    return this.providers.get(providerId) || null;
  }

  async initialize(): Promise<void> {
    await this.ensureConfigDir();
    this.initProvidersFromManifest();
  }

  private async initProvidersFromManifest() {
    const configs = await this.getAllProviderConfigs();
    configs.forEach((config) => {
      this.providers.set(config.id, this.createProviderInstance(config));
    });
  }

  async getAllProviderConfigs(): Promise<SecretProviderConfig[]> {
    const manifest = await this.loadManifest();
    const configs: SecretProviderConfig[] = [];

    for (const entry of manifest.providers) {
      const config = await this.encryptedStorage.load<SecretProviderConfig>(
        entry.id
      );
      configs.push(config);
    }

    return configs;
  }

  async setProviderConfig(config: SecretProviderConfig): Promise<void> {
    const manifest = await this.loadManifest();
    const storageKey = config.id;

    // do atomic write
    await this.encryptedStorage.save(storageKey, config);

    // Update manifest

    await this.saveManifest(manifest);
    this.providers.set(config.id, this.createProviderInstance(config));
  }

  async deleteProviderConfig(id: string): Promise<void> {
    const manifest = await this.loadManifest();
    const entry = manifest.providers.find((p) => p.id === id);
    if (!entry) return;

    await this.encryptedStorage.delete(id);

    manifest.providers = manifest.providers.filter((p) => p.id !== id);
    await this.saveManifest(manifest);
    this.providers.delete(id);
  }

  async getProviderConfig(id: string): Promise<SecretProviderConfig | null> {
    const manifest = await this.loadManifest();
    const entry = manifest.providers.find((p) => p.id === id);
    if (!entry) return null;

    return this.encryptedStorage.load<SecretProviderConfig>(id);
  }

  private async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      console.error("Failed to create config directory:", error);
    }
  }

  protected async loadManifest(): Promise<ProvidersManifest> {}

  protected async saveManifest(manifest: ProvidersManifest): Promise<void> {}

  // eslint-disable-next-line class-methods-use-this
  protected createProviderInstance(
    config: SecretProviderConfig
  ): AbstractSecretProvider {
    return createProvider(config);
  }
}
