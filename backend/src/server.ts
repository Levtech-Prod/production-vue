import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import categoryRoutes from './routes/partCategories.js';
import partRoutes from './routes/parts.js';
import productRoutes from './routes/products.js';
import productRevisionRoutes from './routes/productRevisions.js';
import subProductRoutes from './routes/subProducts.js';
import productTypeRoutes from './routes/productTypes.js';
import subProductTypeRoutes from './routes/subProductTypes.js';
import path from 'path';
import uploadRoutes from './routes/uploadFiles.js';
import documentRoutes from './routes/documents.js';
import documentTypeRoutes from './routes/documentTypes.js';
import documentRevisionRoutes from './routes/documentRevisions.js';
import companyRoutes from './routes/companies.js';
import stockEntryRoutes from './routes/stockEntries.js';
import auditLogRoutes from './routes/auditLogs.js';
import { ErrorCodes } from './errorCodes.js';
import { startTmpSweeper } from './services/tmpSweeper.js';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/part-categories', categoryRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/products', productRoutes);
app.use('/api/product-revisions', productRevisionRoutes);
app.use('/api/sub-products', subProductRoutes);
app.use('/api/product-types', productTypeRoutes);
app.use('/api/sub-product-types', subProductTypeRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/stock-entries', stockEntryRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// A revision-mode document type with no extension list accepts every file
// extension, so its version files must never be reachable as static content —
// an uploaded .html or .svg would otherwise be stored XSS on this origin. Their
// folders sit inside the served product tree (`.../documents/revisions/`, see
// uploadPaths.ts), so this matches a path SEGMENT rather than a fixed prefix,
// and is registered BEFORE the static mount so it wins. They are read back only
// through the authenticated download route in routes/documentRevisions.ts.
//
// `firmware` is still listed: files migrated from the old firmware feature keep
// their original storage keys (migration 022), so their folders are still named
// that way on disk.
//
// Segments are decoded before comparison: express.static decodes the path
// itself, so a request for `%72evisions` would otherwise slip past this guard
// and still resolve to the same directory.
const UNSERVED_SEGMENTS = new Set(['revisions', 'firmware']);

app.use('/uploads', (req, res, next) => {
  for (const segment of req.path.split('/')) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escape — compare the raw segment rather than throwing.
    }
    if (UNSERVED_SEGMENTS.has(decoded.toLowerCase())) return res.sendStatus(404);
  }
  next();
});
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use('/api', uploadRoutes);
app.use('/api', documentRoutes);
app.use('/api', documentTypeRoutes);
app.use('/api', documentRevisionRoutes);

/** What actually went wrong, for the dev-only `details` below. Includes the
 *  `pg` fields: a failing query says far more through code/detail/constraint
 *  than through its message. */
function errorDetails(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const e = err as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const key of ['message', 'code', 'detail', 'constraint', 'table', 'column']) {
    if (e[key] != null) details[key] = e[key];
  }
  return details;
}

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // Validation errors: return structured, machine-readable issues so the
    // frontend can render localized, field-level messages.
    if (err instanceof ZodError) {
      return res.status(422).json({
        code: ErrorCodes.VALIDATION_FAILED,
        issues: err.issues.map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
          ...('origin' in issue ? { origin: (issue as any).origin } : {}),
          ...('minimum' in issue ? { minimum: (issue as any).minimum } : {}),
          ...('maximum' in issue ? { maximum: (issue as any).maximum } : {}),
          ...('expected' in issue ? { expected: (issue as any).expected } : {}),
        })),
      });
    }

    // BNR unreachable and no cached rate to fall back on — surface as 503 so
    // the client can prompt a retry rather than treating it as a bad request.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === ErrorCodes.BNR_RATE_UNAVAILABLE
    ) {
      return res.status(503).json({ code: ErrorCodes.BNR_RATE_UNAVAILABLE });
    }

    // Nothing above recognised it, so this is a bug or an outage, not a bad
    // request — 500, not the 400 this used to send. A 400 sent the next person
    // hunting through their own payload while the real cause (a schema
    // mismatch, a crashed query) sat only in the server log.
    console.error(`${req.method} ${req.originalUrl}`, err);
    res.status(500).json({
      code: ErrorCodes.REQUEST_FAILED,
      // Never in production (the Dockerfile sets NODE_ENV): the cause can name
      // tables, columns and constraints. In development it saves reading the
      // server log to find out what a failed call actually hit.
      ...(process.env.NODE_ENV !== 'production' ? { details: errorDetails(err) } : {}),
    });
  },
);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
  startTmpSweeper();
});
