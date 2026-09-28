import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  CODE_TTL_MS,
  CREVIA_APP_KEY,
  CREVIA_SESSION_COOKIE,
  ORBIA_SESSION_COOKIE,
  SESSION_TTL_MS,
  capabilitiesForOrbiaRole,
  capabilityForWrite,
  moduleForWrite,
  resolveModuleKey,
  type CreviaCapability,
  type CreviaIdentityMode,
  type CreviaModuleKey,
  type FreshIntrospectionWrite,
  type OrbiaMembershipRole,
} from "./contract.js";

export type ExchangeGrant = {
  orbiaUserId: string;
  orbiaOrganizationId: string;
  membershipRole: OrbiaMembershipRole;
  modules: CreviaModuleKey[];
  organizationStatus: "active" | "suspended";
  membershipStatus: "active" | "revoked";
  appEnabled: boolean;
  evaluatedAt: string;
};

export type ExchangeFailure =
  | "wrong_app"
  | "wrong_client"
  | "expired"
  | "replay"
  | "invalid_code"
  | "app_disabled"
  | "membership_revoked"
  | "organization_suspended"
  | "live_orbia_disabled";

export type ExchangeResult = { ok: true; grant: ExchangeGrant } | { ok: false; reason: ExchangeFailure };

export type ProductContext = {
  orbiaUserId: string;
  orbiaOrganizationId: string;
  creviaOrganizationId: string;
  membershipRole: OrbiaMembershipRole;
  capabilities: CreviaCapability[];
  modules: CreviaModuleKey[];
  evaluatedAt: string;
};

export type StoredSession = ProductContext & {
  id: string;
  tokenHash: string;
  expiresAt: string;
  createdAt?: string;
  revokedAt: string | null;
};

type IssuedCode = {
  codeHash: string;
  appKey: string;
  clientId: string;
  expiresAt: number;
  consumed: boolean;
  grant: ExchangeGrant;
};

export type IntrospectionView = {
  organizationStatus: "active" | "suspended";
  membershipStatus: "active" | "revoked";
  appEnabled: boolean;
  modules: CreviaModuleKey[];
  evaluatedAt: string;
};

export type IntrospectionResult = { ok: true; view: IntrospectionView } | { ok: false; reason: ExchangeFailure };

export type ControlPlane = {
  exchange(input: {
    code: string;
    appKey: string;
    clientId: string;
    clientSecret: string;
  }): Promise<ExchangeResult>;
  introspect?(input: {
    orbiaUserId: string;
    organizationId: string;
    clientId: string;
    clientSecret: string;
  }): Promise<IntrospectionResult>;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function keysMatch(presented: string, expected: string): boolean {
  if (!presented || !expected) {
    return false;
  }

  const left = Buffer.from(presented);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function createMemoryControlPlane(input: {
  clientId: string;
  clientSecret: string;
  now?: () => number;
}) {
  const codes = new Map<string, IssuedCode>();
  const now = input.now ?? Date.now;

  return {
    issue(
      grant: ExchangeGrant,
      options?: { appKey?: string; clientId?: string; ttlMs?: number; code?: string },
    ) {
      const code = options?.code ?? randomBytes(24).toString("base64url");
      codes.set(hashToken(code), {
        codeHash: hashToken(code),
        appKey: options?.appKey ?? CREVIA_APP_KEY,
        clientId: options?.clientId ?? input.clientId,
        expiresAt: now() + (options?.ttlMs ?? CODE_TTL_MS),
        consumed: false,
        grant,
      });
      return code;
    },
    async exchange(request: {
      code: string;
      appKey: string;
      clientId: string;
      clientSecret: string;
    }): Promise<ExchangeResult> {
      if (request.clientId !== input.clientId || !keysMatch(request.clientSecret, input.clientSecret)) {
        return { ok: false, reason: "wrong_client" };
      }

      if (request.appKey !== CREVIA_APP_KEY) {
        return { ok: false, reason: "wrong_app" };
      }

      const record = codes.get(hashToken(request.code));

      if (!record || record.clientId !== request.clientId) {
        return { ok: false, reason: "invalid_code" };
      }

      if (record.appKey !== CREVIA_APP_KEY) {
        return { ok: false, reason: "wrong_app" };
      }

      if (record.expiresAt <= now()) {
        return { ok: false, reason: "expired" };
      }

      if (record.consumed) {
        return { ok: false, reason: "replay" };
      }

      record.consumed = true;

      if (!record.grant.appEnabled) {
        return { ok: false, reason: "app_disabled" };
      }

      if (record.grant.membershipStatus !== "active") {
        return { ok: false, reason: "membership_revoked" };
      }

      if (record.grant.organizationStatus !== "active") {
        return { ok: false, reason: "organization_suspended" };
      }

      return { ok: true, grant: record.grant };
    },
  };
}

const MEMBERSHIP_ROLES = new Set<OrbiaMembershipRole>(["viewer", "member", "admin", "owner"]);

function mapExchangeFailure(status: number, reason: string): ExchangeFailure {
  if (reason === "wrong_app") return "wrong_app";
  if (reason === "wrong_client" || reason === "server_auth_unconfigured" || status === 401) return "wrong_client";
  if (reason === "expired") return "expired";
  if (reason === "reused" || reason === "replay") return "replay";
  if (reason === "app_disabled") return "app_disabled";
  if (reason === "membership_revoked" || reason === "membership_inactive" || reason === "no_membership") return "membership_revoked";
  if (reason === "organization_suspended" || reason === "organization_inactive") return "organization_suspended";
  return "invalid_code";
}

function modulesFrom(value: unknown): CreviaModuleKey[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? resolveModuleKey(item) : null))
    .filter((item): item is CreviaModuleKey => item !== null);
}

