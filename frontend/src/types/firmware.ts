// Firmware versions belonging to a sub-product revision (migration 019).
// A revision carries several firmwares; a firmware belongs to exactly one
// revision, and at most one of a revision's firmwares is `production`.
//
// The payload and status types come from the backend's zod schema so both
// sides describe the same shape from one source of truth. `import type` is
// erased at build time, so this pulls no zod (or any runtime code) into the
// bundle — which is also why the status list below is re-declared as a plain
// array rather than imported as a value.
import type {
  FirmwarePayload as FirmwarePayloadSchema,
  FirmwareStatus,
} from '../../../backend/src/schemas/firmwares.schema.ts';

export type { FirmwareStatus };
export type FirmwarePayload = FirmwarePayloadSchema;

/** Display order for the status filter and the form's status picker. */
export const FIRMWARE_STATUSES = [
  'testing',
  'production',
  'deprecated',
] as const satisfies readonly FirmwareStatus[];

/** A file attached to a firmware. Firmware files are never statically served,
 *  so unlike a document there is no public `path` — only `downloadUrl`. */
export interface FirmwareFile {
  id: number;
  originalName: string;
  sizeBytes: number;
  mimeType: string | null;
  downloadUrl: string;
  createdAt: string;
}

export interface Firmware {
  id: number;
  subProductRevisionId: number;
  name: string;
  status: FirmwareStatus;
  releaseNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /** null when the creating user has since been deleted. */
  createdByName: string | null;
  files: FirmwareFile[];
}
