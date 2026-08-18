import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFileSave } from '../../../../../composables/useFileSave.ts';

/** A BOM line as the panel holds it, before it is shaped for the PDF. */
export interface BomExportRow {
  name: string;
  code: string;
  quantity: number | string;
  unit?: string | null;
  mountPosition?: string | null;
  image?: string | null;
}

export interface BomExportSource {
  productName: string;
  /** Product revision label — names the file and prints under the title. */
  revisionLabel?: string;
  rows: BomExportRow[];
}

/** Filename-safe form of one name segment. */
function slugify(value: string): string {
  return (
    value
      // Strips the accents rather than dropping the letters: "Előlap" would
      // otherwise slug down to "el-lap".
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  );
}

/**
 * Export the BOM rows as a PDF the user saves wherever they like.
 *
 * The browser's own save dialog takes both the folder and the file name, so
 * there is no in-app naming step — the name below is only what it opens with.
 *
 * `source` is a getter rather than plain values so the export always reflects
 * the rows on screen at the moment the button is pressed.
 */
export function useBomPdfExport(source: () => BomExportSource) {
  const { t } = useI18n();
  const { save } = useFileSave();

  const exporting = ref(false);

  /** `{product-name}_{product-revision}_{unix-seconds}.pdf` */
  function defaultFileName({ productName, revisionLabel }: BomExportSource): string {
    const segments = [slugify(productName) || 'bom'];
    const revision = revisionLabel ? slugify(revisionLabel) : '';
    if (revision) segments.push(revision);
    segments.push(String(Math.floor(Date.now() / 1000)));
    return `${segments.join('_')}.pdf`;
  }

  async function exportPdf(): Promise<void> {
    if (exporting.value) return;
    const { productName, revisionLabel, rows } = source();

    exporting.value = true;
    try {
      await save(
        defaultFileName({ productName, revisionLabel, rows }),
        'application/pdf',
        async () => {
          // Imported here, not at module scope: jsPDF and its table plugin are
          // ~400 KB that only an export needs, and this is the one entry point.
          const { buildBomPdf, loadThumbnails } = await import('../bomPdf.ts');
          const thumbnails = await loadThumbnails(rows.map((row) => row.image));
          return buildBomPdf(
            rows.map((row, i) => ({
              name: row.name,
              sku: row.code,
              quantity: `${row.quantity}${row.unit ? ` ${row.unit}` : ''}`,
              position: row.mountPosition || '—',
              thumbnail: thumbnails[i] ?? null,
            })),
            {
              title: productName,
              subtitle: revisionLabel,
              generatedAt: t('generated_at', { date: new Date().toLocaleString() }),
              columns: [
                t('image'),
                t('name'),
                t('sku'),
                t('quantity'),
                t('mount_position'),
              ],
              footer: (page, pages) => t('page_x_of_y', { current: page, total: pages }),
            },
          );
        },
      );
    } finally {
      exporting.value = false;
    }
  }

  return { exporting, exportPdf };
}
