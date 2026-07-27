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
import companyRoutes from './routes/companies.js';
import stockEntryRoutes from './routes/stockEntries.js';
import { ErrorCodes } from './errorCodes.js';

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

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/api', uploadRoutes);
app.use('/api', documentRoutes);

app.use(
  (
    err: unknown,
    _req: express.Request,
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

    console.error(err);
    res.status(400).json({ code: ErrorCodes.REQUEST_FAILED });
  },
);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
