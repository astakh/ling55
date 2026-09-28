/**
 * Маршруты урока (алгоритмы 5.2–5.6, разделы 6.4–6.8).
 * Все данные читаются/пишутся через слой доступа к PostgreSQL (server/db.ts).
 */
import { Router, Response } from 'express';
import crypto from 'crypto';
import {
  Word, UserWord, Lesson, LessonExercise,
  profilesRepo, dictionariesRepo, wordsRepo, userWordsRepo,
  lessonsRepo, exercisesRepo, exerciseWordsRepo, suggestionsRepo,
  reportsRepo, eventsRepo, uuid, nowIso,
} from '../db.js';
import { withTransaction, withProfileLock } from '../pg.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { updateSrs } from '../srs.js';
import { generateLessonSentences, evaluateTranslation, TargetWordEvalInput } from '../llm.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';
import { logger } from '../logger.js';

const router = Router();
const WORDS_PER_LESSON = parseInt(process.env.WORDS_PER_LESSON || '5', 10);

function getLevelsForProfile(level: string): string[] {
  if (level === 'A1') return ['A1'];
  if (level === 'A2') return ['A1', 'A2'];
  if (level === 'B1') return ['A2', 'B1'];
  if (level === 'B2') return ['B1', 'B2'];
  return [level];
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Preview word selection algorithm (Alg 5.2)
 */
async function computePreview(profileId: string, userId: string, userTimezone: string) {
  const profile = await profilesRepo.findByIdAndUser(profileId, userId);
  if (!profile) return { error: 'not_found' };

  // 1. Check in_progress
  const inProgress = await lessonsRepo.findInProgress(profile.id);
  if (inProgress) {
    const exercises = await exercisesRepo.listByLesson(inProgress.id);
    const done = exercises.filter(e => e.status === 'evaluated').length;
    return {
      state: 'resume',
      lesson_id: inProgress.id,
      exercises_done: done,
      exercises_total: exercises.length,
    };
  }

  // 2. Check daily limit
  const today = getLocalDateString(new Date(), userTimezone);
  const lessonsToday = await lessonsRepo.countStartedToday(profile.id, today);

  if (lessonsToday >= profile.daily_lesson_limit) {
    return {
      state: 'limit_reached',
      resets_at: getMidnightResetUtc(userTimezone),
      lessons_today: lessonsToday,
      daily_lesson_limit: profile.daily_lesson_limit,
    };
  }

  // 3. Compute seed and next lesson number
  const nextLessonNumber = profile.last_lesson_number + 1;
  const seed = sha256(`${profile.id}:${nextLessonNumber}`);

  // 4. Due words: user_words active with due_lesson_number <= nextLessonNumber
  const dueUserWords = await userWordsRepo.dueWords(profile.id, nextLessonNumber);

  const dueWordIds = dueUserWords.map(uw => uw.word_id);
  const dueWordsMap = new Map<string, Word>();
  if (dueWordIds.length > 0) {
    for (const w of await wordsRepo.findByIds(dueWordIds)) dueWordsMap.set(w.id, w);
  }

  const dueRanked = dueUserWords
    .map(uw => {
      const word = dueWordsMap.get(uw.word_id)!;
      const rank = sha256(`${seed}:${uw.word_id}`);
      return { uw, word, rank };
    })
    .filter(item => Boolean(item.word));

  dueRanked.sort((a, b) => a.rank.localeCompare(b.rank));
  const selectedDue = dueRanked.slice(0, WORDS_PER_LESSON);

  // 5. New words from active dictionary
  const neededNew = WORDS_PER_LESSON - selectedDue.length;
  let selectedNew: Array<{ word: Word; rank: string }> = [];

  if (neededNew > 0) {
    const existingUserWordIds = await userWordsRepo.wordIdsByProfile(profile.id);

    const allowedLevels = getLevelsForProfile(profile.level);
    const dict = await dictionariesRepo.findById(profile.dictionary_id);
    const isGeneral = dict ? dict.is_general : true;

    const candidateWords = await wordsRepo.candidatesFromDictionary({
      dictionaryId: profile.dictionary_id,
      excludeWordIds: existingUserWordIds,
      targetLanguage: profile.target_language,
      nativeLanguage: 'ru',
      allowedLevels,
      isGeneral,
    });

    const newRanked = candidateWords.map(w => ({
      word: w,
      rank: sha256(`${seed}:${w.id}`),
    }));

    newRanked.sort((a, b) => a.rank.localeCompare(b.rank));
    selectedNew = newRanked.slice(0, neededNew);
  }

  const totalWords = selectedDue.length + selectedNew.length;
  if (totalWords === 0) {
    return { state: 'no_words', lesson_number: nextLessonNumber };
  }

  const dictionaryExhausted = totalWords < WORDS_PER_LESSON;

  return {
    state: 'ready',
    lesson_number: nextLessonNumber,
    due_words: selectedDue.map(d => ({
      word_id: d.word.id,
      lemma: d.word.lemma,
      pos: d.word.pos,
    })),
    new_words: selectedNew.map(n => ({
      word_id: n.word.id,
      lemma: n.word.lemma,
      pos: n.word.pos,
      translations: n.word.translations,
    })),
    dictionary_exhausted: dictionaryExhausted,
  };
}

// POST /lesson/preview
router.post('/preview', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id } = req.body;

  const profileId = language_profile_id || user.active_language_profile_id;
  if (!profileId) {
    logger.warn('LESSON', 'Preview request missing language profile', { userId: user.id });
    res.status(422).json({
      error: { code: 'missing_profile', message: 'Не указан языковой профиль' },
    });
    return;
  }

  try {
    const preview = await computePreview(profileId, user.id, user.timezone);
    if ((preview as any).error === 'not_found') {
      logger.warn('LESSON', 'Preview request: profile not found', { userId: user.id, profileId });
      res.status(403).json({
        error: { code: 'forbidden', message: 'Профиль не найден или недоступен' },
      });
      return;
    }

    logger.info('LESSON', `Preview computed`, {
      userId: user.id,
      profileId,
      state: (preview as any).state,
      lessonNumber: (preview as any).lesson_number,
      dueCount: (preview as any).due_words?.length || 0,
      newCount: (preview as any).new_words?.length || 0,
    });

    res.json(preview);
  } catch (err: any) {
    logger.error('LESSON', 'Preview failed', { userId: user.id, message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка формирования превью' } });
  }
});

// POST /lesson/new-word/decline (Algorithm 5.3)
router.post('/new-word/decline', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id, word_id } = req.body;

  if (!word_id) {
    res.status(422).json({
      error: { code: 'missing_word_id', message: 'Не указан ID слова' },
    });
    return;
  }

  const profileId = language_profile_id || user.active_language_profile_id;
  const profile = await profilesRepo.findByIdAndUser(profileId, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Профиль не найден' },
    });
    return;
  }

  // Check in_progress
  const inProgress = await lessonsRepo.findInProgress(profile.id);
  if (inProgress) {
    res.status(409).json({
      error: { code: 'lesson_in_progress', message: 'Нельзя отклонять слова во время идущего урока' },
    });
    return;
  }

  const word = await wordsRepo.findById(word_id);
  if (!word) {
    res.status(404).json({
      error: { code: 'word_not_found', message: 'Слово не найдено' },
    });
    return;
  }

  // Check status in user_words
  const existingUserWord = await userWordsRepo.findByProfileAndWord(profile.id, word_id);

  if (existingUserWord) {
    if (existingUserWord.status === 'active' || existingUserWord.status === 'mastered') {
      res.status(409).json({
        error: { code: 'invalid_status', message: 'Слово уже изучается или выучено' },
      });
      return;
    }
  } else {
    await userWordsRepo.create({
      language_profile_id: profile.id,
      word_id: word.id,
      status: 'ignored',
      stage: 0,
      due_lesson_number: null,
      source: 'decline',
    });
    await eventsRepo.record(user.id, 'new_word_declined', { word_id, lemma: word.lemma });
  }

  logger.info('LESSON', `New word declined`, {
    userId: user.id,
    profileId: profile.id,
    wordId: word.id,
    lemma: word.lemma,
  });

  const updatedPreview = await computePreview(profile.id, user.id, user.timezone);
  res.json(updatedPreview);
});

