import { Router, Response } from 'express';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';

const router = Router();

// GET /dashboard/summary?language_profile_id=
router.get('/summary', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;

  if (!user.is_onboarded) {
    res.status(403).json({
      error: { code: 'not_onboarded', message: 'Онбординг не завершен' },
    });
    return;
  }

  const requestedProfileId = (req.query.language_profile_id as string) || user.active_language_profile_id;
  const profiles = db.tables.user_language_profiles.filter(p => p.user_id === user.id);

  if (profiles.length === 0) {
    res.status(404).json({
      error: { code: 'no_profiles', message: 'Языковые профили не найдены' },
    });
    return;
  }

  let activeProfile = profiles.find(p => p.id === requestedProfileId);
  if (!activeProfile) {
    activeProfile = profiles[0];
  }

  const lang = db.tables.languages.find(l => l.code === activeProfile!.target_language);
  const dict = db.tables.dictionaries.find(d => d.id === activeProfile!.dictionary_id);

  const today = getLocalDateString(new Date(), user.timezone);

  // Count lessons started today in this profile
  const lessonsToday = db.tables.lessons.filter(
    l => l.language_profile_id === activeProfile!.id && l.started_local_date === today
  ).length;

  // Check for in_progress lesson
  const inProgressLesson = db.tables.lessons.find(
    l => l.language_profile_id === activeProfile!.id && l.status === 'in_progress'
  );

  let cta: 'start' | 'resume' | 'limit_reached' = 'start';
  let resumeInfo = null;

  if (inProgressLesson) {
    cta = 'resume';
    const exercises = db.tables.lesson_exercises.filter(e => e.lesson_id === inProgressLesson.id);
    const exercisesDone = exercises.filter(e => e.status === 'evaluated').length;
    resumeInfo = {
      lesson_id: inProgressLesson.id,
      exercises_done: exercisesDone,
      exercises_total: exercises.length,
    };
  } else if (lessonsToday >= activeProfile.daily_lesson_limit) {
    cta = 'limit_reached';
  } else {
    cta = 'start';
  }

  // Word counts
  const userWords = db.tables.user_words.filter(w => w.language_profile_id === activeProfile!.id);
  const wordsSummary = {
    active: userWords.filter(w => w.status === 'active').length,
    mastered: userWords.filter(w => w.status === 'mastered').length,
    ignored: userWords.filter(w => w.status === 'ignored').length,
  };

  // Streak across all profiles of user
  const completedDates = db.tables.lessons
    .filter(l => {
      const p = db.tables.user_language_profiles.find(lp => lp.id === l.language_profile_id);
      return p && p.user_id === user.id && l.status === 'completed' && l.completed_local_date;
    })
    .map(l => l.completed_local_date!);

  const streak = calculateStreak(completedDates, today);

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
      const l = db.tables.languages.find(langItem => langItem.code === p.target_language);
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
});

export default router;
