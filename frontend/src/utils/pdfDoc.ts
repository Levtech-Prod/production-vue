import { jsPDF } from 'jspdf';

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

/** Register the Roboto subset (covers Hungarian ő/ű) as font "Roboto", normal and bold, on `doc`. */
export async function registerRoboto(doc: jsPDF): Promise<void> {
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

/** Pixel size a thumbnail is rasterized at before being embedded in a PDF. */
const THUMB_PX = 64;

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
      // Everything here is inside the try because a throw in an event handler
      // settles nothing: the promise would stay pending for good, and
      // `loadThumbnails` awaits all of them, so one image would hang the whole
      // export with no error to show for it. `toDataURL` is the live risk —
      // it raises SecurityError on a canvas tainted by a cross-origin image,
      // which `crossOrigin = 'anonymous'` usually prevents but a redirect to
      // another origin can still produce.
      try {
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
      } catch {
        // Same outcome as a failed load: one broken image, not a failed export.
        resolve(null);
      }
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