// POST /lesson/start (Algorithm 5.4)
router.post('/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id, word_ids } = req.body;

  if (!Array.isArray(word_ids) || word_ids.length === 0) {
    logger.warn('LESSON', 'Start lesson rejected: empty or invalid word_ids', { userId: user.id });
    res.status(422).json({
      error: { code: 'empty_words', message: 'Список слов пуст или некорректен' },
    });
    return;
  }

  const profileId = language_profile_id || user.active_language_profile_id;
  const profile = await profilesRepo.findByIdAndUser(profileId, user.id);
  if (!profile) {
    logger.warn('LESSON', 'Start lesson rejected: forbidden profile', { userId: user.id, profileId });
    res.status(403).json({
      error: { code: 'forbidden', message: 'Профиль не принадлежит пользователю' },
    });
    return;
  }

  // Check in_progress
  const inProgress = await lessonsRepo.findInProgress(profile.id);
  if (inProgress) {
    logger.warn('LESSON', 'Start lesson rejected: lesson already in progress', {
      userId: user.id,
      lessonId: inProgress.id,
    });
    res.status(409).json({
      error: { code: 'resume_available', message: 'У вас уже есть незавершенный урок' },
    });
    return;
  }

  // Check daily limit
  const today = getLocalDateString(new Date(), user.timezone);
  const lessonsToday = await lessonsRepo.countStartedToday(profile.id, today);

  if (lessonsToday >= profile.daily_lesson_limit) {
    logger.warn('LESSON', 'Start lesson rejected: daily limit reached', {
      userId: user.id,
      lessonsToday,
      limit: profile.daily_lesson_limit,
    });
    res.status(409).json({
      error: { code: 'limit_reached', message: 'Дневной лимит уроков исчерпан' },
    });
    return;
  }

  // Advisory lock (pg_try_advisory_lock): параллельный запрос урока получает locked=false
  const { locked, result } = await withProfileLock(profile.id, async () => {
    // Determine words for the lesson
    const fetched = await wordsRepo.findByIds(word_ids);
    const byId = new Map(fetched.map(w => [w.id, w]));
    const wordsList: Word[] = [];
    for (const wid of word_ids) {
      const w = byId.get(wid);
      if (w) wordsList.push(w);
    }

    if (wordsList.length === 0) {
      return { kind: 'empty_words' as const };
    }

    const nextLessonNumber = profile.last_lesson_number + 1;
    const N = wordsList.length;

    logger.info('LESSON', `Starting lesson #${nextLessonNumber}`, {
      userId: user.id,
      targetLanguage: profile.target_language,
      level: profile.level,
      totalWords: N,
      lemmas: wordsList.map(w => w.lemma),
    });

    // Cluster into k = ceil(N / 3) groups
    // Sizes differ by at most 1, smaller groups first.
    const k = Math.ceil(N / 3);
    const groupSizes: number[] = [];
    const baseSize = Math.floor(N / k);
    const remainder = N % k;
    for (let i = 0; i < k; i++) {
      groupSizes.push(baseSize + (i >= k - remainder ? 1 : 0));
    }
    groupSizes.sort((a, b) => a - b);

    // Shuffle/distribute words deterministically
    const seed = sha256(`${profile.id}:${nextLessonNumber}`);
    const wordsWithRank = wordsList.map(w => ({
      word: w,
      rank: sha256(`${seed}:${w.id}`),
    }));
    wordsWithRank.sort((a, b) => a.rank.localeCompare(b.rank));

    const promptGroups: Array<{
      group_index: number;
      words: Array<{ lemma: string; pos: string; wordId: string }>;
      avoid_sentences: string[];
    }> = [];

    let cursor = 0;
    for (let gi = 0; gi < groupSizes.length; gi++) {
      const size = groupSizes[gi];
      const slice = wordsWithRank.slice(cursor, cursor + size);
      cursor += size;

      // Past sentences containing these words (avoid repetition)
      const wordIdsInGroup = slice.map(s => s.word.id);
      const avoidSentences = await exercisesRepo.pastSentencesForWords(wordIdsInGroup, 4);

      promptGroups.push({
        group_index: gi,
        words: slice.map(s => ({
          lemma: s.word.lemma,
          pos: s.word.pos,
          wordId: s.word.id,
        })),
        avoid_sentences: avoidSentences,
      });
    }

    const lessonId = uuid();

    // Call LLM Prompt 1 (до записи в БД — при ошибке ничего не сохраняем)
    const generatedGroups = await generateLessonSentences(
      profile.target_language,
      user.native_language,
      profile.level,
      promptGroups.map(pg => ({
        group_index: pg.group_index,
        words: pg.words.map(w => ({ lemma: w.lemma, pos: w.pos })),
        avoid_sentences: pg.avoid_sentences,
      })),
      user.id,
      profile.id,
      lessonId
    );

    // Atomic DB persistence (транзакция)
    const createdExercises = await withTransaction(async client => {
      const lessonRes = await client.query(
        `INSERT INTO lessons (id, language_profile_id, lesson_number, status, words_per_lesson, started_local_date)
         VALUES ($1, $2, $3, 'in_progress', $4, $5) RETURNING *`,
        [lessonId, profile.id, nextLessonNumber, N, today]
      );
      const newLesson = lessonRes.rows[0] as Lesson;

      await client.query(
        'UPDATE user_language_profiles SET last_lesson_number = $2 WHERE id = $1',
        [profile.id, nextLessonNumber]
      );

      // Enter new words into user_words as active, stage 0, due = this lesson
      for (const w of wordsList) {
        const ins = await client.query(
          `INSERT INTO user_words (language_profile_id, word_id, status, stage, due_lesson_number, source)
           VALUES ($1, $2, 'active', 0, $3, 'dictionary')
           ON CONFLICT (language_profile_id, word_id) DO NOTHING
           RETURNING id`,
          [profile.id, w.id, nextLessonNumber]
        );
        if (ins.rowCount && ins.rowCount > 0) {
          void eventsRepo.record(user.id, 'new_word_accepted', { word_id: w.id, lemma: w.lemma });
        }
      }

      const exercises: LessonExercise[] = [];
      for (let i = 0; i < generatedGroups.length; i++) {
        const gg = generatedGroups[i];
        const origGroup = promptGroups[i];
        const exerciseId = uuid();

        const exRes = await client.query(
          `INSERT INTO lesson_exercises (id, lesson_id, order_index, target_sentence, reference_translation)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [exerciseId, newLesson.id, i, gg.sentence, gg.reference_translation]
        );
        exercises.push(exRes.rows[0] as LessonExercise);

        for (const wItem of origGroup.words) {
          const foundWordMeta = gg.words.find(gw => gw.lemma.toLowerCase() === wItem.lemma.toLowerCase());
          const surfaceForm = foundWordMeta ? foundWordMeta.surface_form : wItem.lemma;

          const uwRes = await client.query(
            'SELECT * FROM user_words WHERE language_profile_id = $1 AND word_id = $2',
            [profile.id, wItem.wordId]
          );
          const existingUw = uwRes.rows[0] as UserWord | undefined;
          const stageBefore = existingUw ? existingUw.stage : 0;
          const isNew = existingUw
            ? existingUw.stage === 0 && existingUw.last_reviewed_at === null
            : true;

          await client.query(
            `INSERT INTO lesson_exercise_words
               (exercise_id, word_id, is_target, is_new, surface_form, stage_before)
             VALUES ($1, $2, TRUE, $3, $4, $5)`,
            [exerciseId, wItem.wordId, isNew, surfaceForm, stageBefore]
          );
        }
      }
      return exercises;
    });

    void eventsRepo.record(user.id, 'lesson_started', {
      lesson_id: lessonId,
      lesson_number: nextLessonNumber,
      words_count: N,
    });

    return { kind: 'ok' as const, lessonId, nextLessonNumber, createdExercises };
  });

  if (!locked) {
    logger.warn('LESSON', 'Start lesson rejected: lock busy', { profileId: profile.id });
    res.status(409).json({
      error: { code: 'start_in_progress', message: 'Урок уже формируется' },
    });
    return;
  }

  if (!result) {
    res.status(503).json({
      error: { code: 'llm_unavailable', message: 'Сервер временно перегружен, попробуйте еще раз' },
    });
    return;
  }

  if (result.kind === 'empty_words') {
    logger.warn('LESSON', 'Start lesson rejected: words not found in dictionary', { word_ids });
    res.status(422).json({
      error: { code: 'empty_words', message: 'Слова не найдены в словаре' },
    });
    return;
  }

  const firstExercise = result.createdExercises[0];

  res.json({
    lesson_id: result.lessonId,
    lesson_number: result.nextLessonNumber,
    exercises_total: result.createdExercises.length,
    current_exercise: {
      exercise_id: firstExercise.id,
      order_index: firstExercise.order_index,
      sentence: firstExercise.target_sentence,
    },
  });
});

/** Формирование ответа упражнения (по данным из БД). */
async function buildExerciseResponse(
  exercise: LessonExercise,
  lesson: Lesson,
  extra?: Partial<{ lesson_completed: boolean }>
) {
  const exerciseWords = await exerciseWordsRepo.listByExercise(exercise.id, true);
  const suggestions = await suggestionsRepo.listByExercise(exercise.id);
  const pendingLeft = await exercisesRepo.countPending(lesson.id);

  const wordIds = [...exerciseWords.map(ew => ew.word_id), ...suggestions.map(s => s.word_id)];
  const words = await wordsRepo.findByIds(wordIds);
  const wordsMap = new Map(words.map(w => [w.id, w]));

  return {
    exercise_id: exercise.id,
    target_sentence: exercise.target_sentence,
    reference_translation: exercise.reference_translation,
    user_translation: exercise.user_translation,
    words: exerciseWords.map(ew => {
      const w = wordsMap.get(ew.word_id)!;
      return {
        word_id: w.id,
        lemma: w.lemma,
        pos: w.pos,
        surface_form: ew.surface_form,
        result: ew.result,
        user_fragment: ew.user_fragment,
        translations: w.translations,
      };
    }),
    suggestions: suggestions.map(s => {
      const w = wordsMap.get(s.word_id);
      return {
        word_id: s.word_id,
        lemma: w ? w.lemma : '',
        pos: w ? w.pos : 'noun',
        translations: w ? w.translations : [],
        state: s.state,
      };
    }),
    lesson_completed: extra && extra.lesson_completed !== undefined
      ? extra.lesson_completed
      : pendingLeft === 0,
  };
}

// POST /lesson/evaluate (Algorithm 5.5)
router.post('/evaluate', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { exercise_id, user_translation, dont_know } = req.body;

  if (!exercise_id) {
    logger.warn('LESSON', 'Evaluation rejected: missing exercise_id', { userId: user.id });
    res.status(422).json({
      error: { code: 'missing_exercise_id', message: 'Не указан ID упражнения' },
    });
    return;
  }

  const exercise = await exercisesRepo.findById(exercise_id);
  if (!exercise) {
    logger.warn('LESSON', 'Evaluation rejected: exercise not found', { exercise_id });
    res.status(404).json({
      error: { code: 'exercise_not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const lesson = await lessonsRepo.findById(exercise.lesson_id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'lesson_not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  // Idempotency: if already evaluated, return saved result
  if (exercise.status === 'evaluated') {
    logger.info('LESSON', 'Evaluation returned from cache (idempotent)', { exerciseId: exercise.id });
    res.json(await buildExerciseResponse(exercise, lesson));
    return;
  }

  // Check lesson in_progress
  if (lesson.status !== 'in_progress') {
    res.status(409).json({
      error: { code: 'lesson_not_active', message: 'Урок уже завершен или закрыт' },
    });
    return;
  }

  // Order check: evaluate only first pending exercise
  const currentPending = await exercisesRepo.firstPending(lesson.id);
  if (!currentPending || currentPending.id !== exercise.id) {
    res.status(409).json({
      error: { code: 'not_current_exercise', message: 'Это не текущее упражнение урока' },
    });
    return;
  }

  // Target words for this exercise
  const exerciseWords = await exerciseWordsRepo.listByExercise(exercise.id, true);
  const evalWordIds = exerciseWords.map(ew => ew.word_id);
  const evalWords = await wordsRepo.findByIds(evalWordIds);
  const evalWordsMap = new Map(evalWords.map(w => [w.id, w]));

  const targetWordsInput: TargetWordEvalInput[] = exerciseWords.map(ew => {
    const w = evalWordsMap.get(ew.word_id)!;
    return {
      word_id: w.id,
      lemma: w.lemma,
      pos: w.pos,
      surface_form: ew.surface_form || w.lemma,
      correct_translations: w.translations,
    };
  });

  let evalResult: {
    evaluations: Array<{ word_id: string; result: 'correct' | 'typo' | 'incorrect'; user_fragment: string | null }>;
    new_suggested_words: Array<{ lemma: string; pos: string }>;
  };

  const isDontKnow = Boolean(dont_know);

  if (isDontKnow) {
    logger.info('LESSON', `Exercise answered with "Не знаю" (skipped LLM call)`, {
      exerciseId: exercise.id,
      targetWords: targetWordsInput.map(t => t.lemma),
    });
    evalResult = {
      evaluations: targetWordsInput.map(tw => ({
        word_id: tw.word_id,
        result: 'incorrect',
        user_fragment: null,
      })),
      new_suggested_words: [],
    };
  } else {
    // Call LLM Prompt 2
    try {
      evalResult = await evaluateTranslation(
        exercise.target_sentence,
        exercise.reference_translation,
        targetWordsInput,
        user_translation || '',
        profile.target_language,
        user.native_language,
        user.id,
        profile.id,
        lesson.id,
        exercise.id
      );
    } catch (err: any) {
      logger.error('LESSON', 'LLM evaluation error', { error: err.message });
      res.status(503).json({
        error: { code: 'llm_unavailable', message: 'Сервер перегружен, попробуйте ещё раз' },
      });
      return;
    }
  }

  // Persist evaluation atomically
  const completedLocalDate = getLocalDateString(new Date(), user.timezone);
  const outcome = await withTransaction(async client => {
    const exRes = await client.query(
      `UPDATE lesson_exercises
       SET user_translation = $2, dont_know = $3, status = 'evaluated', evaluated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [exercise.id, isDontKnow ? null : (user_translation || ''), isDontKnow]
    );
    // Параллельный повторный запрос: результат уже сохранён — вернём кэшированный
    if (!exRes.rows[0]) return { raced: true as const };
    const updatedExercise = exRes.rows[0] as LessonExercise;

    const formattedWordsResponse = [];

    for (const ew of exerciseWords) {
      const ev = evalResult.evaluations.find(e => e.word_id === ew.word_id) || {
        word_id: ew.word_id,
        result: 'incorrect' as const,
        user_fragment: null,
      };

      const w = evalWordsMap.get(ew.word_id)!;

      // SRS Update
      const uwRes = await client.query(
        'SELECT * FROM user_words WHERE language_profile_id = $1 AND word_id = $2',
        [profile.id, ew.word_id]
      );
      const uw = uwRes.rows[0] as UserWord | undefined;

      let stageBefore: number | null = null;
      let stageAfter: number | null = null;

      if (uw && uw.status === 'active') {
        const srsRes = updateSrs(uw.stage, ev.result, lesson.lesson_number);
        stageBefore = uw.stage;
        stageAfter = srsRes.newStage;

        await client.query(
          `UPDATE user_words
             SET stage = $2, due_lesson_number = $3, status = $4, last_reviewed_at = now()
           WHERE id = $1`,
          [uw.id, srsRes.newStage, srsRes.dueLessonNumber, srsRes.status]
        );
      }

      await client.query(
        `UPDATE lesson_exercise_words
           SET result = $2, user_fragment = $3, stage_before = $4, stage_after = $5
         WHERE id = $1`,
        [ew.id, ev.result, ev.user_fragment, stageBefore, stageAfter]
      );

      formattedWordsResponse.push({
        word_id: w.id,
        lemma: w.lemma,
        pos: w.pos,
        surface_form: ew.surface_form,
        result: ev.result,
        user_fragment: ev.user_fragment,
        translations: w.translations,
      });
    }

    // Match suggested words against dictionary
    const allowedSuggestions = [];
    const existingUserWordIds = new Set(await userWordsRepo.wordIdsByProfile(profile.id));

    for (const sw of evalResult.new_suggested_words) {
      const lemmaKey = sw.lemma.trim().normalize('NFC').toLowerCase();
      const matchedWord = await wordsRepo.findByLemmaKey(
        profile.target_language, user.native_language, lemmaKey
      );

      if (matchedWord && !existingUserWordIds.has(matchedWord.id)) {
        const created = await client.query(
          `INSERT INTO lesson_exercise_suggestions (exercise_id, word_id, state)
           VALUES ($1, $2, 'suggested')
           ON CONFLICT (exercise_id, word_id) DO NOTHING
           RETURNING *`,
          [exercise.id, matchedWord.id]
        );
        if (created.rows[0]) {
          allowedSuggestions.push({
            word_id: matchedWord.id,
            lemma: matchedWord.lemma,
            pos: matchedWord.pos,
            translations: matchedWord.translations,
            state: 'suggested',
          });
        }
      }
    }

    // Auto-complete lesson if no pending exercises remain
    const pendingLeftRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM lesson_exercises WHERE lesson_id = $1 AND status = 'pending'`,
      [lesson.id]
    );
    let lessonCompleted = false;
    if (Number(pendingLeftRes.rows[0].c) === 0) {
      const compRes = await client.query(
        `UPDATE lessons
            SET status = 'completed', completed_at = now(), completed_local_date = $2
          WHERE id = $1 AND status = 'in_progress'
          RETURNING *`,
        [lesson.id, completedLocalDate]
      );
      lessonCompleted = Boolean(compRes.rows[0]);

      if (lessonCompleted) {
        logger.success('LESSON', `Lesson #${lesson.lesson_number} auto-completed!`, {
          lessonId: lesson.id,
          completedLocalDate,
        });
        void eventsRepo.record(user.id, 'lesson_completed', {
          lesson_id: lesson.id,
          lesson_number: lesson.lesson_number,
        });
      }
    }

    return {
      raced: false as const,
      updatedExercise,
      formattedWordsResponse,
      allowedSuggestions,
      lessonCompleted,
    };
  });

  if (outcome.raced) {
    const fresh = await exercisesRepo.findById(exercise.id);
    res.json(await buildExerciseResponse(fresh!, lesson));
    return;
  }

  void eventsRepo.record(user.id, 'exercise_evaluated', {
    exercise_id: exercise.id,
    lesson_id: lesson.id,
    dont_know: isDontKnow,
  });

  logger.info('LESSON', `Exercise evaluated`, {
    exerciseId: exercise.id,
    orderIndex: exercise.order_index,
    dontKnow: isDontKnow,
    results: outcome.formattedWordsResponse.map(w => `${w.lemma}:${w.result}`),
    suggestionsCount: outcome.allowedSuggestions.length,
    lessonCompleted: outcome.lessonCompleted,
  });

  res.json({
    exercise_id: exercise.id,
    target_sentence: exercise.target_sentence,
    reference_translation: exercise.reference_translation,
    user_translation: outcome.updatedExercise.user_translation,
    words: outcome.formattedWordsResponse,
    suggestions: outcome.allowedSuggestions,
    lesson_completed: outcome.lessonCompleted,
  });
});

