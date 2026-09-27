import type { PageSnapshot, SiteSnapshot } from "../validation.js";
import { cloneBlock, createPageSnapshot } from "./blocks.js";

export function sortedPages(snapshot: SiteSnapshot): PageSnapshot[] {
  return [...snapshot.pages].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function pageById(snapshot: SiteSnapshot, pageId: string): PageSnapshot | null {
  return snapshot.pages.find((page) => page.id === pageId) ?? null;
}

export function replacePage(snapshot: SiteSnapshot, page: PageSnapshot): SiteSnapshot {
  return {
    ...snapshot,
    pages: snapshot.pages.map((row) => (row.id === page.id ? page : row)),
  };
}

export function addPage(snapshot: SiteSnapshot, input: { title: string; slug: string }): SiteSnapshot {
  const slug = uniqueSlug(snapshot, input.slug);
  const page = createPageSnapshot({
    title: input.title,
    slug,
    sortOrder: snapshot.pages.length,
  });
  return { ...snapshot, pages: [...snapshot.pages, page] };
}

export function renamePage(snapshot: SiteSnapshot, pageId: string, title: string): SiteSnapshot {
  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => (page.id === pageId ? { ...page, title, seo: { ...page.seo, title } } : page)),
  };
}

export function duplicatePage(snapshot: SiteSnapshot, pageId: string): SiteSnapshot {
  const source = pageById(snapshot, pageId);

  if (!source) {
    return snapshot;
  }

  const copy = createPageSnapshot({
    title: `${source.title} copy`,
    slug: uniqueSlug(snapshot, `${source.slug}-copy`),
    sortOrder: snapshot.pages.length,
    homepage: false,
    navigationVisible: source.navigationVisible,
  });
  copy.seo = { ...source.seo, title: copy.title };
  copy.blocks = source.blocks.map(cloneBlock);
  return { ...snapshot, pages: [...snapshot.pages, copy] };
}

export function archivePageInSnapshot(snapshot: SiteSnapshot, pageId: string): SiteSnapshot {
  const remaining = snapshot.pages.filter((page) => page.id !== pageId);

  if (remaining.length === 0) {
    return snapshot;
  }

  if (!remaining.some((page) => page.homepage)) {
    remaining[0] = { ...remaining[0]!, homepage: true };
  }

  return { ...snapshot, pages: remaining };
}

export function markHomepage(snapshot: SiteSnapshot, pageId: string): SiteSnapshot {
  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => ({ ...page, homepage: page.id === pageId })),
  };
}

function uniqueSlug(snapshot: SiteSnapshot, slug: string): string {
  const base = slug.trim() || "page";
  let next = base;
  let index = 2;

  while (snapshot.pages.some((page) => page.slug === next)) {
    next = `${base}-${index}`;
    index += 1;
  }

  return next;
}