function membershipRoleFrom(value: unknown): OrbiaMembershipRole | null {
  return typeof value === "string" && MEMBERSHIP_ROLES.has(value as OrbiaMembershipRole)
    ? (value as OrbiaMembershipRole)
    : null;
}

async function postOrbia(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    return {
      status: response.status,
      payload: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
    };
  } catch {
    return { status: 0, payload: {} };
  }
}

function grantFromPayload(payload: Record<string, unknown>): ExchangeResult {
  const role = membershipRoleFrom(payload.membershipRole);
  const orbiaUserId = typeof payload.orbiaUserId === "string" ? payload.orbiaUserId : typeof payload.userId === "string" ? payload.userId : "";
  const orbiaOrganizationId = typeof payload.organizationId === "string" ? payload.organizationId : "";
  const app = payload.app && typeof payload.app === "object" ? (payload.app as Record<string, unknown>) : {};
  const evaluatedAt = typeof payload.evaluatedAt === "string" ? payload.evaluatedAt : new Date().toISOString();

  if (!role || !orbiaUserId || !orbiaOrganizationId) {
    return { ok: false, reason: "invalid_code" };
  }

  if (payload.appKey != null && payload.appKey !== CREVIA_APP_KEY) {
    return { ok: false, reason: "wrong_app" };
  }

  const organizationStatus = payload.organizationStatus === "suspended" ? "suspended" : "active";
  const membershipStatus = payload.membershipStatus === "active" || payload.membershipStatus == null ? "active" : "revoked";
  const appEnabled = app.enabled === true;

  return {
    ok: true,
    grant: {
      orbiaUserId,
      orbiaOrganizationId,
      membershipRole: role,
      modules: modulesFrom(payload.modules),
      organizationStatus,
      membershipStatus,
      appEnabled,
      evaluatedAt,
    },
  };
}

/**
 * Live Orbia exchange. Without a base URL this client makes no network call.
 * Infrastructure mode stays available for rollback and does not use this client.
 */
export function createOrbiaExchangeClient(input?: { baseUrl?: string; fetchImpl?: typeof fetch }): ControlPlane {
  const baseUrl = String(input?.baseUrl || "").replace(/\/+$/, "");

  if (!baseUrl) {
    return {
      async exchange() {
        return { ok: false, reason: "live_orbia_disabled" };
      },
    };
  }

  const fetchImpl = input?.fetchImpl ?? fetch;

  function headers(clientId: string, clientSecret: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-orbia-client-id": clientId,
      "x-orbia-client-secret": clientSecret,
    };
  }

  return {
    async exchange(request) {
      const posted = await postOrbia(fetchImpl, `${baseUrl}/api/internal/auth/exchange`, headers(request.clientId, request.clientSecret), {
        code: request.code,
        appKey: request.appKey,
      });

      if (posted.status !== 200 || posted.payload.ok === false) {
        return { ok: false, reason: mapExchangeFailure(posted.status, String(posted.payload.reason || "")) };
      }

      return grantFromPayload(posted.payload);
    },
    async introspect(request) {
      const posted = await postOrbia(fetchImpl, `${baseUrl}/api/internal/auth/introspect`, headers(request.clientId, request.clientSecret), {
        appKey: CREVIA_APP_KEY,
        orbiaUserId: request.orbiaUserId,
        organizationId: request.organizationId,
      });

      if (posted.status !== 200 || posted.payload.ok === false) {
        return { ok: false, reason: mapExchangeFailure(posted.status, String(posted.payload.reason || "")) };
      }

      const granted = grantFromPayload(posted.payload);

      if (!granted.ok) return granted;
      if (granted.grant.orbiaOrganizationId !== request.organizationId || granted.grant.orbiaUserId !== request.orbiaUserId) {
        return { ok: false, reason: "invalid_code" };
      }

      return {
        ok: true,
        view: {
          organizationStatus: granted.grant.organizationStatus,
          membershipStatus: granted.grant.membershipStatus,
          appEnabled: granted.grant.appEnabled,
          modules: granted.grant.modules,
          evaluatedAt: granted.grant.evaluatedAt,
        },
      };
    },
  };
}

