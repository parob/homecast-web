import Fuse from 'fuse.js';

const FUSE_OPTIONS: Fuse.IFuseOptions<never> = {
  threshold: 0.4,
  useExtendedSearch: true,
  ignoreLocation: true,
  includeScore: true,
};

export function createFuse<T>(items: T[], keys: string[]) {
  return new Fuse(items, { ...FUSE_OPTIONS, keys });
}

export function fuseSearch<T>(fuse: Fuse<T>, query: string): T[] {
  if (!query.trim()) return [];
  return fuse.search(query).map(r => r.item);
}

export interface ScoredResult<T> {
  item: T;
  score: number;
}

export function fuseSearchScored<T>(
  fuse: Fuse<T>,
  query: string,
  maxScore: number = 0.3
): ScoredResult<T>[] {
  if (!query.trim()) return [];
  return fuse.search(query)
    .filter(r => (r.score ?? 1) <= maxScore)
    .map(r => ({ item: r.item, score: r.score ?? 1 }));
}
