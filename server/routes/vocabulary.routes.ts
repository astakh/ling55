import { Router, Response } from 'express';
import { db } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();

// GET /vocabulary/list?language_profile_id=&status=&q=&page=&page_size=
router.get('/list', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const profileId = (req.query.language_profile_id as string) || user.active_language_profile_id;
  const statusFilter = req.query.status as string;
  const searchQuery = (req.query.q as string || '').toLowerCase().trim();
  const page = Math.max(parseInt(req.query.page as string || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string || '20', 10), 1), 50);

  const profile = db.tables.user_language_profiles.find(
    p => p.id === profileId && p.user_id === user.id
  );
  if (!profile) {
    logger.warn('VOCABULARY', 'Vocabulary list request: profile not found', { userId: user.id, profileId });
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль не найден' },
    });
    return;
  }

  let userWords = db.tables.user_words.filter(uw => uw.language_profile_id === profile.id);

  if (statusFilter && ['active', 'mastered', 'ignored'].includes(statusFilter)) {
    userWords = userWords.filter(uw => uw.status === statusFilter);
  }

  // Join with Word entity
  let items = userWords.map(uw => {
    const word = db.tables.words.find(w => w.id === uw.word_id);
    if (!word) return null;

    let dueInLessons: number | null = null;
    if (uw.status === 'active' && uw.due_lesson_number !== null) {
      dueInLessons = Math.max(uw.due_lesson_number - profile.last_lesson_number, 0);
    }

    return {
      word_id: word.id,
      lemma: word.lemma,
      pos: word.pos,
      level: word.level,
      translations: word.translations,
      status: uw.status,
      stage: uw.stage,
      due_in_lessons: dueInLessons,
    };
  }).filter(Boolean) as Array<{
    word_id: string;
    lemma: string;
    pos: string;
    level: string | null;
    translations: string[];
    status: string;
    stage: number;
    due_in_lessons: number | null;
  }>;

  // Search filter
  if (searchQuery) {
    items = items.filter(item => {
      const matchLemma = item.lemma.toLowerCase().includes(searchQuery);
      const matchTr = item.translations.some(tr => tr.toLowerCase().includes(searchQuery));
      return matchLemma || matchTr;
    });
  }

  // Sort alphabetically by lemma
  items.sort((a, b) => a.lemma.localeCompare(b.lemma));

  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginated = items.slice(startIndex, startIndex + pageSize);

  logger.info('VOCABULARY', 'Vocabulary list retrieved', {
    userId: user.id,
    profileId,
    statusFilter: statusFilter || 'all',
    searchQuery: searchQuery || undefined,
    page,
    total,
  });

  res.json({
    items: paginated,
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
  });
});

// GET /vocabulary/word/:id?language_profile_id=
router.get('/word/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const wordId = req.params.id;
  const profileId = (req.query.language_profile_id as string) || user.active_language_profile_id;

  const profile = db.tables.user_language_profiles.find(
    p => p.id === profileId && p.user_id === user.id
  );
  if (!profile) {
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль не найден' },
    });
    return;
  }

  const uw = db.tables.user_words.find(
    u => u.language_profile_id === profile.id && u.word_id === wordId
  );
  if (!uw) {
    res.status(404).json({
      error: { code: 'word_not_in_vocabulary', message: 'Слово не найдено в вашем словаре' },
    });
    return;
  }

  const word = db.tables.words.find(w => w.id === wordId);
  if (!word) {
    res.status(404).json({
      error: { code: 'word_not_found', message: 'Слово не найдено' },
    });
    return;
  }

  // Fetch context history (last 20 occurrences in exercises)
  const exerciseWords = db.tables.lesson_exercise_words
    .filter(ew => ew.word_id === wordId)
    .slice(-20)
    .reverse();

  const history = exerciseWords.map(ew => {
    const ex = db.tables.lesson_exercises.find(e => e.id === ew.exercise_id);
    const les = ex ? db.tables.lessons.find(l => l.id === ex.lesson_id) : null;
    return {
      exercise_id: ew.exercise_id,
      target_sentence: ex ? ex.target_sentence : '',
      reference_translation: ex ? ex.reference_translation : '',
      surface_form: ew.surface_form,
      result: ew.result,
      is_target: ew.is_target,
      date: les ? les.started_at : ex?.evaluated_at || null,
    };
  });

  let dueInLessons: number | null = null;
  if (uw.status === 'active' && uw.due_lesson_number !== null) {
    dueInLessons = Math.max(uw.due_lesson_number - profile.last_lesson_number, 0);
  }

  logger.info('VOCABULARY', `Word details fetched: "${word.lemma}"`, {
    userId: user.id,
    profileId,
    wordId: word.id,
    status: uw.status,
    stage: uw.stage,
    historyOccurrences: history.length,
  });

  res.json({
    word_id: word.id,
    lemma: word.lemma,
    pos: word.pos,
    level: word.level,
    translations: word.translations,
    status: uw.status,
    stage: uw.stage,
    due_in_lessons: dueInLessons,
    last_reviewed_at: uw.last_reviewed_at,
    history,
  });
});

// PATCH /vocabulary/word/:id/status
router.patch('/word/:id/status', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const wordId = req.params.id;
  const { language_profile_id, status } = req.body;

  const profileId = language_profile_id || user.active_language_profile_id;
  const profile = db.tables.user_language_profiles.find(
    p => p.id === profileId && p.user_id === user.id
  );
  if (!profile) {
    res.status(404).json({
      error: { code: 'profile_not_found', message: 'Профиль не найден' },
    });
    return;
  }

  const uw = db.tables.user_words.find(
    u => u.language_profile_id === profile.id && u.word_id === wordId
  );
  if (!uw) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Слово не найдено в словаре' },
    });
    return;
  }

  const word = db.tables.words.find(w => w.id === wordId);

  // Idempotent check
  if (uw.status === status) {
    res.json({ success: true, status: uw.status, stage: uw.stage });
    return;
  }

  const oldStatus = uw.status;

  // Transitions:
  // active -> ignored
  // ignored -> active (reset stage = 0, due = last_lesson_number + 1)
  // mastered -> active (reset stage = 0, due = last_lesson_number + 1)
  if (uw.status === 'active' && status === 'ignored') {
    uw.status = 'ignored';
    uw.due_lesson_number = null;
  } else if ((uw.status === 'ignored' || uw.status === 'mastered') && status === 'active') {
    uw.status = 'active';
    uw.stage = 0;
    uw.due_lesson_number = profile.last_lesson_number + 1;
  } else {
    res.status(409).json({
      error: { code: 'invalid_transition', message: `Недопустимый переход из ${uw.status} в ${status}` },
    });
    return;
  }

  db.saveSync();
  logger.info('VOCABULARY', `Word status changed: ${oldStatus} -> ${status}`, {
    userId: user.id,
    profileId,
    wordId,
    lemma: word?.lemma,
    newStatus: uw.status,
    newStage: uw.stage,
    dueLessonNumber: uw.due_lesson_number,
  });

  res.json({ success: true, status: uw.status, stage: uw.stage, due_lesson_number: uw.due_lesson_number });
});

export default router;
