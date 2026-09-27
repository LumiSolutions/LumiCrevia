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
  };
};

export function evaluateReadiness(input: {
  identityMode: "dev" | "orbia";
  appEnv: string;
  clientId: string;
  clientSecret: string;
  provisioningKey: string;
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
  const storage: CheckState = "degraded";
  const persistence: CheckState = "ready";
  const migration: CheckState = "ready";
  const provisioning: CheckState = provisioningConfigured ? "ready" : "missing";
  const builder: CheckState = persistence === "ready" ? "ready" : "missing";

  const core = [persistence, identity, provisioning, migration];
  const status = core.includes("missing") ? "not_ready" : publishing === "degraded" || storage === "degraded" ? "degraded" : "ready";

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
    },
  };
}

export function healthReport() {
  return {
    status: "ok" as const,
    service: "lumicrevia",
    checks: {
      process: "ok" as const,
    },
  };
}
