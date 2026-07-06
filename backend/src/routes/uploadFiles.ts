import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ErrorCodes } from '../errorCodes.js';

const router = express.Router();

type UploadTarget =
  | 'part-categories'
  | 'parts'
  | 'products'
  | 'sub-products'
  | 'suppliers'
  | 'documents'
  | 'temp';

const allowedTargets: UploadTarget[] = [
  'part-categories',
  'parts',
  'products',
  'sub-products',
  'suppliers',
  'documents',
  'temp',
];

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const documentTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  ...imageTypes,
];

const baseUploadDir = path.join(process.cwd(), 'uploads');

function ensureUploadFolder(target: UploadTarget) {
  const uploadDir = path.join(baseUploadDir, target);

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
  fileFilter: (req, file, callback) => {
    const target = req.params.target as UploadTarget;
    const allowed = target === 'documents' ? documentTypes : imageTypes;

    if (!allowed.includes(file.mimetype)) {
      return callback(
        new Error(
          target === 'documents'
            ? 'Only PDF, Word, Excel, plain text and image files are allowed'
            : 'Only JPG, PNG and WEBP files are allowed',
        ),
      );
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

  res.json({
    filename: req.file.filename,
    path: `/uploads/${target}/${req.file.filename}`,
    url: `${req.protocol}://${req.get('host')}/uploads/${target}/${req.file.filename}`,
  });
});

export default router;
