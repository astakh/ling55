import { Router, Response } from 'express';
import {
  profilesRepo, languagesRepo, dictionariesRepo, userWordsRepo,
  lessonsRepo, exercisesRepo,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';
import { logger } from '../logger.js';

const router = Router();

// GET /dashboard/summary?language_profile_id=
router.get('/summary', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  if (!user.is_onboarded) {
    logger.warn('DASHBOARD', 'Summary requested by non-onboarded user', { userId: user.id });
    res.status(403).json({
      error: { code: 'not_onboarded', message: 'Онбординг не завершен' },
    });
    return;
  }

  try {
    const requestedProfileId = (req.query.language_profile_id as string) || user.active_language_profile_id;
    const profiles = await profilesRepo.listByUser(user.id);

    if (profiles.length === 0) {
      res.status(404).json({
        error: { code: 'no_profiles', message: 'Языковые профили не найдены' },
      });
      return;
    }

    const activeProfile = profiles.find(p => p.id === requestedProfileId) || profiles[0];

    const lang = await languagesRepo.findByCode(activeProfile.target_language);
    const dict = await dictionariesRepo.findById(activeProfile.dictionary_id);

    const today = getLocalDateString(new Date(), user.timezone);

    // Count lessons started today in this profile
    const lessonsToday = await lessonsRepo.countStartedToday(activeProfile.id, today);

    // Check for in_progress lesson
    const inProgressLesson = await lessonsRepo.findInProgress(activeProfile.id);

    let cta: 'start' | 'resume' | 'limit_reached' = 'start';
    let resumeInfo = null;

    if (inProgressLesson) {
      cta = 'resume';
      const counts = await exercisesRepo.countEvaluatedByLesson(inProgressLesson.id);
      resumeInfo = {
        lesson_id: inProgressLesson.id,
        exercises_done: counts.done,
        exercises_total: counts.total,
      };
    } else if (lessonsToday >= activeProfile.daily_lesson_limit) {
      cta = 'limit_reached';
    } else {
      cta = 'start';
    }

    // Word counts
    const wordsSummary = await userWordsRepo.statusCounts(activeProfile.id);

    // Streak across all profiles of user
    const completedDates = await lessonsRepo.completedDatesByUser(user.id);
    const streak = calculateStreak(completedDates, today);

    const languages = await languagesRepo.all();

    logger.info('DASHBOARD', `Dashboard summary loaded`, {
      userId: user.id,
      activeProfileId: activeProfile.id,
      targetLanguage: activeProfile.target_language,
      cta,
      streakCurrent: streak.current,
      wordsActive: wordsSummary.active,
      wordsMastered: wordsSummary.mastered,
    });

    res.json({
      profile: {
        id: activeProfile.id,
        target_language: activeProfile.target_language,
        language_name: lang ? lang.name : activeProfile.target_language,
        level: activeProfile.level,
        daily_lesson_limit: activeProfile.daily_lesson_limit,
        last_lesson_number: activeProfile.last_lesson_number,
        dictionary: {
          id: dict ? dict.id : activeProfile.dictionary_id,
          name: dict ? dict.name : '',
        },
      },
      profiles: profiles.map(p => {
        const l = languages.find(langItem => langItem.code === p.target_language);
        return {
          id: p.id,
          target_language: p.target_language,
          language_name: l ? l.name : p.target_language,
        };
      }),
      today,
      lessons_today: lessonsToday,
      daily_lesson_limit: activeProfile.daily_lesson_limit,
      resets_at: getMidnightResetUtc(user.timezone),
      cta,
      resume: resumeInfo,
      words: wordsSummary,
      streak,
    });
  } catch (err: any) {
    logger.error('DASHBOARD', 'DB error loading summary', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
