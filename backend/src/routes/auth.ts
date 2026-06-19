import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../db.js';

const router = Router();

const signupSchema = z.object({
  username: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(6),
  admin: z.boolean().default(false)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

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
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ message: 'Email already exists' });
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
  if (!user) return res.status(401).json({ message: 'Invalid email or password' });
  const ok = await bcrypt.compare(data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid email or password' });
  const safeUser = { id: user.id, username: user.username, email: user.email, phone: user.phone, admin: user.admin, createdAt: user.createdAt };
  res.json({ user: safeUser, token: signToken({ id: user.id, email: user.email, admin: user.admin }) });
});

export default router;
