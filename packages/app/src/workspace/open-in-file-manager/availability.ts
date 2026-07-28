export function resolveOpenInFileManagerPath(input: {
  isElectron: boolean;
  isLocalDaemon: boolean;
  path?: string | null;
}): string | null {
  if (!input.isElectron || !input.isLocalDaemon) return null;
  const path = input.path?.trim();
  return path === undefined || path.length === 0 ? null : path;
}
