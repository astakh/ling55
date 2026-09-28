import { Router, Response } from 'express';
import {
  profilesRepo, userWordsRepo, lessonsRepo, exerciseWordsRepo,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, calculateStreak } from '../streak.js';
import { logger } from '../logger.js';

const router = Router();

// GET /profile/stats
router.get('/stats', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const today = getLocalDateString(new Date(), user.timezone);

  try {
    const profiles = await profilesRepo.listByUser(user.id);

    // Streak across all profiles
    const completedDatesAll = await lessonsRepo.completedDatesByUser(user.id);
    const streak = calculateStreak(completedDatesAll, today);

    // Heatmap: count completed lessons per completed_local_date
    const heatmap: Record<string, number> = {};
    for (const d of completedDatesAll) {
      heatmap[d] = (heatmap[d] || 0) + 1;
    }

    // Accuracy calculation (all-time & 30-day)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

    const allLessons = [];
    for (const p of profiles) {
      const lessons = await lessonsRepo.listByProfile(p.id);
      allLessons.push(...lessons.map(l => ({ ...l, profileId: p.id })));
    }

    const allLessonIds = allLessons.map(l => l.id);
    const accuracyAllTimeStats = await exerciseWordsRepo.accuracyStatsByLessonIds(allLessonIds);
    const accuracy30dStats = await exerciseWordsRepo.accuracyStatsByLessonIds(allLessonIds, thirtyDaysAgoStr);

    const accuracyAllTime = accuracyAllTimeStats.total > 0
      ? Math.round((accuracyAllTimeStats.correct / accuracyAllTimeStats.total) * 100) : 0;
    const accuracy30d = accuracy30dStats.total > 0
      ? Math.round((accuracy30dStats.correct / accuracy30dStats.total) * 100) : 0;

    // Breakdown by language (в упрощённой версии — один профиль en)
    const languageStats = [];
    for (const p of profiles) {
      const pLessons = allLessons.filter(l => l.profileId === p.id);
      const pLessonIds = pLessons.map(l => l.id);
      const pAccuracy = await exerciseWordsRepo.accuracyStatsByLessonIds(pLessonIds);
      const counts = await userWordsRepo.statusCounts(p.id);

      languageStats.push({
        profile_id: p.id,
        target_language: p.target_language,
        language_name: 'Английский',
        level: p.level,
        words: counts,
        completed_lessons: pLessons.filter(l => l.status === 'completed').length,
        accuracy: pAccuracy.total > 0 ? Math.round((pAccuracy.correct / pAccuracy.total) * 100) : 0,
        total_words_evaluated: pAccuracy.total,
      });
    }

    // Overall word counts
    let wordsTotal = { active: 0, mastered: 0, ignored: 0 };
    for (const p of profiles) {
      const c = await userWordsRepo.statusCounts(p.id);
      wordsTotal.active += c.active;
      wordsTotal.mastered += c.mastered;
      wordsTotal.ignored += c.ignored;
    }

    const completedCount = allLessons.filter(l => l.status === 'completed' && l.completed_local_date).length;

    logger.info('PROFILE', `Profile stats loaded`, {
      userId: user.id,
      streakCurrent: streak.current,
      streakLongest: streak.longest,
      accuracyAllTime: `${accuracyAllTime}%`,
      accuracy30d: `${accuracy30d}%`,
      completedLessons: completedCount,
    });

    res.json({
      streak,
      heatmap,
      accuracy: {
        all_time: accuracyAllTime,
        last_30_days: accuracy30d,
        total_evaluated: accuracyAllTimeStats.total,
      },
      words: wordsTotal,
      completed_lessons: completedCount,
      languages: languageStats,
    });
  } catch (err: any) {
    logger.error('PROFILE', 'DB error loading stats', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
