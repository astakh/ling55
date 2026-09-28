import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';

const router = Router();

// GET /languages/pairs?native=ru
router.get('/pairs', (req, res: Response) => {
  const native = String(req.query.native || 'ru');
  const generalDicts = db.tables.dictionaries.filter(
    d => d.native_language === native && d.is_general
  );

  const supportedTargets = generalDicts.map(d => {
    const lang = db.tables.languages.find(l => l.code === d.target_language);
    return {
      code: d.target_language,
      name: lang ? lang.name : d.target_language,
      dictionary_id: d.id,
      dictionary_name: d.name,
    };
  });

  res.json({
    native_language: native,
    pairs: supportedTargets,
  });
});

// POST /onboarding/complete
router.post('/complete', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.is_onboarded) {
    res.status(409).json({
      error: { code: 'already_onboarded', message: 'Онбординг уже пройден' },
    });
    return;
  }

  const { native_language, timezone, target_language, level } = req.body;

  if (!native_language || !target_language || !level) {
    res.status(422).json({
      error: { code: 'validation_error', message: 'Все поля обязательны' },
    });
    return;
  }

  if (target_language === native_language) {
    res.status(422).json({
      error: { code: 'same_language', message: 'Изучаемый язык не может совпадать с родным' },
    });
    return;
  }

  const validLevels = ['A1', 'A2', 'B1', 'B2'];
  if (!validLevels.includes(level)) {
    res.status(422).json({
      error: { code: 'invalid_level', message: 'Уровень должен быть от A1 до B2' },
    });
    return;
  }

  // Find general dictionary for this pair
  const generalDict = db.tables.dictionaries.find(
    d => d.native_language === native_language && d.target_language === target_language && d.is_general
  );

  if (!generalDict) {
    res.status(422).json({
      error: { code: 'pair_not_supported', message: 'Для данной пары языков нет общего словаря' },
    });
    return;
  }

  // Check timezone
  const tz = timezone || 'Europe/Moscow';

  // Create language profile
  const profileId = crypto.randomUUID();
  const newProfile = {
    id: profileId,
    user_id: user.id,
    target_language,
    level,
    dictionary_id: generalDict.id,
    daily_lesson_limit: 1,
    last_lesson_number: 0,
    created_at: new Date().toISOString(),
  };

  db.tables.user_language_profiles.push(newProfile);

  // Update user
  user.native_language = native_language;
  user.timezone = tz;
  user.is_onboarded = true;
  user.active_language_profile_id = profileId;
  db.save();

  db.recordEvent(user.id, 'onboarding_completed', {
    target_language,
    level,
    dictionary_id: generalDict.id,
  });

  res.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      is_onboarded: user.is_onboarded,
      is_admin: user.is_admin,
      native_language: user.native_language,
      timezone: user.timezone,
      active_language_profile_id: user.active_language_profile_id,
    },
    profile: newProfile,
  });
});

export default router;
