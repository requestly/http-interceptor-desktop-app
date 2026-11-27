import { safeStorage } from "electron";
import { IEncryptedStorage } from "./IEncryptedStorage";

export class EncryptedFsStorageService implements IEncryptedStorage {
  constructor(private readonly baseFolderPath: string) {}

  async initialize(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      // Show trouble shooting steps to user
      throw new Error("Encryption is not available on this system. ");
    }

    // initialize directories
  }

  async save<T extends Record<string, any>>(
    key: string,
    data: T
  ): Promise<void> {
    // encrypted
  }

  async load<T extends Record<string, any>>(key: string): Promise<T> {}

  async delete(key: string): Promise<void> {}
}
