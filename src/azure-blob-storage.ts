import { randomBytes } from "node:crypto";

import { assertRuntimeStorageKey, type AssetStorage } from "./storage.js";

export type AzureBlobPort = {
  upload(key: string, bytes: Buffer): Promise<void>;
  download(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
};

export function createAzureBlobAssetStorage(port: AzureBlobPort): AssetStorage {
  return {
    async put(key, bytes) {
      await port.upload(assertRuntimeStorageKey(key), bytes);
    },
    async get(key) {
      return port.download(assertRuntimeStorageKey(key));
    },
    async delete(key) {
      await port.remove(assertRuntimeStorageKey(key));
    },
    async exists(key) {
      return port.has(assertRuntimeStorageKey(key));
    },
    async health() {
      const probe = `_health/${randomBytes(8).toString("hex")}`;
      const payload = Buffer.from("crevia-storage-health");

      try {
        await port.upload(probe, payload);
        const present = await port.has(probe);
        const read = await port.download(probe);
        await port.remove(probe);
        return present && read && read.equals(payload) ? { ok: true, state: "ok" as const } : { ok: false, state: "down" as const };
      } catch {
        try {
          await port.remove(probe);
        } catch {
          // compensating cleanup
        }

        return { ok: false, state: "down" as const };
      }
    },
  };
}

export function createMemoryAzureBlobPort(): AzureBlobPort & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    store,
    async upload(key, bytes) {
      store.set(key, Buffer.from(bytes));
    },
    async download(key) {
      const value = store.get(key);
      return value ? Buffer.from(value) : null;
    },
    async remove(key) {
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
  };
}

export async function createAzureBlobPortFromEnv(input: {
  account: string;
  container: string;
  connectionString?: string;
  sasUrl?: string;
}): Promise<AzureBlobPort> {
  const { BlobServiceClient, ContainerClient } = await import("@azure/storage-blob");
  const container = input.sasUrl
    ? new ContainerClient(input.sasUrl)
    : input.connectionString
      ? BlobServiceClient.fromConnectionString(input.connectionString).getContainerClient(input.container)
      : await defaultCredentialContainer(input.account, input.container);

  return {
    async upload(key, bytes) {
      await container.getBlockBlobClient(key).uploadData(bytes);
    },
    async download(key) {
      const blob = container.getBlockBlobClient(key);

      try {
        const response = await blob.download();
        const stream = response.readableStreamBody;

        if (!stream) {
          return null;
        }

        const chunks: Buffer[] = [];

        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        return Buffer.concat(chunks);
      } catch (error) {
        if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 404) {
          return null;
        }

        throw error;
      }
    },
    async remove(key) {
      await container.getBlockBlobClient(key).deleteIfExists();
    },
    async has(key) {
      return container.getBlockBlobClient(key).exists();
    },
  };
}

async function defaultCredentialContainer(account: string, containerName: string) {
  const { BlobServiceClient } = await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
  return service.getContainerClient(containerName);
}
