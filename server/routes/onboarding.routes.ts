/**
 * Онбординг в упрощённой версии: пользователь выбирает уровень английского,
 * словарь (общий или тематический) и настройки уроков (слов в уроке, уроков в день).
 * Языки фиксированы: родной — русский, изучаемый — английский.
 */
import { Router, Response } from 'express';
import {
  usersRepo, dictionariesRepo, profilesRepo, eventsRepo,
  NATIVE_LANGUAGE, TARGET_LANGUAGE,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WORDS_PER_LESSON_MIN = 3;
const WORDS_PER_LESSON_MAX = 10;
const DAILY_LESSON_LIMIT_MIN = 1;
const DAILY_LESSON_LIMIT_MAX = parseInt(process.env.DAILY_LESSON_LIMIT_MAX || '5', 10);

// GET /onboarding/setup — данные для шагов онбординга
router.get('/setup', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dicts = await dictionariesRepo.findPair(TARGET_LANGUAGE, NATIVE_LANGUAGE);

    logger.info('ONBOARDING', 'Onboarding setup retrieved', {
      userId: req.user!.id,
      dictionariesCount: dicts.length,
    });

    res.json({
      native_language: NATIVE_LANGUAGE,
      target_language: TARGET_LANGUAGE,
      levels: LEVELS,
      dictionaries: dicts.map(d => ({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        is_general: d.is_general,
      })),
      words_per_lesson: { min: WORDS_PER_LESSON_MIN, max: WORDS_PER_LESSON_MAX, default: 5 },
      daily_lesson_limit: { min: DAILY_LESSON_LIMIT_MIN, max: DAILY_LESSON_LIMIT_MAX, default: 1 },
    });
  } catch (err: any) {
    logger.error('ONBOARDING', 'DB error loading onboarding setup', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /onboarding/complete
router.post('/complete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.is_onboarded) {
    logger.warn('ONBOARDING', 'User attempted duplicate onboarding', { userId: user.id });
    res.status(409).json({
      error: { code: 'already_onboarded', message: 'Онбординг уже пройден' },
    });
    return;
  }

  const { level, dictionary_id, words_per_lesson, daily_lesson_limit, timezone } = req.body;

  // В упрощённой версии язык всегда en->ru; принимаем target_language для обратной совместимости
  const targetLanguage = req.body.target_language || TARGET_LANGUAGE;
  if (targetLanguage !== TARGET_LANGUAGE) {
    logger.warn('ONBOARDING', 'Onboarding rejected: unsupported language', { userId: user.id, targetLanguage });
    res.status(422).json({
      error: { code: 'unsupported_language', message: 'Доступен только английский язык' },
    });
    return;
  }

  if (!level || !LEVELS.includes(level)) {
    logger.warn('ONBOARDING', 'Onboarding validation failed: invalid level', { userId: user.id, body: req.body });
    res.status(422).json({
      error: { code: 'invalid_level', message: `Уровень должен быть одним из: ${LEVELS.join(', ')}` },
    });
    return;
  }

  if (!dictionary_id) {
    res.status(422).json({
      error: { code: 'validation_error', message: 'Выберите словарь (общий или тематический)' },
    });
    return;
  }

  const wpl = parseInt(words_per_lesson ?? '5', 10);
  if (isNaN(wpl) || wpl < WORDS_PER_LESSON_MIN || wpl > WORDS_PER_LESSON_MAX) {
    res.status(422).json({
      error: {
        code: 'invalid_words_per_lesson',
        message: `Количество слов в уроке должно быть от ${WORDS_PER_LESSON_MIN} до ${WORDS_PER_LESSON_MAX}`,
      },
    });
    return;
  }

  const dll = parseInt(daily_lesson_limit ?? '1', 10);
  if (isNaN(dll) || dll < DAILY_LESSON_LIMIT_MIN || dll > DAILY_LESSON_LIMIT_MAX) {
    res.status(422).json({
      error: {
        code: 'invalid_daily_lesson_limit',
        message: `Количество уроков в день должно быть от ${DAILY_LESSON_LIMIT_MIN} до ${DAILY_LESSON_LIMIT_MAX}`,
      },
    });
    return;
  }

  try {
    // Выбранный словарь должен принадлежать паре en -> ru
    const dict = await dictionariesRepo.findPairById(dictionary_id, TARGET_LANGUAGE, NATIVE_LANGUAGE);
    if (!dict) {
      logger.warn('ONBOARDING', 'Onboarding rejected: dictionary not found for pair', { userId: user.id, dictionary_id });
      res.status(422).json({
        error: { code: 'invalid_dictionary', message: 'Словарь не найден для пары «Английский → Русский»' },
      });
      return;
    }

    const tz = timezone || 'Europe/Moscow';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      res.status(422).json({
        error: { code: 'invalid_timezone', message: 'Некорректный часовой пояс' },
      });
      return;
    }

    // Создать единственный языковой профиль (en) с выбранными настройками
    const newProfile = await profilesRepo.create({
      user_id: user.id,
      target_language: TARGET_LANGUAGE,
      level,
      dictionary_id: dict.id,
      daily_lesson_limit: dll,
      words_per_lesson: wpl,
      last_lesson_number: 0,
    });

    const updatedUser = await usersRepo.update(user.id, {
      native_language: NATIVE_LANGUAGE,
      timezone: tz,
      is_onboarded: true,
      active_language_profile_id: newProfile.id,
    });

    if (updatedUser) Object.assign(user, updatedUser);

    logger.success('ONBOARDING', 'Onboarding completed successfully!', {
      userId: user.id,
      email: user.email,
      level,
      timezone: tz,
      dictionaryId: dict.id,
      dictionaryName: dict.name,
      wordsPerLesson: wpl,
      dailyLessonLimit: dll,
    });

    eventsRepo.record(user.id, 'onboarding_completed', {
      level,
      dictionary_id: dict.id,
      words_per_lesson: wpl,
      daily_lesson_limit: dll,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        is_onboarded: true,
        is_admin: user.is_admin,
        native_language: NATIVE_LANGUAGE,
        timezone: tz,
        active_language_profile_id: newProfile.id,
      },
      profile: newProfile,
    });
  } catch (err: any) {
    logger.error('ONBOARDING', 'DB error completing onboarding', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
