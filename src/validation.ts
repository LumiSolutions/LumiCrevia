import { BLOCK_SCHEMA, BREAKPOINTS, type Breakpoint } from "./contract.js";

export type BlockNode = {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
  styles: Record<string, unknown>;
  responsive: Partial<Record<Breakpoint, Record<string, unknown>>>;
  children: BlockNode[];
  metadata: Record<string, unknown>;
};

export type PageSnapshot = {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
  navigationVisible: boolean;
  homepage: boolean;
  seo: {
    title: string;
    description: string;
    canonical: string;
    robots: string;
    ogImage: string;
  };
  blocks: BlockNode[];
};

export type SiteSnapshot = {
  pages: PageSnapshot[];
  theme: {
    colors: Record<string, string>;
    typography: Record<string, string>;
    spacing: Record<string, string>;
    borders: Record<string, string>;
    shadows: Record<string, string>;
    platformBrandingRef: { sourceSystem: "orbia"; externalId: string } | null;
  };
};

export type SnapshotFailure =
  | "invalid_block"
  | "migration_required"
  | "unsafe_html"
  | "unsafe_url"
  | "custom_js_rejected"
  | "duplicate_page";

const URL_KEYS = new Set(["href", "src", "imageUrl", "poster", "ogImage", "canonical"]);
const HTML_KEYS = new Set(["html", "textHtml"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dangerousUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();

  if (trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
    return true;
  }

  return false;
}

function dangerousHtml(value: string): boolean {
  return /<\s*script\b|<\/\s*script\s*>|<\s*iframe\b|\son\w+\s*=|javascript\s*:|data\s*:/i.test(value);
}

function inspectValue(key: string, value: unknown): SnapshotFailure | null {
  if (typeof value !== "string") {
    return null;
  }

  if (key === "customJs" || key === "customJavaScript" || key === "script") {
    return value.trim() ? "custom_js_rejected" : null;
  }

  if (HTML_KEYS.has(key) && dangerousHtml(value)) {
    return "unsafe_html";
  }

  if (URL_KEYS.has(key) && value.trim() && dangerousUrl(value)) {
    return "unsafe_url";
  }

  if (key === "iframeSrc") {
    if (!value.trim()) {
      return null;
    }

    if (!value.trim().toLowerCase().startsWith("https://") || dangerousUrl(value)) {
      return "unsafe_url";
    }
  }

  return null;
}

function inspectRecord(record: Record<string, unknown>): SnapshotFailure | null {
  for (const [key, value] of Object.entries(record)) {
    const direct = inspectValue(key, value);

    if (direct) {
      return direct;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          const nested = inspectValue(key, entry);

          if (nested) {
            return nested;
          }
        }

        if (isRecord(entry)) {
          const nested = inspectRecord(entry);

          if (nested) {
            return nested;
          }
        }
      }
    }

    if (isRecord(value)) {
      const nested = inspectRecord(value);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function inspectBlock(block: BlockNode): SnapshotFailure | null {
  if (!block.id || !block.type || !Number.isInteger(block.version)) {
    return "invalid_block";
  }

  const versions = BLOCK_SCHEMA[block.type];

  if (!versions) {
    return "invalid_block";
  }

  if (!versions.includes(block.version)) {
    return "migration_required";
  }

  if (!isRecord(block.props) || !isRecord(block.styles) || !isRecord(block.metadata)) {
    return "invalid_block";
  }

  if (!Array.isArray(block.children)) {
    return "invalid_block";
  }

  const responsiveKeys = Object.keys(block.responsive ?? {});

  if (responsiveKeys.some((key) => !BREAKPOINTS.includes(key as Breakpoint))) {
    return "invalid_block";
  }

  const props = inspectRecord(block.props);

  if (props) {
    return props;
  }

  const styles = inspectRecord(block.styles);

  if (styles) {
    return styles;
  }

  const responsive = inspectRecord(block.responsive);

  if (responsive) {
    return responsive;
  }

  for (const child of block.children) {
    const nested = inspectBlock(child);

    if (nested) {
      return nested;
    }
  }

  return null;
}

export function inspectSnapshot(snapshot: SiteSnapshot): SnapshotFailure | null {
  const slugs = new Set<string>();

  for (const page of snapshot.pages) {
    if (!page.id || !page.slug) {
      return "invalid_block";
    }

    if (slugs.has(page.slug)) {
      return "duplicate_page";
    }

    slugs.add(page.slug);

    if (page.seo.ogImage && dangerousUrl(page.seo.ogImage)) {
      return "unsafe_url";
    }

    if (page.seo.canonical && dangerousUrl(page.seo.canonical)) {
      return "unsafe_url";
    }

    for (const block of page.blocks) {
      const failure = inspectBlock(block);

      if (failure) {
        return failure;
      }
    }
  }

  return null;
}

export function emptySnapshot(): SiteSnapshot {
  return {
    pages: [],
    theme: {
      colors: {},
      typography: {},
      spacing: {},
      borders: {},
      shadows: {},
      platformBrandingRef: null,
    },
  };
}
