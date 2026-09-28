import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAzureBlobAssetStorage, createMemoryAzureBlobPort } from "../src/azure-blob-storage.ts";
import { createRuntimeAssetStorage } from "../src/deps.ts";
import { createUnconfiguredAssetStorage } from "../src/storage.ts";

describe("azure blob asset storage", () => {
  it("puts, gets, checks, deletes, and probes health with organization keys", async () => {
    const port = createMemoryAzureBlobPort();
    const storage = createAzureBlobAssetStorage(port);
    const key = "organizations/corg_a/sites/site_a/assets/asset_a/panel.png";
    const bytes = Buffer.from("89504e470d0a1a0a", "hex");

    await storage.put(key, bytes);
    assert.equal(await storage.exists(key), true);
    assert.deepEqual(await storage.get(key), bytes);
    const health = await storage.health();
    assert.equal(health.ok, true);
    assert.equal([...port.store.keys()].some((entry) => entry.startsWith("_health/")), false);
    await storage.delete(key);
    assert.equal(await storage.exists(key), false);
  });

  it("rejects path traversal and non-organization keys", async () => {
    const storage = createAzureBlobAssetStorage(createMemoryAzureBlobPort());
    await assert.rejects(() => storage.put("../secret", Buffer.from("x")));
    await assert.rejects(() => storage.get("/absolute"));
    await assert.rejects(() => storage.put("organizations/../sites/x/assets/y/file.png", Buffer.from("x")));
    await assert.rejects(() => storage.get("public/file.png"));
  });

  it("does not use the local filesystem when staging Azure config is missing", async () => {
    const previous = {
      env: process.env.CREVIA_APP_ENV,
      driver: process.env.CREVIA_ASSET_STORAGE,
      path: process.env.CREVIA_ASSET_STORAGE_PATH,
      account: process.env.CREVIA_AZURE_STORAGE_ACCOUNT,
      sas: process.env.CREVIA_AZURE_BLOB_SAS_URL,
    };
    process.env.CREVIA_APP_ENV = "staging";
    delete process.env.CREVIA_ASSET_STORAGE;
    delete process.env.CREVIA_ASSET_STORAGE_PATH;
    delete process.env.CREVIA_AZURE_STORAGE_ACCOUNT;
    delete process.env.CREVIA_AZURE_BLOB_SAS_URL;
    const storage = await createRuntimeAssetStorage("staging");
    const health = await storage.health();
    assert.equal(health.ok, false);
    await assert.rejects(() => storage.put("organizations/corg_a/sites/site_a/assets/asset_a/x.png", Buffer.from("x")));
    process.env.CREVIA_APP_ENV = previous.env;
    process.env.CREVIA_ASSET_STORAGE = previous.driver;
    process.env.CREVIA_ASSET_STORAGE_PATH = previous.path;
    process.env.CREVIA_AZURE_STORAGE_ACCOUNT = previous.account;
    process.env.CREVIA_AZURE_BLOB_SAS_URL = previous.sas;
    assert.equal(createUnconfiguredAssetStorage().health().then((row) => row.ok) instanceof Promise, true);
  });
});
