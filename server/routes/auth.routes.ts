import { Router, Request, Response } from 'express';
import { usersRepo, eventsRepo } from '../db.js';
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

function publicUser(u: {
  id: string; email: string; is_onboarded: boolean; is_admin: boolean;
  native_language: string; timezone: string; active_language_profile_id: string | null;
}) {
  return {
    id: u.id,
    email: u.email,
    is_onboarded: u.is_onboarded,
    is_admin: u.is_admin,
    native_language: u.native_language,
    timezone: u.timezone,
    active_language_profile_id: u.active_language_profile_id,
  };
}

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

  try {
    const existing = await usersRepo.findByEmail(cleanEmail);
    if (existing) {
      logger.warn('AUTH', 'Registration conflict - email already registered', { email: cleanEmail });
      res.status(409).json({
        error: { code: 'email_taken', message: 'Этот email уже зарегистрирован' },
      });
      return;
    }

    const password_hash = await hashPassword(password);
    const isFirstUser = (await usersRepo.count()) === 0;

    const newUser = await usersRepo.create({
      email: cleanEmail,
      password_hash,
      native_language: 'ru',
      timezone: 'Europe/Moscow',
      timezone_changed_at: null,
      is_onboarded: false,
      is_admin: isFirstUser, // First registered user is automatically admin
      active_language_profile_id: null,
    });

    eventsRepo.record(newUser.id, 'signup', { email: cleanEmail });

    logger.success('AUTH', 'User registered successfully', {
      userId: newUser.id,
      email: newUser.email,
      isAdmin: newUser.is_admin,
    });

    const { token: refreshToken } = await createRefreshToken(newUser.id);
    setRefreshTokenCookie(res, refreshToken);

    const accessToken = generateAccessToken({
      userId: newUser.id,
      email: newUser.email,
      isAdmin: newUser.is_admin,
    });

    res.json({ access_token: accessToken, user: publicUser(newUser) });
  } catch (err: any) {
    logger.error('AUTH', 'Registration DB error', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
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

  try {
    const cleanEmail = String(email).trim().toLowerCase();
    const user = await usersRepo.findByEmail(cleanEmail);
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

    const { token: refreshToken } = await createRefreshToken(user.id);
    setRefreshTokenCookie(res, refreshToken);

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      isAdmin: user.is_admin,
    });

    logger.success('AUTH', 'User logged in', { userId: user.id, email: user.email });

    res.json({ access_token: accessToken, user: publicUser(user) });
  } catch (err: any) {
    logger.error('AUTH', 'Login DB error', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const oldRefreshToken = req.cookies?.refreshToken || req.body?.refresh_token;
  if (!oldRefreshToken) {
    logger.debug('AUTH', 'Refresh failed - no token provided');
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Отсутствует refresh token' },
    });
    return;
  }

  try {
    const rotation = await rotateRefreshToken(oldRefreshToken);
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
    res.json({ access_token: rotation.accessToken, user: publicUser(rotation.user) });
  } catch (err: any) {
    logger.error('AUTH', 'Refresh DB error', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      await revokeRefreshToken(token);
      logger.info('AUTH', 'User logged out and token revoked');
    } catch (err: any) {
      logger.error('AUTH', 'Logout DB error', { message: err.message });
    }
  }
  res.clearCookie('refreshToken');
  res.json({ success: true });
});

// GET /me
router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  logger.debug('AUTH', 'Current user session verified', { userId: user.id });
  res.json({ user: publicUser(user) });
});

export default router;
