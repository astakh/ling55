/**
 * Языковые профили и словари (упрощённая версия).
 * У пользователя ровно один профиль — английский (en -> ru).
 * Пользователь сам выбирает и меняет активный словарь (общий или тематический),
 * уровень, количество слов в уроке и количество уроков в день.
 */
import { Router, Response } from 'express';
import {
  profilesRepo, dictionariesRepo, userWordsRepo,
  lessonsRepo, exercisesRepo, exerciseWordsRepo, eventsRepo,
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

function formatProfile(p: any, dict: any) {
  return {
    id: p.id,
    target_language: p.target_language,
    language_name: 'Английский',
    level: p.level,
    dictionary_id: p.dictionary_id,
    dictionary_name: dict ? dict.name : '',
    daily_lesson_limit: p.daily_lesson_limit,
    daily_lesson_limit_max: DAILY_LESSON_LIMIT_MAX,
    words_per_lesson: p.words_per_lesson,
    words_per_lesson_min: WORDS_PER_LESSON_MIN,
    words_per_lesson_max: WORDS_PER_LESSON_MAX,
    last_lesson_number: p.last_lesson_number,
    is_active: true,
  };
}

// GET /language-profiles — список профилей (в упрощённой версии — один en-профиль)
router.get('/language-profiles', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const profiles = await profilesRepo.listByUser(user.id);
    const dicts = await dictionariesRepo.all();

    const formatted = profiles.map(p => {
      const dict = dicts.find(d => d.id === p.dictionary_id);
      return formatProfile(p, dict);
    });

    res.json({ profiles: formatted });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error listing profiles', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /language-profiles/current — текущий профиль (en)
router.get('/language-profiles/current', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const profile = await profilesRepo.findByUser(user.id);
    if (!profile) {
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль не найден — пройдите онбординг' },
      });
      return;
    }
    const dict = await dictionariesRepo.findById(profile.dictionary_id);
    res.json({ profile: formatProfile(profile, dict) });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error loading current profile', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /language-profiles/:id
router.get('/language-profiles/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const profile = await profilesRepo.findByIdAndUser(req.params.id, user.id);
    if (!profile) {
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль языка не найден' },
      });
      return;
    }

    const dict = await dictionariesRepo.findById(profile.dictionary_id);

    // Stats for this profile
    const wordCounts = await userWordsRepo.statusCounts(profile.id);
    const lessons = await lessonsRepo.listByProfile(profile.id);
    const completedLessons = lessons.filter(l => l.status === 'completed').length;

    // Accuracy calculation
    const lessonIds = lessons.map(l => l.id);
    const accuracy = await exerciseWordsRepo.accuracyStatsByLessonIds(lessonIds);
    const accPct = accuracy.total > 0 ? Math.round((accuracy.correct / accuracy.total) * 100) : 0;

    res.json({
      profile: formatProfile(profile, dict),
      stats: {
        active: wordCounts.active,
        mastered: wordCounts.mastered,
        ignored: wordCounts.ignored,
        completed_lessons: completedLessons,
        accuracy: accPct,
        total_evaluated: accuracy.total,
      },
    });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error loading profile', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// PATCH /language-profiles/:id — смена уровня, активного словаря, слов в уроке, уроков в день
router.patch('/language-profiles/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { level, dictionary_id, daily_lesson_limit, words_per_lesson } = req.body;

  try {
    const profile = await profilesRepo.findByIdAndUser(req.params.id, user.id);
    if (!profile) {
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль языка не найден' },
      });
      return;
    }

    const patch: Record<string, any> = {};

    if (level) {
      if (!LEVELS.includes(level)) {
        res.status(422).json({
          error: { code: 'invalid_level', message: 'Недопустимый уровень' },
        });
        return;
      }
      patch.level = level;
    }

    if (dictionary_id) {
      const dict = await dictionariesRepo.findPairById(
        dictionary_id, TARGET_LANGUAGE, NATIVE_LANGUAGE
      );
      if (!dict) {
        res.status(422).json({
          error: { code: 'invalid_dictionary', message: 'Словарь не принадлежит паре «Английский → Русский»' },
        });
        return;
      }
      patch.dictionary_id = dictionary_id;
    }

    if (words_per_lesson !== undefined) {
      const wpl = parseInt(words_per_lesson, 10);
      if (isNaN(wpl) || wpl < WORDS_PER_LESSON_MIN || wpl > WORDS_PER_LESSON_MAX) {
        res.status(422).json({
          error: {
            code: 'invalid_words_per_lesson',
            message: `Количество слов в уроке должно быть от ${WORDS_PER_LESSON_MIN} до ${WORDS_PER_LESSON_MAX}`,
          },
        });
        return;
      }
      patch.words_per_lesson = wpl;
    }

    if (daily_lesson_limit !== undefined) {
      const limitNum = parseInt(daily_lesson_limit, 10);
      if (isNaN(limitNum) || limitNum < DAILY_LESSON_LIMIT_MIN || limitNum > DAILY_LESSON_LIMIT_MAX) {
        res.status(422).json({
          error: {
            code: 'invalid_limit',
            message: `Дневной лимит уроков должен быть от ${DAILY_LESSON_LIMIT_MIN} до ${DAILY_LESSON_LIMIT_MAX}`,
          },
        });
        return;
      }
      patch.daily_lesson_limit = limitNum;
    }

    const updated = Object.keys(patch).length > 0
      ? await profilesRepo.update(profile.id, patch)
      : profile;

    if (updated && dictionary_id && dictionary_id !== profile.dictionary_id) {
      void eventsRepo.record(user.id, 'dictionary_changed', {
        from_dictionary_id: profile.dictionary_id,
        to_dictionary_id: dictionary_id,
      });
    }

    logger.info('LANGUAGES', 'Language profile updated', {
      userId: user.id,
      profileId: profile.id,
      level: updated?.level,
      dictionaryId: updated?.dictionary_id,
      wordsPerLesson: updated?.words_per_lesson,
      dailyLimit: updated?.daily_lesson_limit,
    });

    const dict = updated ? await dictionariesRepo.findById(updated.dictionary_id) : null;
    res.json({ profile: updated ? formatProfile(updated, dict) : null });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error updating profile', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /dictionaries?target_language=en&include_word_counts=true — словари пары en -> ru
router.get('/dictionaries', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const targetLanguage = String(req.query.target_language || TARGET_LANGUAGE);
  const includeWordCounts = String(req.query.include_word_counts) === 'true';

  if (targetLanguage !== TARGET_LANGUAGE) {
    res.json({ dictionaries: [] });
    return;
  }

  try {
    const dicts = await dictionariesRepo.findPair(TARGET_LANGUAGE, NATIVE_LANGUAGE);

    const result = [];
    for (const d of dicts) {
      const wordCount = includeWordCounts ? await dictionariesRepo.wordCount(d.id) : 0;
      result.push({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        is_general: d.is_general,
        target_language: d.target_language,
        native_language: d.native_language,
        words_total: wordCount,
      });
    }

    res.json({ dictionaries: result });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error listing dictionaries', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
