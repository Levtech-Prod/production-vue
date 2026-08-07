import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ErrorCodes } from '../errorCodes.js';
import { tmpDir, TMP_PUBLIC_PREFIX } from '../services/uploadPaths.js';

const router = express.Router();

// Product and sub-product images are NOT targets: they live inside the owning
// entity's folder, whose id does not exist yet when the form uploads them. They
// go to `temp` and the create/update handler files them (see entityImages.ts).
type UploadTarget = 'part-categories' | 'parts' | 'suppliers' | 'temp';

const allowedTargets: UploadTarget[] = [
  'part-categories',
  'parts',
  'suppliers',
  'temp',
];

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

const baseUploadDir = path.join(process.cwd(), 'uploads');

// `temp` is the staging area shared with entityImages.ts; the rest are flat
// folders for entities that are not product-owned.
function ensureUploadFolder(target: UploadTarget) {
  const uploadDir = target === 'temp' ? tmpDir : path.join(baseUploadDir, target);

  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  return uploadDir;
}

const storage = multer.diskStorage({
  destination: (req, _file, callback) => {
    const target = req.params.target as UploadTarget;

    if (!allowedTargets.includes(target)) {
      return callback(new Error('Invalid upload target'), '');
    }

    const uploadDir = ensureUploadFolder(target);

    callback(null, uploadDir);
  },

  filename: (_req, file, callback) => {
    const safeExtension = path.extname(file.originalname).toLowerCase();

    const uniqueName = `${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}${safeExtension}`;

    callback(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!imageTypes.includes(file.mimetype)) {
      return callback(new Error('Only JPG, PNG and WEBP files are allowed'));
    }

    callback(null, true);
  },
});

router.post('/upload/:target', upload.single('file'), (req, res) => {
  const target = req.params.target as UploadTarget;

  if (!allowedTargets.includes(target)) {
    return res.status(400).json({
      code: ErrorCodes.INVALID_UPLOAD_TARGET,
    });
  }

  if (!req.file) {
    return res.status(400).json({
      code: ErrorCodes.NO_FILE_UPLOADED,
    });
  }

  // `temp` maps to the `_tmp` folder, not a folder literally named "temp".
  const publicDir = target === 'temp' ? TMP_PUBLIC_PREFIX : `/uploads/${target}`;

  res.json({
    filename: req.file.filename,
    // Relative path only — the app is always served behind a reverse proxy
    // (nginx) that also proxies /uploads/ to this service, so a relative
    // path resolves correctly against whatever origin the client used.
    // Building an absolute URL here from req.protocol/req.get('host') picks
    // up the proxy's internal address instead of a client-reachable one.
    path: `${publicDir}/${req.file.filename}`,
  });
});

export default router;
