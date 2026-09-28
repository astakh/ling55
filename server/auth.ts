import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { db, User } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret-jwt-key-srs-context-llm-2026';
const ACCESS_TOKEN_TTL_MIN = parseInt(process.env.ACCESS_TOKEN_TTL_MIN || '30', 10);
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);

export interface TokenPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${ACCESS_TOKEN_TTL_MIN}m`,
  });
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createRefreshToken(userId: string, familyId?: string): { token: string; familyId: string } {
  const token = crypto.randomBytes(40).toString('hex');
  const token_hash = hashToken(token);
  const famId = familyId || crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  db.tables.refresh_tokens.push({
    id: crypto.randomUUID(),
    user_id: userId,
    family_id: famId,
    token_hash,
    expires_at: expiresAt.toISOString(),
    revoked_at: null,
    replaced_by: null,
  });
  db.save();

  return { token, familyId: famId };
}

export function rotateRefreshToken(oldToken: string): { accessToken: string; newRefreshToken: string; user: User } | null {
  const tokenHash = hashToken(oldToken);
  const tokenRecord = db.tables.refresh_tokens.find(t => t.token_hash === tokenHash);

  if (!tokenRecord) {
    return null;
  }

  // Reuse detection: if already replaced or revoked, revoke entire family!
  if (tokenRecord.revoked_at || tokenRecord.replaced_by) {
    // Revoke whole family
    for (const t of db.tables.refresh_tokens) {
      if (t.family_id === tokenRecord.family_id) {
        t.revoked_at = new Date().toISOString();
      }
    }
    db.save();
    return null;
  }

  // Check expiration
  if (new Date(tokenRecord.expires_at) < new Date()) {
    tokenRecord.revoked_at = new Date().toISOString();
    db.save();
    return null;
  }

  const user = db.tables.users.find(u => u.id === tokenRecord.user_id);
  if (!user) {
    return null;
  }

  // Issue new token and mark old as replaced
  const { token: newRefreshToken } = createRefreshToken(user.id, tokenRecord.family_id);
  const newHash = hashToken(newRefreshToken);
  tokenRecord.replaced_by = newHash;
  db.save();

  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    isAdmin: user.is_admin,
  });

  return { accessToken, newRefreshToken, user };
}

export function revokeRefreshToken(token: string): void {
  const tokenHash = hashToken(token);
  const record = db.tables.refresh_tokens.find(t => t.token_hash === tokenHash);
  if (record) {
    record.revoked_at = new Date().toISOString();
    db.save();
  }
}

export function revokeAllUserTokens(userId: string): void {
  for (const t of db.tables.refresh_tokens) {
    if (t.user_id === userId) {
      t.revoked_at = new Date().toISOString();
    }
  }
  db.save();
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Требуется авторизация' },
    });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    const user = db.tables.users.find(u => u.id === payload.userId);
    if (!user) {
      res.status(401).json({
        error: { code: 'unauthorized', message: 'Пользователь не найден' },
      });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Недействительный или просроченный токен' },
    });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.is_admin) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ разрешен только администраторам' },
    });
    return;
  }
  next();
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}
