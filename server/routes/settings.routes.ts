import { Router, Response } from 'express';
import { usersRepo, lessonsRepo } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';
import { logger } from '../logger.js';

const router = Router();

// PATCH /settings/timezone
router.patch('/timezone', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { timezone } = req.body;

  if (!timezone) {
    logger.warn('SETTINGS', 'Timezone update rejected: missing timezone', { userId: user.id });
    res.status(422).json({
      error: { code: 'validation_error', message: 'Часовой пояс обязателен' },
    });
    return;
  }

  // Validate IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (e) {
    logger.warn('SETTINGS', 'Timezone update rejected: invalid IANA timezone', { userId: user.id, timezone });
    res.status(422).json({
      error: { code: 'invalid_timezone', message: 'Некорректный формат IANA часового пояса' },
    });
    return;
  }

  const buildResponse = async (tz: string) => {
    const today = getLocalDateString(new Date(), tz);
    const activeProfileId = user.active_language_profile_id;
    let lessonsToday = 0;
    if (activeProfileId) {
      lessonsToday = await lessonsRepo.countStartedToday(activeProfileId, today);
    }
    const completedDates = await lessonsRepo.completedDatesByUser(user.id);
    return {
      timezone: tz,
      today,
      lessons_today: lessonsToday,
      resets_at: getMidnightResetUtc(tz),
      streak: calculateStreak(completedDates, today),
    };
  };

  try {
    // Idempotent if matching
    if (user.timezone === timezone) {
      logger.info('SETTINGS', 'Timezone unchanged (idempotent)', { userId: user.id, timezone });
      res.json(await buildResponse(user.timezone));
      return;
    }

    // 7-day restriction check
    if (user.timezone_changed_at) {
      const lastChange = new Date(user.timezone_changed_at).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const diff = Date.now() - lastChange;
      if (diff < sevenDaysMs) {
        const availableAt = new Date(lastChange + sevenDaysMs).toISOString();
        logger.warn('SETTINGS', 'Timezone update rejected: 7-day cooldown', { userId: user.id, availableAt });
        res.status(409).json({
          error: {
            code: 'timezone_change_too_soon',
            message: 'Смену часового пояса можно производить не чаще одного раза в 7 дней',
            details: { available_at: availableAt },
          },
        });
        return;
      }
    }

    const oldTz = user.timezone;
    const nowIso = new Date().toISOString();
    const updated = await usersRepo.update(user.id, {
      timezone,
      timezone_changed_at: nowIso,
    });
    if (updated) Object.assign(user, updated);

    const payload = await buildResponse(timezone);

    logger.info('SETTINGS', `Timezone changed: ${oldTz} -> ${timezone}`, {
      userId: user.id,
      newToday: payload.today,
      streakCurrent: payload.streak.current,
    });

    res.json(payload);
  } catch (err: any) {
    logger.error('SETTINGS', 'DB error updating timezone', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
