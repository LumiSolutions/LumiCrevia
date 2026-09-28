/**
 * Local Orbia contract for LumiCrevia.
 * This module does not call Orbia and does not create a platform organization.
 */

export const CREVIA_APP_KEY = "crevia";
export const CREVIA_SESSION_COOKIE = "crevia_session";
export const ORBIA_SESSION_COOKIE = "orbia_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const PREVIEW_TTL_MS = 8 * 60 * 60 * 1000;
export const CODE_TTL_MS = 90_000;

export type CreviaIdentityMode = "dev" | "orbia" | "infrastructure";

export function parseIdentityMode(value: string | undefined): CreviaIdentityMode {
  if (value === "orbia" || value === "infrastructure" || value === "dev") {
    return value;
  }

  return "dev";
}

export function infrastructureModeAllowed(appEnv: string): boolean {
  return appEnv === "staging" || appEnv === "STAGING";
}

export function cloudStartupAllowed(appEnv: string, identityMode: CreviaIdentityMode): boolean {
  if (appEnv === "LOCAL" || appEnv === "TEST") {
    return true;
  }

  if (identityMode === "orbia") {
    return true;
  }

  return identityMode === "infrastructure" && infrastructureModeAllowed(appEnv);
}
export type OrbiaMembershipRole = "viewer" | "member" | "admin" | "owner";
export type ModuleAvailability = "available" | "planned";

export type CreviaModuleKey =
  | "crevia.dashboard"
  | "crevia.sites"
  | "crevia.pages"
  | "crevia.builder"
  | "crevia.assets"
  | "crevia.themes"
  | "crevia.preview"
  | "crevia.publishing"
  | "crevia.domains"
  | "crevia.templates";

export type CreviaCapability =
  | "SITE_READ"
  | "SITE_WRITE"
  | "PAGE_WRITE"
  | "BUILDER_WRITE"
  | "ASSET_WRITE"
  | "THEME_WRITE"
  | "PREVIEW_READ"
  | "PUBLISH"
  | "DOMAIN_WRITE"
  | "TEMPLATE_PUBLISH";

export type ModuleDescriptor = {
  key: CreviaModuleKey;
  displayName: string;
  availability: ModuleAvailability;
  /** True when this repository enforces the key on the server. */
  serverGate: boolean;
  /** Orbia catalog still lists only crevia.sites, and that entry stays planned. */
  orbiaCatalogToday: boolean;
  notes: string;
};

/**
 * Derived from this repository.
 * Dashboard and templates stay planned.
 * Builder now has a local visual editor. The other keys keep server gates.
 * None of these keys are activated in the Orbia catalog by this wave.
 */
export const MODULE_DESCRIPTORS: readonly ModuleDescriptor[] = [
  {
    key: "crevia.dashboard",
    displayName: "Dashboard",
    availability: "planned",
    serverGate: false,
    orbiaCatalogToday: false,
    notes: "No dashboard surface exists in this repository.",
  },
  {
    key: "crevia.sites",
    displayName: "Websites",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: true,
    notes: "Site index and archive. Orbia still marks the catalog entry planned.",
  },
  {
    key: "crevia.pages",
    displayName: "Pages",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Page index inside a site. Not an organization.",
  },
  {
    key: "crevia.builder",
    displayName: "Builder",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Draft save gate plus the local visual editor. Undo is client-side only.",
  },
  {
    key: "crevia.assets",
    displayName: "Assets",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Website asset metadata plus local durable bytes for Crevia uploads.",
  },
  {
    key: "crevia.themes",
    displayName: "Themes",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Website theme tokens. Not Orbia platform branding.",
  },
  {
    key: "crevia.preview",
    displayName: "Preview",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Draft preview requires a token. Published preview reads the snapshot.",
  },
  {
    key: "crevia.publishing",
    displayName: "Publishing",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Publication records only. No cloud publish target is configured.",
  },
  {
    key: "crevia.domains",
    displayName: "Domains",
    availability: "available",
    serverGate: true,
    orbiaCatalogToday: false,
    notes: "Hostname metadata only. No DNS or certificate mutation.",
  },
  {
    key: "crevia.templates",
    displayName: "Templates",
    availability: "planned",
    serverGate: false,
    orbiaCatalogToday: false,
    notes: "Schema validation exists. There is no template catalog.",
  },
];

