import { SecretProviderConfig, SecretProviderType } from "../types";
import { AWSSecretsManagerProvider } from "./awsSecretManagerProvider";
import { AbstractSecretProvider } from "./AbstractSecretProvider";

export function createProvider(
  config: SecretProviderConfig
): AbstractSecretProvider {
  switch (config.type) {
    case SecretProviderType.AWS_SECRETS_MANAGER:
      return new AWSSecretsManagerProvider(config);
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
