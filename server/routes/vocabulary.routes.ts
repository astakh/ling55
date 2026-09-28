import { Router, Response } from 'express';
import {
  profilesRepo, userWordsRepo, wordsRepo, exerciseWordsRepo,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();

// GET /vocabulary/list?language_profile_id=&status=&q=&page=&page_size=
router.get('/list', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const profileId = (req.query.language_profile_id as string) || user.active_language_profile_id || '';
  const statusFilter = req.query.status as string;
  const searchQuery = (String(req.query.q || '')).toLowerCase().trim();
  const page = Math.max(parseInt(req.query.page as string || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size as string || '20', 10), 1), 50);

  try {
    const profile = await profilesRepo.findByIdAndUser(profileId, user.id);
    if (!profile) {
      logger.warn('VOCABULARY', 'Vocabulary list request: profile not found', { userId: user.id, profileId });
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль не найден' },
      });
      return;
    }

    const userWords = await userWordsRepo.listByProfile(
      profile.id,
      statusFilter && ['active', 'mastered', 'ignored'].includes(statusFilter) ? statusFilter : undefined
    );

    // Join with Word entity
    const wordIds = userWords.map(uw => uw.word_id);
    const words = await wordsRepo.findByIds(wordIds);
    const wordsById = new Map(words.map(w => [w.id, w]));

    let items = userWords
      .map(uw => {
        const word = wordsById.get(uw.word_id);
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
      })
      .filter(Boolean) as Array<{
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
  } catch (err: any) {
    logger.error('VOCABULARY', 'DB error listing vocabulary', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /vocabulary/word/:id?language_profile_id=
router.get('/word/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const wordId = req.params.id;
  const profileId = (req.query.language_profile_id as string) || user.active_language_profile_id || '';

  try {
    const profile = await profilesRepo.findByIdAndUser(profileId, user.id);
    if (!profile) {
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль не найден' },
      });
      return;
    }

    const uw = await userWordsRepo.findByProfileAndWord(profile.id, wordId);
    if (!uw) {
      res.status(404).json({
        error: { code: 'word_not_in_vocabulary', message: 'Слово не найдено в вашем словаре' },
      });
      return;
    }

    const word = await wordsRepo.findById(wordId);
    if (!word) {
      res.status(404).json({
        error: { code: 'word_not_found', message: 'Слово не найдено' },
      });
      return;
    }

    // Fetch context history (last 20 occurrences in exercises)
    const recent = await exerciseWordsRepo.recentByWord(wordId, 20);

    const history = recent.map(ew => ({
      exercise_id: ew.exercise_id,
      target_sentence: ew.target_sentence,
      reference_translation: ew.reference_translation,
      surface_form: ew.surface_form,
      result: ew.result,
      is_target: ew.is_target,
      date: ew.started_at || ew.evaluated_at || null,
    }));

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
  } catch (err: any) {
    logger.error('VOCABULARY', 'DB error loading word', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// PATCH /vocabulary/word/:id/status
router.patch('/word/:id/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const wordId = req.params.id;
  const { language_profile_id, status } = req.body;

  const profileId = language_profile_id || user.active_language_profile_id;

  try {
    const profile = await profilesRepo.findByIdAndUser(profileId, user.id);
    if (!profile) {
      res.status(404).json({
        error: { code: 'profile_not_found', message: 'Профиль не найден' },
      });
      return;
    }

    const uw = await userWordsRepo.findByProfileAndWord(profile.id, wordId);
    if (!uw) {
      res.status(404).json({
        error: { code: 'not_found', message: 'Слово не найдено в словаре' },
      });
      return;
    }

    const word = await wordsRepo.findById(wordId);

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
    let patch: Partial<{ status: 'active' | 'mastered' | 'ignored'; stage: number; due_lesson_number: number | null }> | null = null;
    if (uw.status === 'active' && status === 'ignored') {
      patch = { status: 'ignored', due_lesson_number: null };
    } else if ((uw.status === 'ignored' || uw.status === 'mastered') && status === 'active') {
      patch = { status: 'active', stage: 0, due_lesson_number: profile.last_lesson_number + 1 };
    } else {
      res.status(409).json({
        error: { code: 'invalid_transition', message: `Недопустимый переход из ${uw.status} в ${status}` },
      });
      return;
    }

    const updated = await userWordsRepo.updateSrs(uw.id, patch);

    logger.info('VOCABULARY', `Word status changed: ${oldStatus} -> ${status}`, {
      userId: user.id,
      profileId,
      wordId,
      lemma: word?.lemma,
      newStatus: updated?.status,
      newStage: updated?.stage,
      dueLessonNumber: updated?.due_lesson_number,
    });

    res.json({
      success: true,
      status: updated?.status,
      stage: updated?.stage,
      due_lesson_number: updated?.due_lesson_number,
    });
  } catch (err: any) {
    logger.error('VOCABULARY', 'DB error updating word status', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
