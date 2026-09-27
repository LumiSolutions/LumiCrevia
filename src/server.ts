import { createServer } from "node:http";

import { createOrbiaExchangeClient, createSessionStore } from "./identity.js";
import { handleRequest } from "./http.js";
import type { ServerDeps } from "./http-types.js";
import { createFoundationStore } from "./store.js";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function serverDepsFromEnv(): ServerDeps {
  const appEnv = env("CREVIA_APP_ENV") || "LOCAL";
  const identityMode = env("CREVIA_IDENTITY_MODE") === "orbia" ? "orbia" : "dev";

  return {
    store: createFoundationStore(),
    sessions: createSessionStore(),
    controlPlane: createOrbiaExchangeClient(),
    provisioningKey: env("CREVIA_PROVISIONING_KEY") || (appEnv === "LOCAL" || appEnv === "TEST" ? "local-fixture-key" : ""),
    clientId: env("CREVIA_ORBIA_CLIENT_ID"),
    clientSecret: env("CREVIA_ORBIA_CLIENT_SECRET"),
    identityMode,
    appEnv,
    secureCookies: appEnv === "staging" || appEnv === "production",
  };
}

export function createCreviaServer(deps: ServerDeps) {
  return createServer(async (request, response) => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;

    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = {};
      }
    }

    const headers: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(request.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }

    const result = await handleRequest(
      {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers,
        body,
      },
      deps,
    );

    response.writeHead(result.status, result.headers);
    const type = result.headers["content-type"] ?? "";

    if (type.includes("text/html") || type.includes("text/css") || type.includes("javascript") || type.startsWith("image/")) {
      response.end(result.body as string | Buffer);
      return;
    }

    response.end(JSON.stringify(result.body));
  });
}

const invokedDirectly = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");

if (invokedDirectly) {
  const port = Number(env("PORT") || "3000");
  const deps = serverDepsFromEnv();

  if (deps.appEnv !== "LOCAL" && deps.appEnv !== "TEST" && deps.identityMode !== "orbia") {
    console.error("Crevia refuses to start outside LOCAL/TEST without CREVIA_IDENTITY_MODE=orbia");
    process.exit(1);
  }

  createCreviaServer(deps).listen(port, () => {
    console.log(`lumicrevia listening on ${port}`);
  });
}
