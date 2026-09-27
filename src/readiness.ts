export type CheckState = "ready" | "degraded" | "missing";

export type ReadinessReport = {
  status: "ready" | "degraded" | "not_ready";
  checks: {
    persistence: CheckState;
    storage: CheckState;
    identity: CheckState;
    provisioning: CheckState;
    migration: CheckState;
    publishing: CheckState;
    builder: CheckState;
    database: CheckState;
  };
};

export function evaluateReadiness(input: {
  identityMode: "dev" | "orbia";
  appEnv: string;
  clientId: string;
  clientSecret: string;
  provisioningKey: string;
  persistence?: CheckState;
  storage?: CheckState;
  migration?: CheckState;
}): ReadinessReport {
  const productionLike = input.appEnv === "staging" || input.appEnv === "production";
  const identityConfigured = Boolean(input.clientId && input.clientSecret);
  const provisioningConfigured = Boolean(input.provisioningKey);

  let identity: CheckState = "ready";

  if (input.identityMode === "orbia") {
    identity = identityConfigured ? "ready" : "missing";
  } else if (productionLike) {
    identity = "missing";
  }

  const publishing: CheckState = "degraded";
  const persistence: CheckState = input.persistence ?? "ready";
  const storage: CheckState = input.storage ?? "ready";
  const migration: CheckState = input.migration ?? "ready";
  const provisioning: CheckState = provisioningConfigured ? "ready" : "missing";
  const builder: CheckState = persistence === "ready" ? "ready" : "missing";
  const database: CheckState = persistence;

  const core = [persistence, identity, provisioning, migration];
  const status = core.includes("missing")
    ? "not_ready"
    : publishing === "degraded" || storage === "degraded" || storage === "missing"
      ? "degraded"
      : "ready";

  return {
    status,
    checks: {
      persistence,
      storage,
      identity,
      provisioning,
      migration,
      publishing,
      builder,
      database,
    },
  };
}

export function healthReport(input?: { database?: "ok" | "down"; assetStorage?: "ok" | "down" }) {
  const database = input?.database ?? "ok";
  const assetStorage = input?.assetStorage ?? "ok";
  const status = database === "ok" && assetStorage === "ok" ? ("ok" as const) : ("degraded" as const);

  return {
    status,
    service: "lumicrevia",
    checks: {
      process: "ok" as const,
      database,
      assetStorage,
    },
  };
}

export function checkStateFromHealth(ok: boolean): CheckState {
  return ok ? "ready" : "missing";
}
