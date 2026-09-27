import { PrismaClient } from "@prisma/client";

import { createOrbiaExchangeClient, createSessionStore, type SessionStore } from "./identity.js";
import { createMemoryRepository } from "./memory-repository.js";
import { createPostgresRepository } from "./postgres-repository.js";
import { createPostgresSessionStore } from "./postgres-sessions.js";
import type { FoundationRepository } from "./repository.js";
import {
  createLocalFilesystemAssetStorage,
  defaultAssetStoragePath,
  type AssetStorage,
} from "./storage.js";
import { createFoundationStore, type FoundationStore } from "./store.js";
import type { ServerDeps } from "./http-types.js";

export type PersistenceMode = "memory" | "postgres";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function localDatabaseUrl(appEnv: string): string {
  const configured = env("DATABASE_URL") || env("DIRECT_DATABASE_URL");

  if (configured) {
    return configured;
  }

  if (appEnv === "LOCAL" || appEnv === "TEST") {
    return "postgresql://crevia:crevia_local_only@127.0.0.1:5432/crevia_local";
  }

  return "";
}

export function resolveAssetStoragePath(appEnv: string): string {
  return env("CREVIA_ASSET_STORAGE_PATH") || defaultAssetStoragePath(appEnv);
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [],
  });
}

export function createMemoryServerDeps(input?: {
  store?: FoundationStore;
  sessions?: SessionStore;
  storage?: AssetStorage;
  provisioningKey?: string;
  clientId?: string;
  clientSecret?: string;
  identityMode?: "dev" | "orbia";
  appEnv?: string;
  secureCookies?: boolean;
}): ServerDeps {
  const store = input?.store ?? createFoundationStore();
  const appEnv = input?.appEnv ?? "TEST";
  const storage = input?.storage ?? createLocalFilesystemAssetStorage(resolveAssetStoragePath(appEnv));

  return {
    repository: createMemoryRepository(store, storage),
    sessions: input?.sessions ?? createSessionStore(),
    storage,
    controlPlane: createOrbiaExchangeClient(),
    provisioningKey: input?.provisioningKey ?? "local-fixture-key",
    clientId: input?.clientId ?? "",
    clientSecret: input?.clientSecret ?? "",
    identityMode: input?.identityMode ?? "dev",
    appEnv,
    secureCookies: input?.secureCookies ?? false,
  };
}

export function createPostgresServerDeps(input: {
  prisma: PrismaClient;
  storage?: AssetStorage;
  sessions?: SessionStore;
  provisioningKey?: string;
  clientId?: string;
  clientSecret?: string;
  identityMode?: "dev" | "orbia";
  appEnv?: string;
  secureCookies?: boolean;
}): ServerDeps {
  const appEnv = input.appEnv ?? "LOCAL";
  const storage = input.storage ?? createLocalFilesystemAssetStorage(resolveAssetStoragePath(appEnv));
  const repository = createPostgresRepository(input.prisma, storage);

  return {
    repository,
    sessions: input.sessions ?? createPostgresSessionStore(input.prisma),
    storage,
    controlPlane: createOrbiaExchangeClient(),
    provisioningKey: input.provisioningKey ?? (appEnv === "LOCAL" || appEnv === "TEST" ? "local-fixture-key" : ""),
    clientId: input.clientId ?? "",
    clientSecret: input.clientSecret ?? "",
    identityMode: input.identityMode ?? "dev",
    appEnv,
    secureCookies: input.secureCookies ?? (appEnv === "staging" || appEnv === "production"),
  };
}

export function serverDepsFromEnv(): ServerDeps & { repository: FoundationRepository } {
  const appEnv = env("CREVIA_APP_ENV") || "LOCAL";
  const identityMode = env("CREVIA_IDENTITY_MODE") === "orbia" ? "orbia" : "dev";
  const databaseUrl = localDatabaseUrl(appEnv);
  const storagePath = resolveAssetStoragePath(appEnv);

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for durable Crevia persistence");
  }

  if (!storagePath) {
    throw new Error("CREVIA_ASSET_STORAGE_PATH is required outside LOCAL/TEST");
  }

  const prisma = createPrismaClient(databaseUrl);
  const storage = createLocalFilesystemAssetStorage(storagePath);

  return createPostgresServerDeps({
    prisma,
    storage,
    provisioningKey: env("CREVIA_PROVISIONING_KEY") || (appEnv === "LOCAL" || appEnv === "TEST" ? "local-fixture-key" : ""),
    clientId: env("CREVIA_ORBIA_CLIENT_ID"),
    clientSecret: env("CREVIA_ORBIA_CLIENT_SECRET"),
    identityMode,
    appEnv,
    secureCookies: appEnv === "staging" || appEnv === "production",
  });
}
