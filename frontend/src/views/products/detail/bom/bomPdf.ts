import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerRoboto } from '../../../../utils/pdfDoc.ts';
export { loadThumbnails } from '../../../../utils/pdfDoc.ts';

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

/** Thumbnail edge in the PDF (mm). */
const THUMB_MM = 9;

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
