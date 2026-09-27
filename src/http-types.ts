import type { ControlPlane, SessionStore } from "./identity.js";
import type { FoundationStore } from "./store.js";

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type ServerDeps = {
  store: FoundationStore;
  sessions: SessionStore;
  controlPlane: ControlPlane;
  provisioningKey: string;
  clientId: string;
  clientSecret: string;
  identityMode: "dev" | "orbia";
  appEnv: string;
  secureCookies: boolean;
};
