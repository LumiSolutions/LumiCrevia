import { createServer } from "node:http";

import { cloudStartupAllowed } from "./contract.js";
import { serverDepsFromEnv } from "./deps.js";
import { handleRequest } from "./http.js";
import type { ServerDeps } from "./http-types.js";

export { serverDepsFromEnv } from "./deps.js";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
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

    if (Buffer.isBuffer(result.body)) {
      response.end(result.body);
      return;
    }

    const type = result.headers["content-type"] ?? "";

    if (type.includes("text/html") || type.includes("text/css") || type.includes("javascript") || type.startsWith("image/")) {
      response.end(result.body as string | Buffer);
      return;
    }

    response.end(JSON.stringify(result.body));
  });
}

const invokedDirectly = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");

async function startFromEnv() {
  const port = Number(env("PORT") || "3000");
  const deps = await serverDepsFromEnv();

  if (!cloudStartupAllowed(deps.appEnv, deps.identityMode)) {
    console.error("Crevia refuses to start outside LOCAL/TEST without CREVIA_IDENTITY_MODE=orbia or staging infrastructure mode");
    process.exit(1);
  }

  createCreviaServer(deps).listen(port, "0.0.0.0", () => {
    console.log(`lumicrevia listening on ${port}`);
  });
}

if (invokedDirectly) {
  void startFromEnv();
}
