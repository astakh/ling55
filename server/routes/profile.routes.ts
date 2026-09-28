import { Router, Response } from 'express';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, calculateStreak } from '../streak.js';

const router = Router();

// GET /profile/stats
router.get('/stats', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const today = getLocalDateString(new Date(), user.timezone);

  const profiles = db.tables.user_language_profiles.filter(p => p.user_id === user.id);
  const profileIds = new Set(profiles.map(p => p.id));

  // Lessons
  const allUserLessons = db.tables.lessons.filter(l => profileIds.has(l.language_profile_id));
  const completedLessons = allUserLessons.filter(l => l.status === 'completed' && l.completed_local_date);

  // Streaks
  const completedDates = completedLessons.map(l => l.completed_local_date!);
  const streak = calculateStreak(completedDates, today);

  // Heatmap: count completed lessons per completed_local_date (past 365 days)
  const heatmap: Record<string, number> = {};
  for (const l of completedLessons) {
    if (l.completed_local_date) {
      heatmap[l.completed_local_date] = (heatmap[l.completed_local_date] || 0) + 1;
    }
  }

  // Accuracy calculation (all-time & 30-day)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

  const lessonIds = new Set(allUserLessons.map(l => l.id));
  const exercises = db.tables.lesson_exercises.filter(e => lessonIds.has(e.lesson_id));
  const exerciseIds = new Set(exercises.map(e => e.id));

  const allEvaluatedWords = db.tables.lesson_exercise_words.filter(
    ew => exerciseIds.has(ew.exercise_id) && ew.is_target && ew.result !== null
  );

  const countCorrect = (words: typeof allEvaluatedWords) =>
    words.filter(w => w.result === 'correct' || w.result === 'typo').length;

  const totalAllTime = allEvaluatedWords.length;
  const correctAllTime = countCorrect(allEvaluatedWords);
  const accuracyAllTime = totalAllTime > 0 ? Math.round((correctAllTime / totalAllTime) * 100) : 0;

  // 30 days
  const recentExercises = new Set(
    exercises.filter(e => e.evaluated_at && e.evaluated_at >= thirtyDaysAgoStr).map(e => e.id)
  );
  const words30d = allEvaluatedWords.filter(w => recentExercises.has(w.exercise_id));
  const accuracy30d = words30d.length > 0 ? Math.round((countCorrect(words30d) / words30d.length) * 100) : 0;

  // Breakdown by language
  const languageStats = profiles.map(p => {
    const lang = db.tables.languages.find(l => l.code === p.target_language);
    const pLessons = allUserLessons.filter(l => l.language_profile_id === p.id);
    const pLessonIds = new Set(pLessons.map(l => l.id));
    const pExercises = new Set(exercises.filter(e => pLessonIds.has(e.lesson_id)).map(e => e.id));
    const pWords = allEvaluatedWords.filter(w => pExercises.has(w.exercise_id));

    const pUserWords = db.tables.user_words.filter(w => w.language_profile_id === p.id);
    const active = pUserWords.filter(w => w.status === 'active').length;
    const mastered = pUserWords.filter(w => w.status === 'mastered').length;
    const ignored = pUserWords.filter(w => w.status === 'ignored').length;

    const pCorrect = countCorrect(pWords);
    const pAcc = pWords.length > 0 ? Math.round((pCorrect / pWords.length) * 100) : 0;

    return {
      profile_id: p.id,
      target_language: p.target_language,
      language_name: lang ? lang.name : p.target_language,
      level: p.level,
      words: { active, mastered, ignored },
      completed_lessons: pLessons.filter(l => l.status === 'completed').length,
      accuracy: pAcc,
      total_words_evaluated: pWords.length,
    };
  });

  // Overall word counts
  const allUserWords = db.tables.user_words.filter(w => profileIds.has(w.language_profile_id));
  const wordsTotal = {
    active: allUserWords.filter(w => w.status === 'active').length,
    mastered: allUserWords.filter(w => w.status === 'mastered').length,
    ignored: allUserWords.filter(w => w.status === 'ignored').length,
  };

  res.json({
    streak,
    heatmap,
    accuracy: {
      all_time: accuracyAllTime,
      last_30_days: accuracy30d,
      total_evaluated: totalAllTime,
    },
    words: wordsTotal,
    completed_lessons: completedLessons.length,
    languages: languageStats,
  });
});

export default router;
