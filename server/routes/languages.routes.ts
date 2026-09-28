import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();
const DAILY_LESSON_LIMIT_MAX = parseInt(process.env.DAILY_LESSON_LIMIT_MAX || '5', 10);

// GET /language-profiles
router.get('/language-profiles', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const profiles = db.tables.user_language_profiles.filter(p => p.user_id === user.id);

  const formatted = profiles.map(p => {
    const lang = db.tables.languages.find(l => l.code === p.target_language);
    const dict = db.tables.dictionaries.find(d => d.id === p.dictionary_id);
    return {
      ...p,
      language_name: lang ? lang.name : p.target_language,
      dictionary_name: dict ? dict.name : '',
      is_active: user.active_language_profile_id === p.id,
    };
  });

  res.json({ profiles: formatted });
});

// POST /language-profiles (Add new language)
router.post('/language-profiles', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (!user.is_onboarded) {
    res.status(403).json({
      error: { code: 'not_onboarded', message: 'Сначала завершите онбординг' },
    });
    return;
  }

  const { target_language, level, dictionary_id } = req.body;
  if (!target_language || !level) {
    res.status(422).json({
      error: { code: 'validation_error', message: 'Язык и уровень обязательны' },
    });
    return;
  }

  if (target_language === user.native_language) {
    res.status(422).json({
      error: { code: 'same_language', message: 'Нельзя изучать родной язык' },
    });
    return;
  }

  const existing = db.tables.user_language_profiles.find(
    p => p.user_id === user.id && p.target_language === target_language
  );
  if (existing) {
    logger.warn('LANGUAGES', 'Attempt to add already studied language', { target_language, userId: user.id });
    res.status(409).json({
      error: { code: 'already_exists', message: 'Этот язык уже изучается' },
    });
    return;
  }

  let chosenDict = null;
  if (dictionary_id) {
    chosenDict = db.tables.dictionaries.find(
      d => d.id === dictionary_id && d.target_language === target_language && d.native_language === user.native_language
    );
  }
  if (!chosenDict) {
    // Default to general dictionary
    chosenDict = db.tables.dictionaries.find(
      d => d.target_language === target_language && d.native_language === user.native_language && d.is_general
    );
  }

  if (!chosenDict) {
    res.status(422).json({
      error: { code: 'no_dictionary', message: 'Словарь для данной пары языков не найден' },
    });
    return;
  }

  const newProfile = {
    id: crypto.randomUUID(),
    user_id: user.id,
    target_language,
    level,
    dictionary_id: chosenDict.id,
    daily_lesson_limit: 1,
    last_lesson_number: 0,
    created_at: new Date().toISOString(),
  };

  db.tables.user_language_profiles.push(newProfile);
  user.active_language_profile_id = newProfile.id;
  db.save();

  logger.success('LANGUAGES', `New language profile added: ${target_language} (${level})`, {
    userId: user.id,
    profileId: newProfile.id,
    dictionaryId: chosenDict.id,
  });

  db.recordEvent(user.id, 'language_added', { target_language, level });

  res.json({ profile: newProfile });
});

// GET /language-profiles/:id
router.get('/language-profiles/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const profile = db.tables.user_language_profiles.find(
    p => p.id === req.params.id && p.user_id === user.id
  );

  if (!profile) {
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль языка не найден' },
    });
    return;
  }

  const dict = db.tables.dictionaries.find(d => d.id === profile.dictionary_id);
  const lang = db.tables.languages.find(l => l.code === profile.target_language);

  // Stats for this profile
  const userWords = db.tables.user_words.filter(w => w.language_profile_id === profile.id);
  const activeCount = userWords.filter(w => w.status === 'active').length;
  const masteredCount = userWords.filter(w => w.status === 'mastered').length;
  const ignoredCount = userWords.filter(w => w.status === 'ignored').length;

  const lessons = db.tables.lessons.filter(l => l.language_profile_id === profile.id);
  const completedLessons = lessons.filter(l => l.status === 'completed').length;

  // Accuracy calculation
  const lessonIds = new Set(lessons.map(l => l.id));
  const exercises = db.tables.lesson_exercises.filter(e => lessonIds.has(e.lesson_id));
  const exerciseIds = new Set(exercises.map(e => e.id));
  const evaluatedWords = db.tables.lesson_exercise_words.filter(
    ew => exerciseIds.has(ew.exercise_id) && ew.is_target && ew.result !== null
  );

  const correctAndTypo = evaluatedWords.filter(ew => ew.result === 'correct' || ew.result === 'typo').length;
  const accuracy = evaluatedWords.length > 0 ? Math.round((correctAndTypo / evaluatedWords.length) * 100) : 0;

  res.json({
    profile: {
      id: profile.id,
      target_language: profile.target_language,
      language_name: lang ? lang.name : profile.target_language,
      level: profile.level,
      dictionary_id: profile.dictionary_id,
      dictionary_name: dict ? dict.name : '',
      daily_lesson_limit: profile.daily_lesson_limit,
      daily_lesson_limit_max: DAILY_LESSON_LIMIT_MAX,
      last_lesson_number: profile.last_lesson_number,
    },
    stats: {
      active: activeCount,
      mastered: masteredCount,
      ignored: ignoredCount,
      completed_lessons: completedLessons,
      accuracy,
      total_evaluated: evaluatedWords.length,
    },
  });
});

