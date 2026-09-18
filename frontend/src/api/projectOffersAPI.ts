import { api } from './client.ts';
import type {
  OfferCompanyColumn,
  OfferGrid,
  OfferPriceCell,
  OfferPriceResult,
  OfferQueueProject,
} from '../types/projectOffers.ts';

/**
 * Cells per `PUT`. Not the server's `MAX_OFFER_PRICE_CELLS` imported — that is
 * a runtime value in a zod module, and pulling it across would bundle zod and
 * the backend's schema graph into the browser for one number. It is also not
 * the same decision: the server's is the most it will accept, this is how much
 * this client chooses to send at once, and any value at or below the server's
 * is correct. Keep it there.
 */
const PRICE_CELLS_PER_REQUEST = 500;

export const projectOffersApi = {
  /** The list down the left of the Offer Processing page (§6.5) — the board's
   *  *Offers* column, newest first. */
  getQueue() {
    return api.get<OfferQueueProject[]>('/projects/offer-queue');
  },
  /** The whole sheet for one project (§5.2). Refused for a draft, whose parts
   *  are not frozen and so have no cells to point at. */
  getGrid(projectId: number) {
    return api.get<OfferGrid>(`/projects/${projectId}/offer`);
  },
  addCompany(projectId: number, companyId: number) {
    return api.post<OfferCompanyColumn>(`/projects/${projectId}/offer/companies`, { companyId });
  },
  /** Drops the column and, by cascade, every price in it (§3.5). */
  removeCompany(projectId: number, offerCompanyId: number) {
    return api.delete<{ id: number }>(
      `/projects/${projectId}/offer/companies/${offerCompanyId}`,
    );
  },

  /**
   * Write however many edited cells in as few requests as the server's cap
   * allows (§5.2).
   *
   * Chunked because the cap is all-or-nothing — one cell over it and the whole
   * batch is refused with nothing written — and the caller flushes every cell
   * dirtied since the last blur, which it cannot bound. Each chunk is its own
   * transaction, so a refused chunk leaves the earlier ones written; the caller
   * gets the results it did get and reconciles from those.
   */
  async setPrices(projectId: number, cells: OfferPriceCell[]): Promise<OfferPriceResult[]> {
    const results: OfferPriceResult[] = [];
    for (let i = 0; i < cells.length; i += PRICE_CELLS_PER_REQUEST) {
      const { data } = await api.put<{ prices: OfferPriceResult[] }>(
        `/projects/${projectId}/offer/prices`,
        { prices: cells.slice(i, i + PRICE_CELLS_PER_REQUEST) },
      );
      results.push(...data.prices);
    }
    return results;
  },
};
