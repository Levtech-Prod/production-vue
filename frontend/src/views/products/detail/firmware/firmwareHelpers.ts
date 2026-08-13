import type { FirmwareStatus } from '../../../../types/firmware.ts';

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

/** Status dot colour, shared by the change log and the details pane. */
export function statusDot(status: FirmwareStatus): string {
  return (
    {
      testing: 'bg-amber-500',
      production: 'bg-emerald-500',
      deprecated: 'bg-slate-400',
    }[status] ?? 'bg-slate-400'
  );
}

/** Text badge accompanying the dot — status is never colour-only. */
export function statusBadgeClass(status: FirmwareStatus): string {
  return (
    {
      testing: 'bg-amber-50 text-amber-700',
      production: 'bg-emerald-50 text-emerald-700',
      deprecated: 'bg-slate-100 text-slate-600',
    }[status] ?? 'bg-slate-100 text-slate-600'
  );
}