// PATCH /language-profiles/:id
router.patch('/language-profiles/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const profile = db.tables.user_language_profiles.find(
    p => p.id === req.params.id && p.user_id === user.id
  );

  if (!profile) {
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль языка не найден' },
    });
    return;
  }

  const { level, dictionary_id, daily_lesson_limit } = req.body;

  if (level) {
    const validLevels = ['A1', 'A2', 'B1', 'B2'];
    if (!validLevels.includes(level)) {
      res.status(422).json({
        error: { code: 'invalid_level', message: 'Недопустимый уровень' },
      });
      return;
    }
    profile.level = level;
  }

  if (dictionary_id) {
    const dict = db.tables.dictionaries.find(
      d => d.id === dictionary_id && d.target_language === profile.target_language && d.native_language === user.native_language
    );
    if (!dict) {
      res.status(422).json({
        error: { code: 'invalid_dictionary', message: 'Словарь не принадлежит языковой паре' },
      });
      return;
    }
    profile.dictionary_id = dictionary_id;
  }

  if (daily_lesson_limit !== undefined) {
    const limitNum = parseInt(daily_lesson_limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > DAILY_LESSON_LIMIT_MAX) {
      res.status(422).json({
        error: {
          code: 'invalid_limit',
          message: `Дневной лимит уроков должен быть от 1 до ${DAILY_LESSON_LIMIT_MAX}`,
        },
      });
      return;
    }
    profile.daily_lesson_limit = limitNum;
  }

  db.save();
  logger.info('LANGUAGES', `Language profile updated`, {
    userId: user.id,
    profileId: profile.id,
    level: profile.level,
    dictionaryId: profile.dictionary_id,
    dailyLimit: profile.daily_lesson_limit,
  });

  res.json({ profile });
});

// GET /dictionaries?target_language=
router.get('/dictionaries', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const targetLanguage = String(req.query.target_language || 'en');

  const dicts = db.tables.dictionaries.filter(
    d => d.target_language === targetLanguage && d.native_language === user.native_language
  );

  const result = dicts.map(d => {
    const wordCount = db.tables.dictionary_words.filter(dw => dw.dictionary_id === d.id).length;
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      description: d.description,
      is_general: d.is_general,
      target_language: d.target_language,
      native_language: d.native_language,
      words_total: wordCount,
    };
  });

  res.json({ dictionaries: result });
});

// PUT /me/active-language
router.put('/me/active-language', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id } = req.body;

  const profile = db.tables.user_language_profiles.find(
    p => p.id === language_profile_id && p.user_id === user.id
  );

  if (!profile) {
    logger.warn('LANGUAGES', 'Switch active profile failed: not found', { userId: user.id, language_profile_id });
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль не найден' },
    });
    return;
  }

  user.active_language_profile_id = profile.id;
  db.save();

  logger.info('LANGUAGES', `Active language switched to ${profile.target_language} (profile: ${profile.id})`, {
    userId: user.id,
    targetLanguage: profile.target_language,
  });

  res.json({ success: true, active_language_profile_id: profile.id });
});

export default router;
