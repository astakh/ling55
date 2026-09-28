import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { User, usersRepo, refreshTokensRepo } from './db.js';

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

export async function createRefreshToken(userId: string, familyId?: string): Promise<{ token: string; familyId: string }> {
  const token = crypto.randomBytes(40).toString('hex');
  const famId = familyId || crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await refreshTokensRepo.create(userId, famId, hashToken(token), expiresAt.toISOString());
  return { token, familyId: famId };
}

export async function rotateRefreshToken(
  oldToken: string
): Promise<{ accessToken: string; newRefreshToken: string; user: User } | null> {
  const tokenHash = hashToken(oldToken);
  const tokenRecord = await refreshTokensRepo.findByHash(tokenHash);

  if (!tokenRecord) {
    return null;
  }

  // Reuse detection: if already replaced or revoked, revoke the entire family!
  if (tokenRecord.revoked_at || tokenRecord.replaced_by) {
    await refreshTokensRepo.revokeFamily(tokenRecord.family_id);
    return null;
  }

  // Check expiration
  if (new Date(tokenRecord.expires_at) < new Date()) {
    await refreshTokensRepo.revokeByHash(tokenHash);
    return null;
  }

  const user = await usersRepo.findById(tokenRecord.user_id);
  if (!user) {
    return null;
  }

  // Issue new token and mark old as replaced
  const { token: newRefreshToken } = await createRefreshToken(user.id, tokenRecord.family_id);
  await refreshTokensRepo.markReplaced(tokenHash, hashToken(newRefreshToken));

  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    isAdmin: user.is_admin,
  });

  return { accessToken, newRefreshToken, user };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await refreshTokensRepo.revokeByHash(hashToken(token));
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await refreshTokensRepo.revokeAllForUser(userId);
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
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (err) {
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Недействительный или просроченный токен' },
    });
    return;
  }

  usersRepo
    .findById(payload.userId)
    .then(user => {
      if (!user) {
        res.status(401).json({
          error: { code: 'unauthorized', message: 'Пользователь не найден' },
        });
        return;
      }
      req.user = user;
      next();
    })
    .catch(err => {
      console.error('AUTH DB error:', err);
      res.status(500).json({
        error: { code: 'internal_server_error', message: 'Ошибка базы данных' },
      });
    });
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
