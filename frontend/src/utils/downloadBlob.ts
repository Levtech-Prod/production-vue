/**
 * Hand a blob to the browser as a download named `fileName`.
 *
 * The object URL is revoked on the next tick rather than immediately: the
 * download is only queued by `click()`, and revoking in the same task cancels
 * it in some browsers.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
