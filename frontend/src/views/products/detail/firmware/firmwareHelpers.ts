/**
 * Extensions the browser hands over as a runnable program. Uploading them is
 * allowed — a vendor flashing tool beside the .hex is a normal deliverable —
 * but the file list flags them so nobody double-clicks one unawares.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1',
  '.sh', '.app', '.dmg', '.pkg', '.deb', '.rpm', '.jar', '.apk',
]);

/** The extension of a file name, lowercased and dot-prefixed ('.hex'), or an
 *  empty string when it has none. Mirrors the backend helper of the same name. */
export function fileExtension(fileName: string): string {
  const at = fileName.lastIndexOf('.');
  return at > 0 ? fileName.slice(at).toLowerCase() : '';
}

export function isExecutableFile(fileName: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(fileExtension(fileName));
}
