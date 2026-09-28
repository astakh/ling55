import { Router, Response } from 'express';
import {
  profilesRepo, languagesRepo, dictionariesRepo, userWordsRepo, usersRepo,
  lessonsRepo, exercisesRepo, exerciseWordsRepo, eventsRepo,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();
const DAILY_LESSON_LIMIT_MAX = parseInt(process.env.DAILY_LESSON_LIMIT_MAX || '5', 10);

// GET /language-profiles
router.get('/language-profiles', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  try {
    const profiles = await profilesRepo.listByUser(user.id);
    const languages = await languagesRepo.all();
    const dicts = await dictionariesRepo.all();

    const formatted = profiles.map(p => {
      const lang = languages.find(l => l.code === p.target_language);
      const dict = dicts.find(d => d.id === p.dictionary_id);
      return {
        ...p,
        language_name: lang ? lang.name : p.target_language,
        dictionary_name: dict ? dict.name : '',
        is_active: user.active_language_profile_id === p.id,
      };
    });

    res.json({ profiles: formatted });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error listing profiles', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /language-profiles (Add new language)
router.post('/language-profiles', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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

  try {
    const existing = await profilesRepo.findByUserAndTarget(user.id, target_language);
    if (existing) {
      logger.warn('LANGUAGES', 'Attempt to add already studied language', { target_language, userId: user.id });
      res.status(409).json({
        error: { code: 'already_exists', message: 'Этот язык уже изучается' },
      });
      return;
    }

    let chosenDict = null;
    if (dictionary_id) {
      chosenDict = await dictionariesRepo.findPairById(dictionary_id, target_language, user.native_language);
    }
    if (!chosenDict) {
      // Default to general dictionary
      chosenDict = await dictionariesRepo.findGeneralPair(user.native_language, target_language);
    }

    if (!chosenDict) {
      res.status(422).json({
        error: { code: 'no_dictionary', message: 'Словарь для данной пары языков не найден' },
      });
      return;
    }

    const newProfile = await profilesRepo.create({
      user_id: user.id,
      target_language,
      level,
      dictionary_id: chosenDict.id,
      daily_lesson_limit: 1,
      last_lesson_number: 0,
    });

    await usersRepo.setActiveProfile(user.id, newProfile.id);
    user.active_language_profile_id = newProfile.id;

    logger.success('LANGUAGES', `New language profile added: ${target_language} (${level})`, {
      userId: user.id,
      profileId: newProfile.id,
      dictionaryId: chosenDict.id,
    });

    eventsRepo.record(user.id, 'language_added', { target_language, level });

    res.json({ profile: newProfile });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error creating profile', { message: err.message });
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
    const lang = await languagesRepo.findByCode(profile.target_language);

    // Stats for this profile
    const wordCounts = await userWordsRepo.statusCounts(profile.id);
    const lessons = await lessonsRepo.listByProfile(profile.id);
    const completedLessons = lessons.filter(l => l.status === 'completed').length;

    // Accuracy calculation
    const lessonIds = lessons.map(l => l.id);
    const accuracy = await exerciseWordsRepo.accuracyStatsByLessonIds(lessonIds);
    const accPct = accuracy.total > 0 ? Math.round((accuracy.correct / accuracy.total) * 100) : 0;

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

// PATCH /language-profiles/:id
router.patch('/language-profiles/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { level, dictionary_id, daily_lesson_limit } = req.body;

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
      const validLevels = ['A1', 'A2', 'B1', 'B2'];
      if (!validLevels.includes(level)) {
        res.status(422).json({
          error: { code: 'invalid_level', message: 'Недопустимый уровень' },
        });
        return;
      }
      patch.level = level;
    }

    if (dictionary_id) {
      const dict = await dictionariesRepo.findPairById(
        dictionary_id, profile.target_language, user.native_language
      );
      if (!dict) {
        res.status(422).json({
          error: { code: 'invalid_dictionary', message: 'Словарь не принадлежит языковой паре' },
        });
        return;
      }
      patch.dictionary_id = dictionary_id;
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
      patch.daily_lesson_limit = limitNum;
    }

    const updated = Object.keys(patch).length > 0
      ? await profilesRepo.update(profile.id, patch)
      : profile;

    logger.info('LANGUAGES', `Language profile updated`, {
      userId: user.id,
      profileId: profile.id,
      level: updated?.level,
      dictionaryId: updated?.dictionary_id,
      dailyLimit: updated?.daily_lesson_limit,
    });

    res.json({ profile: updated });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error updating profile', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /dictionaries?target_language=
router.get('/dictionaries', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const targetLanguage = String(req.query.target_language || 'en');

  try {
    const dicts = await dictionariesRepo.findPair(targetLanguage, user.native_language);

    const result = [];
    for (const d of dicts) {
      const wordCount = await dictionariesRepo.wordCount(d.id);
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

// PUT /me/active-language
router.put('/me/active-language', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id } = req.body;

  try {
    const profile = await profilesRepo.findByIdAndUser(language_profile_id, user.id);
    if (!profile) {
      logger.warn('LANGUAGES', 'Switch active profile failed: not found', { userId: user.id, language_profile_id });
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль не найден' },
      });
      return;
    }

    await usersRepo.setActiveProfile(user.id, profile.id);
    user.active_language_profile_id = profile.id;

    logger.info('LANGUAGES', `Active language switched to ${profile.target_language} (profile: ${profile.id})`, {
      userId: user.id,
      targetLanguage: profile.target_language,
    });

    res.json({ success: true, active_language_profile_id: profile.id });
  } catch (err: any) {
    logger.error('LANGUAGES', 'DB error switching active profile', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
