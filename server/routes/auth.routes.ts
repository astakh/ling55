import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { logger } from '../logger.js';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  setRefreshTokenCookie,
  authenticate,
  AuthenticatedRequest,
} from '../auth.js';

const router = Router();

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    logger.warn('AUTH', 'Registration failed - missing credentials');
    res.status(422).json({
      error: { code: 'validation_error', message: 'Email и пароль обязательны' },
    });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    logger.warn('AUTH', 'Registration failed - invalid email format', { email: cleanEmail });
    res.status(422).json({
      error: { code: 'invalid_email', message: 'Некорректный формат email' },
    });
    return;
  }

  if (password.length < 8 || password.length > 72) {
    logger.warn('AUTH', 'Registration failed - invalid password length');
    res.status(422).json({
      error: { code: 'invalid_password', message: 'Пароль должен быть от 8 до 72 символов' },
    });
    return;
  }

  const existing = db.tables.users.find(u => u.email === cleanEmail);
  if (existing) {
    logger.warn('AUTH', 'Registration conflict - email already registered', { email: cleanEmail });
    res.status(409).json({
      error: { code: 'email_taken', message: 'Этот email уже зарегистрирован' },
    });
    return;
  }

  const password_hash = await hashPassword(password);
  const isFirstUser = db.tables.users.length === 0;

  const newUser = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    password_hash,
    native_language: 'ru',
    timezone: 'Europe/Moscow',
    timezone_changed_at: null,
    is_onboarded: false,
    is_admin: isFirstUser, // First registered user is automatically admin
    active_language_profile_id: null,
    created_at: new Date().toISOString(),
  };

  db.tables.users.push(newUser);
  db.save();
  db.recordEvent(newUser.id, 'signup', { email: cleanEmail });

  logger.success('AUTH', 'User registered successfully', {
    userId: newUser.id,
    email: newUser.email,
    isAdmin: newUser.is_admin,
  });

  const { token: refreshToken } = createRefreshToken(newUser.id);
  setRefreshTokenCookie(res, refreshToken);

  const accessToken = generateAccessToken({
    userId: newUser.id,
    email: newUser.email,
    isAdmin: newUser.is_admin,
  });

  res.json({
    access_token: accessToken,
    user: {
      id: newUser.id,
      email: newUser.email,
      is_onboarded: newUser.is_onboarded,
      is_admin: newUser.is_admin,
      native_language: newUser.native_language,
      timezone: newUser.timezone,
      active_language_profile_id: newUser.active_language_profile_id,
    },
  });
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    logger.warn('AUTH', 'Login failed - missing credentials');
    res.status(401).json({
      error: { code: 'invalid_credentials', message: 'Неверный email или пароль' },
    });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const user = db.tables.users.find(u => u.email === cleanEmail);
  if (!user) {
    logger.warn('AUTH', 'Login failed - user not found', { email: cleanEmail });
    res.status(401).json({
      error: { code: 'invalid_credentials', message: 'Неверный email или пароль' },
    });
    return;
  }

  const isValid = await comparePassword(password, user.password_hash);
  if (!isValid) {
    logger.warn('AUTH', 'Login failed - invalid password', { email: cleanEmail });
    res.status(401).json({
      error: { code: 'invalid_credentials', message: 'Неверный email или пароль' },
    });
    return;
  }

  const { token: refreshToken } = createRefreshToken(user.id);
  setRefreshTokenCookie(res, refreshToken);

  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    isAdmin: user.is_admin,
  });

  logger.success('AUTH', 'User logged in', {
    userId: user.id,
    email: user.email,
  });

  res.json({
    access_token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      is_onboarded: user.is_onboarded,
      is_admin: user.is_admin,
      native_language: user.native_language,
      timezone: user.timezone,
      active_language_profile_id: user.active_language_profile_id,
    },
  });
});

// POST /auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const oldRefreshToken = req.cookies?.refreshToken || req.body?.refresh_token;
  if (!oldRefreshToken) {
    logger.debug('AUTH', 'Refresh failed - no token provided');
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Отсутствует refresh token' },
    });
    return;
  }

  const rotation = rotateRefreshToken(oldRefreshToken);
  if (!rotation) {
    logger.warn('AUTH', 'Refresh failed - token expired or revoked');
    res.clearCookie('refreshToken');
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Сессия истекла или токен отозван' },
    });
    return;
  }

  logger.info('AUTH', 'Token refreshed successfully', { userId: rotation.user.id });
  setRefreshTokenCookie(res, rotation.newRefreshToken);
  res.json({
    access_token: rotation.accessToken,
    user: {
      id: rotation.user.id,
      email: rotation.user.email,
      is_onboarded: rotation.user.is_onboarded,
      is_admin: rotation.user.is_admin,
      native_language: rotation.user.native_language,
      timezone: rotation.user.timezone,
      active_language_profile_id: rotation.user.active_language_profile_id,
    },
  });
});

// POST /auth/logout
router.post('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    revokeRefreshToken(token);
    logger.info('AUTH', 'User logged out and token revoked');
  }
  res.clearCookie('refreshToken');
  res.json({ success: true });
});

// GET /me
router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  logger.debug('AUTH', 'Current user session verified', { userId: user.id });
  res.json({
    user: {
      id: user.id,
      email: user.email,
      is_onboarded: user.is_onboarded,
      is_admin: user.is_admin,
      native_language: user.native_language,
      timezone: user.timezone,
      active_language_profile_id: user.active_language_profile_id,
    },
  });
});

export default router;
