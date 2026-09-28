import { Router, Response } from 'express';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';

const router = Router();

// PATCH /settings/timezone
router.patch('/timezone', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { timezone } = req.body;

  if (!timezone) {
    res.status(422).json({
      error: { code: 'validation_error', message: 'Часовой пояс обязателен' },
    });
    return;
  }

  // Validate IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (e) {
    res.status(422).json({
      error: { code: 'invalid_timezone', message: 'Некорректный формат IANA часового пояса' },
    });
    return;
  }

  // Idempotent if matching
  if (user.timezone === timezone) {
    const today = getLocalDateString(new Date(), user.timezone);
    const activeProfileId = user.active_language_profile_id;
    let lessonsToday = 0;
    if (activeProfileId) {
      lessonsToday = db.tables.lessons.filter(
        l => l.language_profile_id === activeProfileId && l.started_local_date === today
      ).length;
    }
    const completedDates = db.tables.lessons
      .filter(l => {
        const p = db.tables.user_language_profiles.find(lp => lp.id === l.language_profile_id);
        return p && p.user_id === user.id && l.status === 'completed' && l.completed_local_date;
      })
      .map(l => l.completed_local_date!);
    const streak = calculateStreak(completedDates, today);

    res.json({
      timezone: user.timezone,
      today,
      lessons_today: lessonsToday,
      resets_at: getMidnightResetUtc(user.timezone),
      streak,
    });
    return;
  }

  // 7-day restriction check
  if (user.timezone_changed_at) {
    const lastChange = new Date(user.timezone_changed_at).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diff = Date.now() - lastChange;
    if (diff < sevenDaysMs) {
      const availableAt = new Date(lastChange + sevenDaysMs).toISOString();
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

  user.timezone = timezone;
  user.timezone_changed_at = new Date().toISOString();
  db.save();

  const today = getLocalDateString(new Date(), user.timezone);
  const activeProfileId = user.active_language_profile_id;
  let lessonsToday = 0;
  if (activeProfileId) {
    lessonsToday = db.tables.lessons.filter(
      l => l.language_profile_id === activeProfileId && l.started_local_date === today
    ).length;
  }

  const completedDates = db.tables.lessons
    .filter(l => {
      const p = db.tables.user_language_profiles.find(lp => lp.id === l.language_profile_id);
      return p && p.user_id === user.id && l.status === 'completed' && l.completed_local_date;
    })
    .map(l => l.completed_local_date!);
  const streak = calculateStreak(completedDates, today);

  res.json({
    timezone: user.timezone,
    today,
    lessons_today: lessonsToday,
    resets_at: getMidnightResetUtc(user.timezone),
    streak,
  });
});

export default router;
