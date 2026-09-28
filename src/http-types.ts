import type { CreviaIdentityMode } from "./contract.js";
import type { ControlPlane, SessionStore } from "./identity.js";
import type { FoundationRepository } from "./repository.js";
import type { AssetStorage } from "./storage.js";

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type ServerDeps = {
  repository: FoundationRepository;
  sessions: SessionStore;
  storage: AssetStorage;
  controlPlane: ControlPlane;
  provisioningKey: string;
  clientId: string;
  clientSecret: string;
  identityMode: CreviaIdentityMode;
  appEnv: string;
  secureCookies: boolean;
  orbiaBaseUrl?: string;
};
