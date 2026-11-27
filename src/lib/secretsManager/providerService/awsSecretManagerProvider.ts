/* eslint-disable class-methods-use-this */
import {
  AwsSecretReference,
  AWSSecretsManagerConfig,
  CachedSecret,
  SecretProviderConfig,
  SecretProviderType,
  SecretReference,
} from "../types";
import { AbstractSecretProvider } from "./AbstractSecretProvider";

// Functions
// 1. validate config
// 2. test connection
// 3. fetch secret
// 4. list secrets

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class AWSSecretsManagerProvider extends AbstractSecretProvider {
  readonly type = SecretProviderType.AWS_SECRETS_MANAGER;

  readonly id: string;

  protected config: AWSSecretsManagerConfig;

  protected cache: Map<string, CachedSecret> = new Map();

  protected getSecretIdentfier(ref: AwsSecretReference): string {
    return `name=${ref.nameOrArn};version:${ref.version}`;
  }

  constructor(providerConfig: SecretProviderConfig) {
    super();
    this.id = providerConfig.id;
    this.config = providerConfig.config as AWSSecretsManagerConfig;
  }

  async testConnection(): Promise<boolean> {
    if (!AWSSecretsManagerProvider.validateConfig(this.config)) {
      return false;
    }

    return true;
  }

  async getSecret(ref: AwsSecretReference): Promise<string> {
    const secretKey = this.getSecretIdentfier(ref);
    const cachedSecret = this.cache.get(secretKey);
    const now = Date.now();

    if (cachedSecret && cachedSecret.expiry > now) {
      return cachedSecret.value;
    }

    // Fetch from AWS Secrets Manager
    const secretValue = "fetched-secret-value"; // Placeholder for actual fetch logic

    this.cache.set(secretKey, {
      value: secretValue,
      expiry: now + DEFAULT_CACHE_TTL_MS,
    });

    return secretValue;
  }

  async getSecrets(): Promise<string[]> {}

  async setSecret(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async setSecrets(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  static validateConfig(config: AWSSecretsManagerConfig): boolean {
    return Boolean(
      config.accessKeyId && config.secretAccessKey && config.region
    );
  }
}
