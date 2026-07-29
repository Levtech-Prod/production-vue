// ===========================================================================
// Exchange rate service — BNR (Banca Nationala a Romaniei) reference rates.
// ---------------------------------------------------------------------------
// Part prices are stored canonically in EUR. When a price is entered in RON it
// is converted using the BNR reference rate for the entry date, frozen at
// write time. Rates are cached in `exchange_rates` and fetched lazily: if a
// write needs a rate we don't have yet, we fetch BNR once and cache it. No
// background scheduler is required.
//
// BNR quotes RON as the origin currency, so a rate is "RON per 1 unit of the
// foreign currency" (e.g. EUR 5.2327 => 1 EUR = 5.2327 RON). Some currencies
// are published with a multiplier (e.g. HUF per 100); we normalise to per-unit
// before caching. Rates publish on business days ~13:00 Bucharest time only —
// weekends, holidays and the pre-publication window are covered by looking up
// the most recent rate on or before the requested date.
// ===========================================================================
import { query } from '../db.js';
import { ErrorCodes } from '../errorCodes.js';

const BNR_DAILY_URL = 'https://www.bnr.ro/nbrfxrates.xml';

/** Raised when no rate is cached for a currency and BNR cannot be reached. */
export class BnrRateUnavailableError extends Error {
  code = ErrorCodes.BNR_RATE_UNAVAILABLE;
  constructor(currency: string) {
    super(`No BNR exchange rate available for ${currency}`);
    this.name = 'BnrRateUnavailableError';
  }
}

/** Round to 4 decimals (canonical EUR precision) avoiding fp drift. */
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/** Current calendar date in Europe/Bucharest as 'YYYY-MM-DD'. */
export function bucharestToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface ParsedBnr {
  date: string;
  rates: Record<string, number>; // currency -> RON per 1 unit
}

/** Parse the flat BNR daily XML without pulling in an XML dependency. */
function parseBnrXml(xml: string): ParsedBnr {
  const dateMatch = xml.match(/<Cube\s+date="(\d{4}-\d{2}-\d{2})"/);
  if (!dateMatch) {
    throw new Error('Unexpected BNR XML: no Cube date');
  }
  const date = dateMatch[1];

  const rates: Record<string, number> = {};
  const rateRe =
    /<Rate\s+currency="([A-Z]{3})"(?:\s+multiplier="(\d+)")?\s*>([\d.]+)<\/Rate>/g;
  let m: RegExpExecArray | null;
  while ((m = rateRe.exec(xml)) !== null) {
    const [, currency, multiplier, value] = m;
    const perUnit = Number(value) / (multiplier ? Number(multiplier) : 1);
    if (Number.isFinite(perUnit) && perUnit > 0) {
      rates[currency] = perUnit;
    }
  }
  // RON expressed in RON is 1:1 — handy for uniform conversion.
  rates.RON = 1;
  return { date, rates };
}

/**
 * Fetch today's BNR rates and upsert them into the cache. Idempotent on
 * (rate_date, currency). Returns the parsed payload.
 */
export async function fetchAndCacheBnr(): Promise<ParsedBnr> {
  const res = await fetch(BNR_DAILY_URL, {
    headers: { Accept: 'application/xml' },
  });
  if (!res.ok) {
    throw new Error(`BNR request failed with status ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parseBnrXml(xml);

  for (const [currency, rate] of Object.entries(parsed.rates)) {
    if (currency === 'RON') continue; // no need to cache the 1:1 identity
    await query(
      `INSERT INTO exchange_rates (rate_date, currency, rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (rate_date, currency) DO NOTHING`,
      [parsed.date, currency, rate],
    );
  }
  return parsed;
}

/**
 * RON per 1 unit of `currency` for `onDate`, using the most recent rate on or
 * before that date. Falls back to fetching BNR once if nothing is cached yet.
 * Returns the rate and the date it actually came from.
 */
export async function getRate(
  currency: string,
  onDate: string,
): Promise<{ rate: number; rateDate: string }> {
  if (currency === 'RON') return { rate: 1, rateDate: onDate };

  const lookup = async () =>
    query<{ rate: string; rate_date: string }>(
      `SELECT rate, to_char(rate_date, 'YYYY-MM-DD') AS rate_date
       FROM exchange_rates
       WHERE currency = $1 AND rate_date <= $2
       ORDER BY rate_date DESC
       LIMIT 1`,
      [currency, onDate],
    );

  let result = await lookup();
  if (result.rows.length === 0) {
    // Nothing cached on/before the date — pull the latest from BNR and retry.
    await fetchAndCacheBnr();
    result = await lookup();
  }
  if (result.rows.length === 0) {
    throw new BnrRateUnavailableError(currency);
  }
  return {
    rate: Number(result.rows[0].rate),
    rateDate: result.rows[0].rate_date,
  };
}

export interface ConversionResult {
  /** Canonical price in EUR, rounded to 4 decimals. */
  priceEur: number;
  /** RON-per-EUR rate applied; null when entered directly in EUR. */
  rateUsed: number | null;
  /** BNR rate date applied; null when entered directly in EUR. */
  rateDate: string | null;
}

export type EntryCurrency = 'EUR' | 'RON';

/**
 * Convert an entered amount to canonical EUR using the BNR EUR rate for
 * `onDate`. EUR passes through unchanged (no rate recorded); RON is divided by
 * the RON-per-EUR rate.
 */
export async function convertToEur(
  amount: number,
  currency: EntryCurrency,
  onDate: string = bucharestToday(),
): Promise<ConversionResult> {
  if (currency === 'EUR') {
    return { priceEur: round4(amount), rateUsed: null, rateDate: null };
  }
  const { rate, rateDate } = await getRate('EUR', onDate);
  return {
    priceEur: round4(amount / rate),
    rateUsed: rate,
    rateDate,
  };
}
