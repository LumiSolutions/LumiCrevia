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

export type ControlPlane = {
  exchange(input: {
    code: string;
    appKey: string;
    clientId: string;
    clientSecret: string;
  }): Promise<ExchangeResult>;
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

/** Wave 7A never calls Orbia. A later wave replaces this client. */
export function createOrbiaExchangeClient(): ControlPlane {
  return {
    async exchange() {
      return { ok: false, reason: "live_orbia_disabled" };
    },
  };
}

export function createSessionStore() {
  const sessions = new Map<string, StoredSession>();

  return {
    save(session: StoredSession) {
      sessions.set(session.tokenHash, session);
    },
    find(token: string) {
      return sessions.get(hashToken(token)) ?? null;
    },
    values() {
      return [...sessions.values()];
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;

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
    revokedAt: null,
  };
  input.sessions.save(session);

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

export function openLocalSession(input: {
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
    revokedAt: null,
  };
  input.sessions.save(session);

  return {
    ok: true as const,
    token,
    cookie: sessionCookie(token, { secure: input.secure === true }),
    context: publicContext(session),
  };
}

export function authenticateLocalSession(input: {
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

  const session = input.sessions.find(product);

  if (!session || session.revokedAt) {
    return { ok: false as const, reason: "no_session" as const };
  }

  if (Date.parse(session.expiresAt) <= (input.now ?? new Date()).getTime()) {
    return { ok: false as const, reason: "expired" as const };
  }

  return { ok: true as const, context: publicContext(session) };
}

export function authenticateProductRequest(input: {
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

  if (input.mode !== "orbia") {
    return { ok: false as const, reason: "orbia_mode_required" as const };
  }

  const session = input.sessions.find(product);

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
