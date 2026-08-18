import { useI18n } from 'vue-i18n';
import { api } from '../api/client.ts';
import { downloadBlob } from '../utils/downloadBlob.ts';
import { useNotificationStore } from '../stores/notificationStore.ts';

/**
 * Save a file served by an authenticated API endpoint.
 *
 * A plain `<a href>` cannot be used: the download endpoints sit behind
 * `requireAuth`, and a link navigation carries no `Authorization` header — so
 * the browser was getting a 401 instead of a file. The bytes are fetched
 * through the axios client (which attaches the token) and handed to the
 * browser as a blob instead.
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
      downloadBlob(res.data, fileName);
    } catch {
      notify.showToast(t('errors_download_failed'), 'error');
    }
  }

  return { download };
}