export type SessionStore = {
  save(session: StoredSession): Promise<void>;
  find(token: string): Promise<StoredSession | null>;
  values(): Promise<StoredSession[]>;
};

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, StoredSession>();

  return {
    async save(session: StoredSession) {
      sessions.set(session.tokenHash, session);
    },
    async find(token: string) {
      return sessions.get(hashToken(token)) ?? null;
    },
    async values() {
      return [...sessions.values()];
    },
  };
}

function publicContext(session: StoredSession): ProductContext {
  return {
    orbiaUserId: session.orbiaUserId,
    orbiaOrganizationId: session.orbiaOrganizationId,
    creviaOrganizationId: session.creviaOrganizationId,
    membershipRole: session.membershipRole,
    capabilities: session.capabilities,
    modules: session.modules,
    evaluatedAt: session.evaluatedAt,
  };
}

export function sessionCookie(token: string, input: { secure: boolean }): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${CREVIA_SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];

  if (input.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export async function completeCallback(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  controlPlane: ControlPlane;
  sessions: SessionStore;
  creviaOrganizationId: string;
  now?: Date;
  secure?: boolean;
  password?: string;
}) {
  if (input.password) {
    return { ok: false as const, reason: "password_fallback_forbidden" as const };
  }

  const exchanged = await input.controlPlane.exchange({
    code: input.code,
    appKey: CREVIA_APP_KEY,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });

  if (!exchanged.ok) {
    return exchanged;
  }

  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const grant = exchanged.grant;
  const modules = grant.modules
    .map((key) => resolveModuleKey(key))
    .filter((key): key is CreviaModuleKey => key !== null);
  const session: StoredSession = {
    id: `cps_${randomBytes(8).toString("base64url")}`,
    tokenHash: hashToken(token),
    orbiaUserId: grant.orbiaUserId,
    orbiaOrganizationId: grant.orbiaOrganizationId,
    creviaOrganizationId: input.creviaOrganizationId,
    membershipRole: grant.membershipRole,
    capabilities: capabilitiesForOrbiaRole(grant.membershipRole),
    modules,
    evaluatedAt: grant.evaluatedAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    revokedAt: null,
  };
  await input.sessions.save(session);

  return {
    ok: true as const,
    token,
    cookie: sessionCookie(token, { secure: input.secure === true }),
    context: publicContext(session),
  };
}