export const FRESH_INTROSPECTION_WRITES = [
  "publish",
  "domain.change",
  "asset.delete",
  "site.delete",
  "theme.global.update",
  "template.publication",
] as const;

export type FreshIntrospectionWrite = (typeof FRESH_INTROSPECTION_WRITES)[number];

export const SNAPSHOT_OK_READS = [
  "dashboard.read",
  "site.read",
  "page.read",
  "builder.read",
  "asset.read",
  "theme.read",
  "preview.read",
] as const;

export type SnapshotRead = (typeof SNAPSHOT_OK_READS)[number];

const WRITE_MODULES: Record<FreshIntrospectionWrite, CreviaModuleKey> = {
  publish: "crevia.publishing",
  "domain.change": "crevia.domains",
  "asset.delete": "crevia.assets",
  "site.delete": "crevia.sites",
  "theme.global.update": "crevia.themes",
  "template.publication": "crevia.templates",
};

const WRITE_CAPABILITIES: Record<FreshIntrospectionWrite, CreviaCapability> = {
  publish: "PUBLISH",
  "domain.change": "DOMAIN_WRITE",
  "asset.delete": "ASSET_WRITE",
  "site.delete": "SITE_WRITE",
  "theme.global.update": "THEME_WRITE",
  "template.publication": "TEMPLATE_PUBLISH",
};

const ROLE_CAPABILITIES: Record<OrbiaMembershipRole, readonly CreviaCapability[]> = {
  viewer: ["SITE_READ", "PREVIEW_READ"],
  member: [
    "SITE_READ",
    "SITE_WRITE",
    "PAGE_WRITE",
    "BUILDER_WRITE",
    "ASSET_WRITE",
    "PREVIEW_READ",
  ],
  admin: [
    "SITE_READ",
    "SITE_WRITE",
    "PAGE_WRITE",
    "BUILDER_WRITE",
    "ASSET_WRITE",
    "THEME_WRITE",
    "PREVIEW_READ",
    "PUBLISH",
    "DOMAIN_WRITE",
  ],
  owner: [
    "SITE_READ",
    "SITE_WRITE",
    "PAGE_WRITE",
    "BUILDER_WRITE",
    "ASSET_WRITE",
    "THEME_WRITE",
    "PREVIEW_READ",
    "PUBLISH",
    "DOMAIN_WRITE",
    "TEMPLATE_PUBLISH",
  ],
};

export const BLOCK_SCHEMA: Record<string, readonly number[]> = {
  section: [1],
  text: [1],
  media: [1],
  navigation: [1],
  button: [1],
  container: [1],
};

export const BREAKPOINTS = ["desktop", "tablet", "mobile"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

export function capabilitiesForOrbiaRole(role: OrbiaMembershipRole): CreviaCapability[] {
  return [...ROLE_CAPABILITIES[role]];
}

export function moduleForWrite(action: FreshIntrospectionWrite): CreviaModuleKey {
  return WRITE_MODULES[action];
}

export function capabilityForWrite(action: FreshIntrospectionWrite): CreviaCapability {
  return WRITE_CAPABILITIES[action];
}

export function resolveModuleKey(value: string): CreviaModuleKey | null {
  const match = MODULE_DESCRIPTORS.find((module) => module.key === value);
  return match ? match.key : null;
}

export function isFreshIntrospectionWrite(action: string): action is FreshIntrospectionWrite {
  return (FRESH_INTROSPECTION_WRITES as readonly string[]).includes(action);
}
