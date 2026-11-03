/**
 * Exact-alias keys. The core stores `project(view, 'aliases', alias)` for every
 * alias and `project(view, 'title', title)` for the title as lookup keys of an
 * alias view, and compares them with `aliasKeys[view]` byte for byte. The
 * fold view is the alias view: "Ke hoach quy bon" finds the alias "Kế hoạch
 * quý bốn" because both fold to the same string.
 */
import type { createProjector } from './views.js';

/** Views whose projected aliases and titles are exact-lookup keys. */
export const ALIAS_VIEWS: readonly string[] = ['fold'];

/**
 * Key of the query in one alias view: the projection of the query exactly as
 * an alias would be projected, with whitespace runs collapsed to one space.
 * Null for a query with nothing to look up.
 */
export function aliasKey(
  view: string,
  query: string,
  project: ReturnType<typeof createProjector>,
): string | null {
  const text = query.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const key = project(view, text);
  return key.length > 0 ? key : null;
}

export function aliasKeys(
  query: string,
  project: ReturnType<typeof createProjector>,
): Record<string, string | null> {
  return Object.fromEntries(ALIAS_VIEWS.map((view) => [view, aliasKey(view, query, project)]));
}
