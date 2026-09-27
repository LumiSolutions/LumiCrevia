import { BLOCK_SCHEMA } from "../contract.js";
import type { BlockNode, PageSnapshot, SiteSnapshot } from "../validation.js";
import { emptySnapshot } from "../validation.js";
import { createId } from "./ids.js";

export const LIBRARY_TYPES = ["section", "text", "media", "navigation", "button", "container"] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

export function acceptsChildren(type: string): boolean {
  return type === "section" || type === "container";
}

export function createBlock(type: LibraryType): BlockNode {
  const versions = BLOCK_SCHEMA[type];

  if (!versions?.length) {
    throw new Error(`unknown_block_type:${type}`);
  }

  const version = versions[0]!;
  const props: Record<string, unknown> =
    type === "text"
      ? { content: "New text" }
      : type === "media"
        ? { assetId: "", src: "", alt: "", source: "crevia" }
        : type === "navigation"
          ? { links: [{ label: "Home", href: "/" }] }
          : type === "button"
            ? { label: "Continue", href: "/" }
            : { label: type };

  return {
    id: createId("block"),
    type,
    version,
    props,
    styles: {},
    responsive: { desktop: {}, tablet: {}, mobile: {} },
    children: [],
    metadata: {},
  };
}

export function cloneBlock(block: BlockNode): BlockNode {
  return {
    ...block,
    id: createId("block"),
    props: structuredClone(block.props),
    styles: structuredClone(block.styles),
    responsive: structuredClone(block.responsive),
    metadata: structuredClone(block.metadata),
    children: block.children.map(cloneBlock),
  };
}

export function emptySeo() {
  return { title: "", description: "", canonical: "", robots: "index,follow", ogImage: "" };
}

export function createPageSnapshot(input: {
  title: string;
  slug: string;
  sortOrder: number;
  homepage?: boolean;
  navigationVisible?: boolean;
}): PageSnapshot {
  return {
    id: createId("page"),
    title: input.title,
    slug: input.slug,
    sortOrder: input.sortOrder,
    homepage: input.homepage === true,
    navigationVisible: input.navigationVisible !== false,
    seo: { ...emptySeo(), title: input.title },
    blocks: [],
  };
}

export function starterSnapshot(): SiteSnapshot {
  const home = createPageSnapshot({ title: "Home", slug: "home", sortOrder: 0, homepage: true });
  const about = createPageSnapshot({ title: "About", slug: "about", sortOrder: 1 });
  const hero = createBlock("section");
  const heading = createBlock("text");
  heading.props.content = "Independent strategy for private companies.";
  heading.styles = { fontSize: "40px", fontWeight: "600", lineHeight: "1.2" };
  const body = createBlock("text");
  body.props.content = "A local fixture site for the Crevia visual editor.";
  hero.children = [heading, body];
  home.blocks = [hero];
  about.blocks = [
    (() => {
      const section = createBlock("section");
      const text = createBlock("text");
      text.props.content = "About this fixture. Content stays on this page only.";
      section.children = [text];
      return section;
    })(),
  ];

  return {
    ...emptySnapshot(),
    pages: [home, about],
    theme: {
      colors: { background: "#f7f5f0", surface: "#ffffff", text: "#1b1a17", accent: "#1f6b4a" },
      typography: { fontFamily: "Georgia, serif", headingFamily: "Iowan Old Style, Georgia, serif" },
      spacing: { unit: "8px" },
      borders: { radius: "2px" },
      shadows: {},
      platformBrandingRef: null,
    },
  };
}
