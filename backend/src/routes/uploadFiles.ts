import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

type UploadTarget =
  | 'part-categories'
  | 'parts'
  | 'products'
  | 'suppliers'
  | 'temp';

const allowedTargets: UploadTarget[] = [
  'part-categories',
  'parts',
  'products',
  'suppliers',
  'temp',
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
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error('Only JPG, PNG and WEBP files are allowed'));
    }

    callback(null, true);
  },
});

router.post('/upload/:target', upload.single('file'), (req, res) => {
  const target = req.params.target as UploadTarget;

  if (!allowedTargets.includes(target)) {
    return res.status(400).json({
      message: 'Invalid upload target',
    });
  }

  if (!req.file) {
    return res.status(400).json({
      message: 'No file uploaded',
    });
  }

  res.json({
    filename: req.file.filename,
    path: `/uploads/${target}/${req.file.filename}`,
    url: `${req.protocol}://${req.get('host')}/uploads/${target}/${req.file.filename}`,
  });
});

export default router;
