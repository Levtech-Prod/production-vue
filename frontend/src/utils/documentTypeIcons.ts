// Curated `lucide-vue-next` icon set for document type cards — the single
// source of truth shared by `IconPicker.vue` (Settings) and the Documents
// panel cards (Story 6), per document-system-plan.md §5. Mirrors
// backend/src/schemas/documentTypes.schema.ts's `DOCUMENT_TYPE_ICONS`
// exactly, so every name the backend accepts is resolvable here and vice
// versa. Uses static, direct icon imports (this codebase's convention —
// see Sidebar.vue / DocumentsPanel.vue) rather than a dynamic import, so
// unused icons still get tree-shaken and typos are caught at compile time.
import type { Component } from 'vue';
import {
  // Generic files / documents
  File, FileText, FileCode, FileArchive, FileCheck, FileCog,
  FileDigit, FileImage, FileInput, FileOutput, FileLock,
  FileScan, FileSearch, FileSpreadsheet, FileStack, FileSymlink,
  FileType, FileBadge, FileBox, FileTerminal, FileClock,
  // Folders / archives
  Folder, FolderOpen, FolderTree, FolderArchive, FolderCog,
  Archive,
  // Engineering / manufacturing
  CircuitBoard, Cpu, Component as ComponentIcon, Drill, Factory, Layers,
  Ruler, Wrench, Settings, FlaskConical, Printer,
  // Packaging / inventory
  Package, Box, Boxes,
  // Docs / process
  Clipboard, ClipboardList, ClipboardCheck, BookOpen, BookText,
  // Code / firmware
  Binary, Terminal, Database, HardDrive, Scan,
  // Misc
  ShieldCheck, Download, Upload,
} from 'lucide-vue-next';

// Order mirrors the backend list — drives the picker's default grid order.
export const DOCUMENT_TYPE_ICONS = [
  'file', 'file-text', 'file-code', 'file-archive', 'file-check', 'file-cog',
  'file-digit', 'file-image', 'file-input', 'file-output', 'file-lock',
  'file-scan', 'file-search', 'file-spreadsheet', 'file-stack', 'file-symlink',
  'file-type', 'file-badge', 'file-box', 'file-terminal', 'file-clock',
  'folder', 'folder-open', 'folder-tree', 'folder-archive', 'folder-cog',
  'archive',
  'circuit-board', 'cpu', 'component', 'drill', 'factory', 'layers',
  'ruler', 'wrench', 'settings', 'flask-conical', 'printer',
  'package', 'box', 'boxes',
  'clipboard', 'clipboard-list', 'clipboard-check', 'book-open', 'book-text',
  'binary', 'terminal', 'database', 'hard-drive', 'scan',
  'shield-check', 'download', 'upload',
] as const;

// Not exported — every consumer outside this file works with icon names as
// plain `string` (see DocumentType.icon / DocumentTypeDraft.icon), since a
// row's icon may come back from the API without narrowing to this union.
type DocumentTypeIcon = (typeof DOCUMENT_TYPE_ICONS)[number];

const ICON_COMPONENTS: Record<DocumentTypeIcon, Component> = {
  file: File, 'file-text': FileText, 'file-code': FileCode,
  'file-archive': FileArchive, 'file-check': FileCheck, 'file-cog': FileCog,
  'file-digit': FileDigit, 'file-image': FileImage, 'file-input': FileInput,
  'file-output': FileOutput, 'file-lock': FileLock, 'file-scan': FileScan,
  'file-search': FileSearch, 'file-spreadsheet': FileSpreadsheet,
  'file-stack': FileStack, 'file-symlink': FileSymlink, 'file-type': FileType,
  'file-badge': FileBadge, 'file-box': FileBox, 'file-terminal': FileTerminal,
  'file-clock': FileClock,
  folder: Folder, 'folder-open': FolderOpen, 'folder-tree': FolderTree,
  'folder-archive': FolderArchive, 'folder-cog': FolderCog, archive: Archive,
  'circuit-board': CircuitBoard, cpu: Cpu, component: ComponentIcon,
  drill: Drill, factory: Factory, layers: Layers, ruler: Ruler,
  wrench: Wrench, settings: Settings, 'flask-conical': FlaskConical,
  printer: Printer,
  package: Package, box: Box, boxes: Boxes,
  clipboard: Clipboard, 'clipboard-list': ClipboardList,
  'clipboard-check': ClipboardCheck, 'book-open': BookOpen,
  'book-text': BookText,
  binary: Binary, terminal: Terminal, database: Database,
  'hard-drive': HardDrive, scan: Scan,
  'shield-check': ShieldCheck, download: Download, upload: Upload,
};

const FALLBACK_ICON: DocumentTypeIcon = 'file';

/** Resolves an icon name (as stored on a document type row) to its
 *  lucide-vue-next component, falling back to a generic file icon for any
 *  name outside the curated set (e.g. one added after a row was saved, or
 *  corrupted data) so a card never renders blank. */
export function resolveIcon(name: string | null | undefined): Component {
  if (name && name in ICON_COMPONENTS) return ICON_COMPONENTS[name as DocumentTypeIcon];
  return ICON_COMPONENTS[FALLBACK_ICON];
}
