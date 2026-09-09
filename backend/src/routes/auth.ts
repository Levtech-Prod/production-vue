import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, isUniqueViolation } from '../db.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import { signupSchema, loginSchema } from '../schemas/auth.schema.js';

const router = Router();

function signToken(user: { id: number; email: string; admin: boolean }) {
  return jwt.sign(user, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
}

router.post('/signup', async (req, res) => {
  const data = signupSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 10);
  try {
    const result = await query(
      `INSERT INTO users (username, email, phone, password_hash, admin)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, phone, admin, created_at AS "createdAt"`,
      [data.username, data.email, data.phone || null, passwordHash, data.admin]
    );
    const user = result.rows[0];
    const token = signToken({ id: user.id, email: user.email, admin: user.admin });
    res.json({ user, token });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, ErrorCodes.EMAIL_ALREADY_EXISTS);
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await query(
    `SELECT id, username, email, phone, password_hash AS "passwordHash", admin, created_at AS "createdAt"
     FROM users WHERE email = $1`,
    [data.email]
  );
  const user = result.rows[0];
  if (!user) throw new ApiError(401, ErrorCodes.INVALID_CREDENTIALS);
  const ok = await bcrypt.compare(data.password, user.passwordHash);
  if (!ok) throw new ApiError(401, ErrorCodes.INVALID_CREDENTIALS);
  const safeUser = { id: user.id, username: user.username, email: user.email, phone: user.phone, admin: user.admin, createdAt: user.createdAt };
  res.json({ user: safeUser, token: signToken({ id: user.id, email: user.email, admin: user.admin }) });
});

export default router;
