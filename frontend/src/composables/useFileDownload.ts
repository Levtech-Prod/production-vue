import { useI18n } from 'vue-i18n';
import { api } from '../api/client.ts';
import { useNotificationStore } from '../stores/notificationStore.ts';

/**
 * Save a file served by an authenticated API endpoint.
 *
 * A plain `<a href>` cannot be used: the download endpoints sit behind
 * `requireAuth`, and a link navigation carries no `Authorization` header — so
 * the browser was getting a 401 instead of a file. The bytes are fetched
 * through the axios client (which attaches the token) and handed to the
 * browser as a blob URL instead.
 */
export function useFileDownload() {
  const { t } = useI18n();
  const notify = useNotificationStore();

  async function download(url: string, fileName: string): Promise<void> {
    try {
      // The API returns an app-absolute path ('/api/…'); the axios client is
      // already based at '/api', so the prefix would otherwise be doubled.
      const res = await api.get<Blob>(url.replace(/^\/api(?=\/)/, ''), {
        responseType: 'blob',
      });

      const objectUrl = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoked on the next tick: the download is only queued by `click()`,
      // and revoking in the same task cancels it in some browsers.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      notify.showToast(t('errors_download_failed'), 'error');
    }
  }

  return { download };
}
