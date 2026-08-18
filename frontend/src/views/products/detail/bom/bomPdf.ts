import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/** One BOM line as it appears in the exported table. */
export interface BomPdfRow {
  name: string;
  sku: string;
  quantity: string;
  position: string;
  /** PNG data URL of the part thumbnail; null when the part has no image. */
  thumbnail: string | null;
}

export interface BomPdfMeta {
  title: string;
  /** Which revision the BOM was taken from — shown under the title. */
  subtitle?: string;
  generatedAt: string;
  /** Column headings, in table order: image, name, SKU, quantity, position. */
  columns: [string, string, string, string, string];
  footer: (page: number, pages: number) => string;
}

/** Thumbnail edge in the PDF (mm) and the pixel size it is rasterized at. */
const THUMB_MM = 9;
const THUMB_PX = 64;

const FONT_URLS = {
  normal: '/fonts/Roboto-Regular.ttf',
  bold: '/fonts/Roboto-Bold.ttf',
} as const;

// jsPDF's built-in fonts are cp1252-only, which has no ő or ű — Hungarian part
// names would come out mangled. A Latin/Latin-Extended subset of Roboto is
// shipped as a static asset instead (~28 KB per weight) and registered here.
// Fetched once per page load, since the bytes are identical for every export.
let fontCache: Promise<{ normal: string; bold: string }> | null = null;

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing PDF font asset: ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Chunked: String.fromCharCode(...bytes) on a 28 KB array blows the
  // argument-count limit in some browsers.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function registerRoboto(doc: jsPDF): Promise<void> {
  fontCache ??= Promise.all([
    fetchFontBase64(FONT_URLS.normal),
    fetchFontBase64(FONT_URLS.bold),
  ])
    .then(([normal, bold]) => ({ normal, bold }))
    // A rejected promise would otherwise stay cached and fail every retry.
    .catch((err: unknown) => {
      fontCache = null;
      throw err;
    });

  const font = await fontCache;
  doc.addFileToVFS('Roboto-Regular.ttf', font.normal);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', font.bold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
}

/**
 * Re-encode a part image as a square PNG data URL, cropped like the table's
 * `object-cover` thumbnail.
 *
 * It goes through a canvas rather than embedding the original bytes so jsPDF
 * only ever sees PNG — part images may be WEBP or anything else the browser
 * can decode. Resolves to null when the image is missing or fails to load, so
 * one broken file never fails the whole export.
 */
function loadThumbnail(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_PX;
      canvas.height = THUMB_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, THUMB_PX, THUMB_PX);
      const scale = Math.max(THUMB_PX / img.naturalWidth, THUMB_PX / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (THUMB_PX - w) / 2, (THUMB_PX - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Resolve one thumbnail per input image, index-aligned with `sources`.
 * The same part can appear on several BOM lines, so each distinct URL is
 * fetched and rasterized only once.
 */
export async function loadThumbnails(
  sources: (string | null | undefined)[],
): Promise<(string | null)[]> {
  const byUrl = new Map<string, Promise<string | null>>();
  for (const src of sources) {
    if (src && !byUrl.has(src)) byUrl.set(src, loadThumbnail(src));
  }
  const resolved = new Map(
    await Promise.all(
      [...byUrl].map(async ([url, pending]) => [url, await pending] as const),
    ),
  );
  return sources.map((src) => (src ? (resolved.get(src) ?? null) : null));
}

/** Render the BOM rows as an A4 PDF. */
export async function buildBomPdf(rows: BomPdfRow[], meta: BomPdfMeta): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerRoboto(doc);

  const marginX = 14;

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(meta.title, marginX, 18);

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text([meta.subtitle, meta.generatedAt].filter(Boolean).join('  ·  '), marginX, 24);

  autoTable(doc, {
    startY: 30,
    margin: { top: 14, left: marginX, right: marginX, bottom: 16 },
    head: [meta.columns],
    body: rows.map((row) => ['', row.name, row.sku, row.quantity, row.position]),
    styles: {
      font: 'Roboto',
      fontSize: 9,
      cellPadding: 2,
      valign: 'middle',
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    // Mirrors the .table-head class the on-screen tables use.
    headStyles: {
      font: 'Roboto',
      fontStyle: 'bold',
      fontSize: 8,
      fillColor: [219, 234, 254],
      textColor: [30, 58, 138],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: THUMB_MM + 4, minCellHeight: THUMB_MM + 3 },
      2: { cellWidth: 32, font: 'courier', fontSize: 8, textColor: [100, 116, 139] },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 30, textColor: [100, 116, 139] },
    },
    // The image column is drawn, not typed: autotable has no cell image type.
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const thumbnail = rows[data.row.index]?.thumbnail;
      if (!thumbnail) return;
      doc.addImage(
        thumbnail,
        'PNG',
        data.cell.x + (data.cell.width - THUMB_MM) / 2,
        data.cell.y + (data.cell.height - THUMB_MM) / 2,
        THUMB_MM,
        THUMB_MM,
      );
    },
  });

  // Stamped after the table rather than in didDrawPage: the total page count
  // isn't known until the last row has been laid out.
  const pages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(meta.footer(page, pages), pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  return doc.output('blob');
}