// GET /lesson/:id/current (Section 6.4 Resume)
router.get('/:id/current', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = await lessonsRepo.findById(req.params.id);
  if (!lesson) {
    logger.warn('LESSON', 'Current exercise request: lesson not found', { lessonId: req.params.id });
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  const exercises = await exercisesRepo.listByLesson(lesson.id);

  const doneCount = exercises.filter(e => e.status === 'evaluated').length;
  const currentPending = exercises.find(e => e.status === 'pending');

  if (!currentPending) {
    logger.info('LESSON', 'All exercises already evaluated for lesson', { lessonId: lesson.id });
    res.status(409).json({
      error: { code: 'lesson_not_active', message: 'Все упражнения уже завершены' },
    });
    return;
  }

  logger.info('LESSON', `Resuming lesson #${lesson.lesson_number}`, {
    lessonId: lesson.id,
    currentExerciseIndex: currentPending.order_index,
    doneCount,
    totalCount: exercises.length,
  });

  res.json({
    exercise_id: currentPending.id,
    sentence: currentPending.target_sentence,
    order_index: currentPending.order_index,
    exercises_done: doneCount,
    exercises_total: exercises.length,
  });
});

// GET /lesson/:id/summary (Algorithm 5.6)
router.get('/:id/summary', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = await lessonsRepo.findById(req.params.id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  if (lesson.status !== 'completed') {
    res.status(409).json({
      error: { code: 'lesson_not_completed', message: 'Урок еще не завершен' },
    });
    return;
  }

  const exercises = await exercisesRepo.listByLesson(lesson.id);
  const exerciseIds = exercises.map(e => e.id);
  const exerciseWords = await exerciseWordsRepo.listByExercise(exerciseIds[0] ?? '', true)
    .then(async () => await exerciseWordsRepo.listByExercises(exerciseIds, true));

  const correctCount = exerciseWords.filter(ew => ew.result === 'correct').length;
  const typoCount = exerciseWords.filter(ew => ew.result === 'typo').length;
  const incorrectCount = exerciseWords.filter(ew => ew.result === 'incorrect').length;
  const withoutErrors = correctCount + typoCount;

  const newWordsCount = exerciseWords.filter(ew => ew.is_new).length;
  const reviewedCount = exerciseWords.length - newWordsCount;

  // Count suggestions added
  const suggestionsAdded = await suggestionsRepo.countAddedByExerciseIds(exerciseIds);

  // Streak calculation
  const today = getLocalDateString(new Date(), user.timezone);
  const completedDates = await lessonsRepo.completedDatesByUser(user.id);
  const streak = calculateStreak(completedDates, today);

  // extended_today: true if this lesson was the FIRST completed for its completed_local_date
  const allLessons = await (async () => {
    const profiles = await profilesRepo.listByUser(user.id);
    const ids = profiles.map(p => p.id);
    const res = await Promise.all(ids.map(pid => lessonsRepo.listByProfile(pid)));
    return res.flat();
  })();
  const completedOnSameDate = allLessons
    .filter(l => l.status === 'completed' && l.completed_local_date === lesson.completed_local_date)
    .sort((a, b) => new Date(a.completed_at ?? 0).getTime() - new Date(b.completed_at ?? 0).getTime());

  const extendedToday = completedOnSameDate.length > 0 && completedOnSameDate[0].id === lesson.id;

  logger.info('LESSON', `Summary fetched for lesson #${lesson.lesson_number}`, {
    lessonId: lesson.id,
    withoutErrors,
    totalWords: exerciseWords.length,
    streakCurrent: streak.current,
    extendedToday,
  });

  res.json({
    lesson_number: lesson.lesson_number,
    words_total: exerciseWords.length,
    reviewed: reviewedCount,
    new_words: newWordsCount,
    correct: correctCount,
    typo: typoCount,
    incorrect: incorrectCount,
    without_errors: withoutErrors,
    suggestions_added: suggestionsAdded,
    streak: {
      current: streak.current,
      longest: streak.longest,
      today_done: streak.today_done,
      extended_today: extendedToday,
    },
  });
});

