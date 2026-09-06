const MEBIBYTE = 1024 * 1024;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const nextPowerOfTwo = (value: number) => {
  const normalized = Math.max(1, Math.ceil(value));
  return 2 ** Math.ceil(Math.log2(normalized));
};

export interface SongPageCachePolicyInput {
  librarySize: number;
  viewportHeight: number;
  rowHeight: number;
  scrollVelocityPxPerSecond?: number;
  memoryBudgetBytes?: number;
  estimatedRowBytes?: number;
}

export interface SongPageCachePolicy {
  visibleRows: number;
  pageSize: number;
  prefetchPages: number;
  maxCachedPages: number;
  maxCachedRows: number;
  cacheWholeLibrary: boolean;
}

export const resolveSongPageCachePolicy = ({
  librarySize,
  viewportHeight,
  rowHeight,
  scrollVelocityPxPerSecond = 0,
  memoryBudgetBytes = 16 * MEBIBYTE,
  estimatedRowBytes = 4 * 1024,
}: SongPageCachePolicyInput): SongPageCachePolicy => {
  const normalizedLibrarySize = Math.max(0, Math.floor(librarySize));
  const normalizedRowHeight = Math.max(1, rowHeight);
  const normalizedViewportHeight = Math.max(normalizedRowHeight, viewportHeight);
  const visibleRows = Math.max(1, Math.ceil(normalizedViewportHeight / normalizedRowHeight));
  const pageSize = clamp(nextPowerOfTwo(visibleRows * 2), 32, 256);

  const viewportsPerSecond = Math.abs(scrollVelocityPxPerSecond) / normalizedViewportHeight;
  const prefetchPages = clamp(1 + Math.ceil(viewportsPerSecond), 1, 4);
  const minimumWindowPages = 1 + prefetchPages * 2;
  const rowsAllowedByMemory = Math.max(
    pageSize,
    Math.floor(Math.max(1, memoryBudgetBytes) / Math.max(1, estimatedRowBytes)),
  );
  const pagesAllowedByMemory = Math.max(1, Math.floor(rowsAllowedByMemory / pageSize));
  const libraryPages = Math.ceil(normalizedLibrarySize / pageSize);
  const cacheWholeLibrary = normalizedLibrarySize <= rowsAllowedByMemory;
  const maxCachedPages = normalizedLibrarySize === 0
    ? 0
    : cacheWholeLibrary
      ? libraryPages
      : Math.min(libraryPages, Math.max(minimumWindowPages, pagesAllowedByMemory));

  return {
    visibleRows,
    pageSize,
    prefetchPages,
    maxCachedPages,
    maxCachedRows: Math.min(normalizedLibrarySize, maxCachedPages * pageSize),
    cacheWholeLibrary,
  };
};