function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name) {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export async function openLocalSession(input: {
  sessions: SessionStore;
  appEnv: string;
  orbiaUserId: string;
  orbiaOrganizationId: string;
  creviaOrganizationId: string;
  membershipRole: OrbiaMembershipRole;
  modules: CreviaModuleKey[];
  secure?: boolean;
}) {
  if (!devActorAllowed(input.appEnv)) {
    return { ok: false as const, reason: "dev_actor_forbidden" as const };
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session: StoredSession = {
    id: `cps_${randomBytes(8).toString("base64url")}`,
    tokenHash: hashToken(token),
    orbiaUserId: input.orbiaUserId,
    orbiaOrganizationId: input.orbiaOrganizationId,
    creviaOrganizationId: input.creviaOrganizationId,
    membershipRole: input.membershipRole,
    capabilities: capabilitiesForOrbiaRole(input.membershipRole),
    modules: input.modules,
    evaluatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    revokedAt: null,
  };
  await input.sessions.save(session);

  return {
    ok: true as const,
    token,
    cookie: sessionCookie(token, { secure: input.secure === true }),
    context: publicContext(session),
  };
}

export async function authenticateLocalSession(input: {
  cookieHeader: string;
  appEnv: string;
  sessions: SessionStore;
  now?: Date;
}) {
  if (!devActorAllowed(input.appEnv)) {
    return { ok: false as const, reason: "dev_actor_forbidden" as const };
  }

  const cookies = parseCookies(input.cookieHeader);
  const product = cookies.get(CREVIA_SESSION_COOKIE);

  if (!product) {
    return { ok: false as const, reason: "no_session" as const };
  }

  const session = await input.sessions.find(product);

  if (!session || session.revokedAt) {
    return { ok: false as const, reason: "no_session" as const };
  }

  if (Date.parse(session.expiresAt) <= (input.now ?? new Date()).getTime()) {
    return { ok: false as const, reason: "expired" as const };
  }

  return { ok: true as const, context: publicContext(session) };
}

export async function authenticateProductRequest(input: {
  cookieHeader: string;
  mode: CreviaIdentityMode;
  sessions: SessionStore;
  now?: Date;
}) {
  const cookies = parseCookies(input.cookieHeader);
  const orbia = cookies.get(ORBIA_SESSION_COOKIE);
  const product = cookies.get(CREVIA_SESSION_COOKIE);

  if (!product && orbia) {
    return { ok: false as const, reason: "orbia_cookie_rejected" as const };
  }

  if (!product) {
    return { ok: false as const, reason: "no_session" as const };
  }

  if (input.mode === "infrastructure") {
    return { ok: false as const, reason: "infrastructure_mode" as const };
  }

  if (input.mode !== "orbia") {
    return { ok: false as const, reason: "orbia_mode_required" as const };
  }

  const session = await input.sessions.find(product);

  if (!session || session.revokedAt) {
    return { ok: false as const, reason: "no_session" as const };
  }

  if (Date.parse(session.expiresAt) <= (input.now ?? new Date()).getTime()) {
    return { ok: false as const, reason: "expired" as const };
  }

  return { ok: true as const, context: publicContext(session) };
}

export type Directory = {
  organizationStatus: "active" | "suspended";
  membershipStatus: "active" | "revoked";
  appEnabled: boolean;
  modules: CreviaModuleKey[];
  creviaOrganizationId: string;
  evaluatedAt?: string;
};

export function introspect(context: ProductContext, directory: Directory, now = new Date()) {
  if (directory.organizationStatus !== "active") {
    return { ok: false as const, reason: "organization_suspended" as const };
  }

  if (directory.membershipStatus !== "active") {
    return { ok: false as const, reason: "membership_revoked" as const };
  }

  if (!directory.appEnabled) {
    return { ok: false as const, reason: "app_disabled" as const };
  }

  if (context.creviaOrganizationId !== directory.creviaOrganizationId) {
    return { ok: false as const, reason: "organization_mismatch" as const };
  }

  if (!context.orbiaOrganizationId) {
    return { ok: false as const, reason: "missing_organization" as const };
  }

  return {
    ok: true as const,
    context: {
      ...context,
      modules: directory.modules,
      evaluatedAt: directory.evaluatedAt ?? now.toISOString(),
    },
  };
}

export function authorizeSensitiveWrite(input: {
  context: ProductContext | null;
  directory: Directory;
  action: FreshIntrospectionWrite;
}) {
  if (!input.context) {
    return { ok: false as const, reason: "no_session" as const };
  }

  const fresh = introspect(input.context, input.directory);

  if (!fresh.ok) {
    return fresh;
  }

  const moduleKey = moduleForWrite(input.action);

  if (!fresh.context.modules.includes(moduleKey)) {
    return { ok: false as const, reason: "module_disabled" as const };
  }

  const capability = capabilityForWrite(input.action);

  if (!fresh.context.capabilities.includes(capability)) {
    return { ok: false as const, reason: "capability_denied" as const };
  }

  return { ok: true as const, context: fresh.context };
}

export function devActorAllowed(appEnv: string): boolean {
  return appEnv === "LOCAL" || appEnv === "TEST";
}

export function resolveDevActor(appEnv: string) {
  if (!devActorAllowed(appEnv)) {
    return { ok: false as const, reason: "dev_actor_forbidden" as const };
  }

  return {
    ok: true as const,
    actor: {
      orbiaUserId: "fixture_orbia_user",
    },
  };
}

export function identityLookupKey(actor: { orbiaUserId: string; email?: string }) {
  return { orbiaUserId: actor.orbiaUserId };
}
