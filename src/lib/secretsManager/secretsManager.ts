import { SecretProviderConfig, SecretReference } from "./types";
import { EncryptedFsStorageService } from "./encryptedStorage/encryptedFsStorageService";
import { FileBasedProviderRegistry } from "./providerRegistry/FsProviderRegistry";
import { AbstractProviderRegistry } from "./providerRegistry/AbstractProviderRegistry";

// Questions
// 6. // providerId in fetchByIdentifier ?? would be confusing and then I can name it key but without using "key" word. How can I make it generic? AI suggested using composite key.

// Functions
// 1. initialize registry and cache service
// 2. add/remove provider configs
// 3. fetch secret (with caching)
// 4. list secrets
// 5. invalidate cache

// FLows
// 1. INIT - load all provider configs from the registry and create provider instances.
// 2. ADD/REMOVE PROVIDER CONFIG - update the registry and provider instances map.
// 3. FETCH SECRET - check cache first, if not found or expired, fetch from provider, store in cache, return secret.
// 4. Refresh Secrets - bulk fetch and update all secrets from their providers and update the cache
//

const encryptedStorage = new EncryptedFsStorageService("");
const providerRegistry = new FileBasedProviderRegistry(encryptedStorage, "");

const secretsManager = new SecretsManager(providerRegistry);

// createProviderInstance should have cache Storage as dependency.
// providerRegistry cannot be exposed because it would have storage specific code like fs methods etc.

// Why need to change cache storage at provider lever?
// Different providers may have different cache storage requirements but why?
// Different providers can have different source of truth but caching should be common. WHy not?
// But agreed provider should be the one interacting with cache storage and repo layer and not secretmanager

// Changes
// 1. cacheService associated with provider instance instead of secretManager.
// 2. registry manages the providers map
// 3. All the methods from secretManager delegated to registry and provider instances.
// 4. provider instance creation is moved to registry.

export class SecretsManager {
  private registry: AbstractProviderRegistry;

  constructor(registry: AbstractProviderRegistry) {
    this.registry = registry;
  }

  async initialize(): Promise<void> {
    this.registry.initialize();
  }

  async addProviderConfig(config: SecretProviderConfig) {
    this.registry.setProviderConfig(config);
  }

  async removeProviderConfig(id: string) {
    this.registry.deleteProviderConfig(id);
  }

  async getProviderConfig(id: string): Promise<SecretProviderConfig | null> {
    return this.registry.getProviderConfig(id);
  }

  async testProviderConnection(id: string): Promise<boolean> {
    const provider = this.registry.getProvider(id);
    return provider?.testConnection() ?? false;
  }

  async fetchSecret(providerId: string, ref: SecretReference): Promise<string> {
    this.registry.getProvider(providerId)?.getSecret(ref);
  }

  async refreshSecrets(
    secrets: Array<{ providerId: string; ref: SecretReference }>
  ): Promise<void> {
    for (const s of secrets) {
      // Invalidate cache
      // Fetch fresh secret and update cache
    }
  }

  async fetchSecrets(
    secrets: Array<{ providerId: string; ref: SecretReference }>
  ): Promise<Map<string, string>> {
    for (const s of secrets) {
      const secret = await this.fetchSecret(s.providerId, s.ref);
    }
  }
}