// GET /lesson/:id/exercises/:eid/result
router.get('/:id/exercises/:eid/result', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = await lessonsRepo.findById(req.params.id);
  const exercise = await exercisesRepo.findById(req.params.eid);

  if (!lesson || !exercise || exercise.lesson_id !== lesson.id) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  res.json(await buildExerciseResponse(exercise, lesson));
});

// POST /lesson/:id/abandon (Section 6.4)
router.post('/:id/abandon', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = await lessonsRepo.findById(req.params.id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  if (lesson.status === 'abandoned') {
    res.json({ success: true, message: 'Урок уже был закрыт' });
    return;
  }

  if (lesson.status === 'completed') {
    res.status(409).json({
      error: { code: 'lesson_not_active', message: 'Нельзя закрыть завершенный урок' },
    });
    return;
  }

  await lessonsRepo.markAbandoned(lesson.id);

  logger.warn('LESSON', `Lesson #${lesson.lesson_number} abandoned by user`, {
    userId: user.id,
    lessonId: lesson.id,
  });

  await eventsRepo.record(user.id, 'lesson_abandoned', {
    lesson_id: lesson.id,
    lesson_number: lesson.lesson_number,
  });

  res.json({ success: true });
});

// POST /lesson/exercises/:eid/suggestions/:word_id { action: 'add' | 'ignore' } (Section 6.6)
router.post('/exercises/:eid/suggestions/:word_id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { eid, word_id } = req.params;
  const { action } = req.body;

  const exercise = await exercisesRepo.findById(eid);
  if (!exercise) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const lesson = await lessonsRepo.findById(exercise.lesson_id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = await profilesRepo.findByIdAndUser(lesson.language_profile_id, user.id);
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  const suggestion = await suggestionsRepo.findByExerciseAndWord(eid, word_id);
  if (!suggestion) {
    res.status(404).json({
      error: { code: 'suggestion_not_found', message: 'Подсказка не найдена' },
    });
    return;
  }

  const word = await wordsRepo.findById(word_id);
  if (!word) {
    res.status(404).json({
      error: { code: 'word_not_found', message: 'Слово не найдено' },
    });
    return;
  }

  let newState: 'added' | 'ignored' | 'suggested' = suggestion.state;

  if (action === 'add') {
    const existingUw = await userWordsRepo.findByProfileAndWord(profile.id, word_id);

    if (existingUw) {
      if (existingUw.status !== 'active') {
        res.status(409).json({
          error: { code: 'already_in_vocabulary', message: 'Слово уже есть в словаре' },
        });
        return;
      }
    } else {
      await userWordsRepo.create({
        language_profile_id: profile.id,
        word_id,
        status: 'active',
        stage: 0,
        due_lesson_number: lesson.lesson_number + 1,
        source: 'suggestion',
      });

      // Link to exercise contexts with is_target = false
      await exerciseWordsRepo.create({
        exercise_id: eid,
        word_id,
        is_target: false,
        is_new: false,
        surface_form: null,
        stage_before: null,
      });

      await eventsRepo.record(user.id, 'new_word_accepted', { word_id, lemma: word.lemma });
    }

    await suggestionsRepo.setState(suggestion.id, 'added');
    newState = 'added';
    logger.info('LESSON', `Suggestion accepted into vocabulary`, {
      userId: user.id,
      wordId: word.id,
      lemma: word.lemma,
    });
  } else if (action === 'ignore') {
    const existingUw = await userWordsRepo.findByProfileAndWord(profile.id, word_id);

    if (!existingUw) {
      await userWordsRepo.create({
        language_profile_id: profile.id,
        word_id,
        status: 'ignored',
        stage: 0,
        due_lesson_number: null,
        source: 'suggestion',
      });
      await eventsRepo.record(user.id, 'new_word_declined', { word_id, lemma: word.lemma });
    }

    await suggestionsRepo.setState(suggestion.id, 'ignored');
    newState = 'ignored';
    logger.info('LESSON', `Suggestion dismissed`, {
      userId: user.id,
      wordId: word.id,
      lemma: word.lemma,
    });
  }

  res.json({ success: true, state: newState });
});

// POST /lesson/exercises/:eid/report (Section 6.8)
router.post('/exercises/:eid/report', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { eid } = req.params;
  const { reason, comment } = req.body;

  const exercise = await exercisesRepo.findById(eid);
  if (!exercise) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const validReasons = ['bad_sentence', 'wrong_translation', 'grammar_error', 'other'];
  if (!validReasons.includes(reason)) {
    res.status(422).json({
      error: { code: 'invalid_reason', message: 'Некорректная причина жалобы' },
    });
    return;
  }

  // 1 report per exercise & user (upsert)
  await reportsRepo.upsert({
    user_id: user.id,
    exercise_id: eid,
    reason,
    comment: comment ? String(comment).substring(0, 500) : null,
  });

  logger.info('LESSON', `Sentence reported by user`, {
    userId: user.id,
    exerciseId: eid,
    reason,
    comment,
  });

  await eventsRepo.record(user.id, 'report_sent', { exercise_id: eid, reason });

  res.json({ success: true });
});

export default router;
