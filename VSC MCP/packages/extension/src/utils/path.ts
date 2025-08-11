import * as path from "path";

// Safe path comparison that works across different platforms
export function arePathsEqual(path1?: string, path2?: string): boolean {
  if (!path1 && !path2) {
    return true;
  }
  if (!path1 || !path2) {
    return false;
  }

  path1 = normalizePath(path1);
  path2 = normalizePath(path2);

  if (process.platform === "win32") {
    return path1.toLowerCase() === path2.toLowerCase();
  }
  return path1 === path2;
}

export function normalizePath(p: string): string {
  // normalize resolve ./.. segments, removes duplicate slashes, and standardizes path separators
  let normalized = path.normalize(p);
  // however it doesn't remove trailing slashes
  // remove trailing slash, except for root paths
  if (normalized.length > 1 && (normalized.endsWith("/") || normalized.endsWith("\\"))) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function toPosixPath(p: string) {
  // Extended-Length Paths in Windows start with "\\?\" to allow longer paths and bypass usual parsing. If detected, we return the path unmodified to maintain functionality, as altering these paths could break their special syntax.
  const isExtendedLengthPath = p.startsWith("\\\\?\\");

  if (isExtendedLengthPath) {
    return p;
  }

  return p.replace(/\\/g, "/");
}