import { Router, Response } from 'express';
import crypto from 'crypto';
import { db, Word, UserWord } from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { updateSrs } from '../srs.js';
import { generateLessonSentences, evaluateTranslation, TargetWordEvalInput } from '../llm.js';
import { getLocalDateString, getMidnightResetUtc, calculateStreak } from '../streak.js';

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
function computePreview(profileId: string, userId: string, userTimezone: string) {
  const profile = db.tables.user_language_profiles.find(
    p => p.id === profileId && p.user_id === userId
  );
  if (!profile) return { error: 'not_found' };

  // 1. Check in_progress
  const inProgress = db.tables.lessons.find(
    l => l.language_profile_id === profile.id && l.status === 'in_progress'
  );
  if (inProgress) {
    const exercises = db.tables.lesson_exercises.filter(e => e.lesson_id === inProgress.id);
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
  const lessonsToday = db.tables.lessons.filter(
    l => l.language_profile_id === profile.id && l.started_local_date === today
  ).length;

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
  const dueUserWords = db.tables.user_words.filter(
    uw => uw.language_profile_id === profile.id &&
          uw.status === 'active' &&
          uw.due_lesson_number !== null &&
          uw.due_lesson_number <= nextLessonNumber
  );

  const dueRanked = dueUserWords.map(uw => {
    const word = db.tables.words.find(w => w.id === uw.word_id)!;
    const rank = sha256(`${seed}:${uw.word_id}`);
    return { uw, word, rank };
  }).filter(item => Boolean(item.word));

  dueRanked.sort((a, b) => a.rank.localeCompare(b.rank));
  const selectedDue = dueRanked.slice(0, WORDS_PER_LESSON);

  // 5. New words from active dictionary
  const neededNew = WORDS_PER_LESSON - selectedDue.length;
  let selectedNew: Array<{ word: Word; rank: string }> = [];

  if (neededNew > 0) {
    const existingUserWordIds = new Set(
      db.tables.user_words
        .filter(uw => uw.language_profile_id === profile.id)
        .map(uw => uw.word_id)
    );

    const allowedLevels = getLevelsForProfile(profile.level);
    const dict = db.tables.dictionaries.find(d => d.id === profile.dictionary_id);
    const isGeneral = dict ? dict.is_general : true;

    // Get all word IDs in active dictionary
    const dictWordIds = new Set(
      db.tables.dictionary_words
        .filter(dw => dw.dictionary_id === profile.dictionary_id)
        .map(dw => dw.word_id)
    );

    const candidateWords = db.tables.words.filter(w => {
      if (!dictWordIds.has(w.id)) return false;
      if (existingUserWordIds.has(w.id)) return false;
      if (w.target_language !== profile.target_language) return false;
      if (w.native_language !== 'ru') return false;

      // Level check
      if (w.level !== null) {
        return allowedLevels.includes(w.level);
      } else {
        // null level allowed in thematic dictionaries
        return !isGeneral;
      }
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
router.post('/preview', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id } = req.body;

  const profileId = language_profile_id || user.active_language_profile_id;
  if (!profileId) {
    res.status(422).json({
      error: { code: 'missing_profile', message: 'Не указан языковой профиль' },
    });
    return;
  }

  const preview = computePreview(profileId, user.id, user.timezone);
  if (preview.error === 'not_found') {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Профиль не найден или недоступен' },
    });
    return;
  }

  res.json(preview);
});

// POST /lesson/new-word/decline (Algorithm 5.3)
router.post('/new-word/decline', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id, word_id } = req.body;

  const profile = db.tables.user_language_profiles.find(
    p => p.id === language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Профиль не найден' },
    });
    return;
  }

  // Check in_progress
  const inProgress = db.tables.lessons.find(
    l => l.language_profile_id === profile.id && l.status === 'in_progress'
  );
  if (inProgress) {
    res.status(409).json({
      error: { code: 'lesson_in_progress', message: 'Нельзя отклонять слова во время идущего урока' },
    });
    return;
  }

  const word = db.tables.words.find(w => w.id === word_id);
  if (!word) {
    res.status(404).json({
      error: { code: 'word_not_found', message: 'Слово не найдено' },
    });
    return;
  }

  // Check status in user_words
  const existingUserWord = db.tables.user_words.find(
    uw => uw.language_profile_id === profile.id && uw.word_id === word_id
  );

  if (existingUserWord) {
    if (existingUserWord.status === 'active' || existingUserWord.status === 'mastered') {
      res.status(409).json({
        error: { code: 'invalid_status', message: 'Слово уже изучается или выучено' },
      });
      return;
    }
  } else {
    db.tables.user_words.push({
      id: crypto.randomUUID(),
      language_profile_id: profile.id,
      word_id: word.id,
      status: 'ignored',
      stage: 0,
      due_lesson_number: null,
      last_reviewed_at: null,
      source: 'decline',
      created_at: new Date().toISOString(),
    });
    db.save();
    db.recordEvent(user.id, 'new_word_declined', { word_id, lemma: word.lemma });
  }

  const updatedPreview = computePreview(profile.id, user.id, user.timezone);
  res.json(updatedPreview);
});

// POST /lesson/start (Algorithm 5.4)
router.post('/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { language_profile_id, word_ids } = req.body;

  const profile = db.tables.user_language_profiles.find(
    p => p.id === language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Профиль не принадлежит пользователю' },
    });
    return;
  }

  // Check in_progress
  const inProgress = db.tables.lessons.find(
    l => l.language_profile_id === profile.id && l.status === 'in_progress'
  );
  if (inProgress) {
    res.status(409).json({
      error: { code: 'resume_available', message: 'У вас уже есть незавершенный урок' },
    });
    return;
  }

  // Check daily limit
  const today = getLocalDateString(new Date(), user.timezone);
  const lessonsToday = db.tables.lessons.filter(
    l => l.language_profile_id === profile.id && l.started_local_date === today
  ).length;

  if (lessonsToday >= profile.daily_lesson_limit) {
    res.status(409).json({
      error: { code: 'limit_reached', message: 'Дневной лимит уроков исчерпан' },
    });
    return;
  }

  // Advisory lock
  if (!db.tryLockProfile(profile.id)) {
    res.status(409).json({
      error: { code: 'start_in_progress', message: 'Урок уже формируется' },
    });
    return;
  }

  try {
    // Determine words for the lesson
    const wordsList: Word[] = [];
    for (const wid of word_ids) {
      const w = db.tables.words.find(item => item.id === wid);
      if (w) wordsList.push(w);
    }

    if (wordsList.length === 0) {
      db.unlockProfile(profile.id);
      res.status(422).json({
        error: { code: 'empty_words', message: 'Список слов пуст' },
      });
      return;
    }

    const nextLessonNumber = profile.last_lesson_number + 1;
    const N = wordsList.length;

    // Cluster into k = ceil(N / 3) groups
    // Sizes differ by at most 1, smaller groups first.
    // e.g. 5 -> [2, 3], 4 -> [2, 2], 6 -> [3, 3], 1 -> [1]
    const k = Math.ceil(N / 3);
    const groupSizes: number[] = [];
    const baseSize = Math.floor(N / k);
    const remainder = N % k;
    for (let i = 0; i < k; i++) {
      groupSizes.push(baseSize + (i >= k - remainder ? 1 : 0));
    }
    // Sort ascending so smaller groups go first
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

      // Find past sentences avoiding repetition
      const wordIdsInGroup = slice.map(s => s.word.id);
      const pastExercises = db.tables.lesson_exercise_words
        .filter(ew => wordIdsInGroup.includes(ew.word_id))
        .map(ew => ew.exercise_id);

      const avoidSentences = db.tables.lesson_exercises
        .filter(e => pastExercises.includes(e.id))
        .map(e => e.target_sentence)
        .slice(0, 4);

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

    const lessonId = crypto.randomUUID();

    // Call LLM Prompt 1
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

    // Atomic DB persistence
    profile.last_lesson_number = nextLessonNumber;

    const newLesson = {
      id: lessonId,
      language_profile_id: profile.id,
      lesson_number: nextLessonNumber,
      status: 'in_progress' as const,
      words_per_lesson: N,
      started_at: new Date().toISOString(),
      started_local_date: today,
      completed_at: null,
      completed_local_date: null,
      abandoned_at: null,
    };
    db.tables.lessons.push(newLesson);

    // Enter new words into user_words as active, stage 0, due = this lesson
    for (const w of wordsList) {
      let uw = db.tables.user_words.find(
        u => u.language_profile_id === profile.id && u.word_id === w.id
      );
      if (!uw) {
        db.tables.user_words.push({
          id: crypto.randomUUID(),
          language_profile_id: profile.id,
          word_id: w.id,
          status: 'active',
          stage: 0,
          due_lesson_number: nextLessonNumber,
          last_reviewed_at: null,
          source: 'dictionary',
          created_at: new Date().toISOString(),
        });
        db.recordEvent(user.id, 'new_word_accepted', { word_id: w.id, lemma: w.lemma });
      }
    }

    // Insert exercises and words
    const createdExercises = [];
    for (let i = 0; i < generatedGroups.length; i++) {
      const gg = generatedGroups[i];
      const origGroup = promptGroups[i];
      const exerciseId = crypto.randomUUID();

      const exercise = {
        id: exerciseId,
        lesson_id: lessonId,
        order_index: i,
        target_sentence: gg.sentence,
        reference_translation: gg.reference_translation,
        user_translation: null,
        dont_know: false,
        status: 'pending' as const,
        evaluated_at: null,
      };
      db.tables.lesson_exercises.push(exercise);
      createdExercises.push(exercise);

      // Insert words
      for (const wItem of origGroup.words) {
        const foundWordMeta = gg.words.find(gw => gw.lemma.toLowerCase() === wItem.lemma.toLowerCase());
        const surfaceForm = foundWordMeta ? foundWordMeta.surface_form : wItem.lemma;
        const existingUw = db.tables.user_words.find(
          u => u.language_profile_id === profile.id && u.word_id === wItem.wordId
        );
        const stageBefore = existingUw ? existingUw.stage : 0;
        const isNew = existingUw ? existingUw.stage === 0 && existingUw.last_reviewed_at === null : true;

        db.tables.lesson_exercise_words.push({
          id: crypto.randomUUID(),
          exercise_id: exerciseId,
          word_id: wItem.wordId,
          is_target: true,
          is_new: isNew,
          surface_form: surfaceForm,
          result: null,
          user_fragment: null,
          stage_before: stageBefore,
          stage_after: null,
        });
      }
    }

    db.saveSync();
    db.recordEvent(user.id, 'lesson_started', {
      lesson_id: lessonId,
      lesson_number: nextLessonNumber,
      words_count: N,
    });

    const firstExercise = createdExercises[0];

    res.json({
      lesson_id: lessonId,
      lesson_number: nextLessonNumber,
      exercises_total: createdExercises.length,
      current_exercise: {
        exercise_id: firstExercise.id,
        order_index: firstExercise.order_index,
        sentence: firstExercise.target_sentence,
      },
    });
  } catch (err: any) {
    console.error('Error starting lesson:', err);
    res.status(503).json({
      error: { code: 'llm_unavailable', message: 'Сервер временно перегружен, попробуйте еще раз' },
    });
  } finally {
    db.unlockProfile(profile.id);
  }
});

// POST /lesson/evaluate (Algorithm 5.5)
router.post('/evaluate', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { exercise_id, user_translation, dont_know } = req.body;

  const exercise = db.tables.lesson_exercises.find(e => e.id === exercise_id);
  if (!exercise) {
    res.status(404).json({
      error: { code: 'exercise_not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const lesson = db.tables.lessons.find(l => l.id === exercise.lesson_id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'lesson_not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  // Idempotency: if already evaluated, return saved result
  if (exercise.status === 'evaluated') {
    const exerciseWords = db.tables.lesson_exercise_words.filter(
      ew => ew.exercise_id === exercise.id && ew.is_target
    );
    const suggestions = db.tables.lesson_exercise_suggestions.filter(
      s => s.exercise_id === exercise.id
    );

    const pendingLeft = db.tables.lesson_exercises.filter(
      e => e.lesson_id === lesson.id && e.status === 'pending'
    ).length;

    res.json({
      exercise_id: exercise.id,
      target_sentence: exercise.target_sentence,
      reference_translation: exercise.reference_translation,
      user_translation: exercise.user_translation,
      words: exerciseWords.map(ew => {
        const w = db.tables.words.find(item => item.id === ew.word_id)!;
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
        const w = db.tables.words.find(item => item.id === s.word_id);
        return {
          word_id: s.word_id,
          lemma: w ? w.lemma : '',
          pos: w ? w.pos : 'noun',
          translations: w ? w.translations : [],
          state: s.state,
        };
      }),
      lesson_completed: pendingLeft === 0,
    });
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
  const allPending = db.tables.lesson_exercises
    .filter(e => e.lesson_id === lesson.id && e.status === 'pending')
    .sort((a, b) => a.order_index - b.order_index);

  if (allPending.length === 0 || allPending[0].id !== exercise.id) {
    res.status(409).json({
      error: { code: 'not_current_exercise', message: 'Это не текущее упражнение урока' },
    });
    return;
  }

  // Target words for this exercise
  const exerciseWords = db.tables.lesson_exercise_words.filter(
    ew => ew.exercise_id === exercise.id && ew.is_target
  );

  const targetWordsInput: TargetWordEvalInput[] = exerciseWords.map(ew => {
    const w = db.tables.words.find(item => item.id === ew.word_id)!;
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
    // "Не знаю" branch
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
      console.error('LLM evaluation error:', err);
      res.status(503).json({
        error: { code: 'llm_unavailable', message: 'Сервер перегружен, попробуйте ещё раз' },
      });
      return;
    }
  }

  // Update DB transaction
  exercise.user_translation = isDontKnow ? null : (user_translation || '');
  exercise.dont_know = isDontKnow;
  exercise.status = 'evaluated';
  exercise.evaluated_at = new Date().toISOString();

  const formattedWordsResponse = [];

  for (const ew of exerciseWords) {
    const ev = evalResult.evaluations.find(e => e.word_id === ew.word_id) || {
      word_id: ew.word_id,
      result: 'incorrect' as const,
      user_fragment: null,
    };

    ew.result = ev.result;
    ew.user_fragment = ev.user_fragment;

    // SRS Update
    const uw = db.tables.user_words.find(
      u => u.language_profile_id === profile.id && u.word_id === ew.word_id
    );

    if (uw && uw.status === 'active') {
      const srsRes = updateSrs(uw.stage, ev.result, lesson.lesson_number);
      ew.stage_before = uw.stage;
      ew.stage_after = srsRes.newStage;

      uw.stage = srsRes.newStage;
      uw.due_lesson_number = srsRes.dueLessonNumber;
      uw.status = srsRes.status;
      uw.last_reviewed_at = new Date().toISOString();
    }

    const w = db.tables.words.find(item => item.id === ew.word_id)!;
    formattedWordsResponse.push({
      word_id: w.id,
      lemma: w.lemma,
      pos: w.pos,
      surface_form: ew.surface_form,
      result: ew.result,
      user_fragment: ew.user_fragment,
      translations: w.translations,
    });
  }

  // Match suggested words against dictionary
  const allowedSuggestions = [];
  const existingUserWordIds = new Set(
    db.tables.user_words
      .filter(u => u.language_profile_id === profile.id)
      .map(u => u.word_id)
  );

  for (const sw of evalResult.new_suggested_words) {
    const lemmaKey = sw.lemma.trim().normalize('NFC').toLowerCase();
    const matchedWord = db.tables.words.find(
      w => w.target_language === profile.target_language &&
           w.native_language === user.native_language &&
           w.lemma_key === lemmaKey
    );

    if (matchedWord && !existingUserWordIds.has(matchedWord.id)) {
      // Check if already suggested
      const alreadySuggested = db.tables.lesson_exercise_suggestions.some(
        s => s.exercise_id === exercise.id && s.word_id === matchedWord.id
      );
      if (!alreadySuggested) {
        db.tables.lesson_exercise_suggestions.push({
          id: crypto.randomUUID(),
          exercise_id: exercise.id,
          word_id: matchedWord.id,
          state: 'suggested',
        });
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
  const pendingLeft = db.tables.lesson_exercises.filter(
    e => e.lesson_id === lesson.id && e.status === 'pending'
  ).length;

  let lessonCompleted = false;
  if (pendingLeft === 0) {
    lesson.status = 'completed';
    lesson.completed_at = new Date().toISOString();
    lesson.completed_local_date = getLocalDateString(new Date(), user.timezone);
    lessonCompleted = true;

    db.recordEvent(user.id, 'lesson_completed', {
      lesson_id: lesson.id,
      lesson_number: lesson.lesson_number,
    });
  }

  db.saveSync();
  db.recordEvent(user.id, 'exercise_evaluated', {
    exercise_id: exercise.id,
    lesson_id: lesson.id,
    dont_know: isDontKnow,
  });

  res.json({
    exercise_id: exercise.id,
    target_sentence: exercise.target_sentence,
    reference_translation: exercise.reference_translation,
    user_translation: exercise.user_translation,
    words: formattedWordsResponse,
    suggestions: allowedSuggestions,
    lesson_completed: lessonCompleted,
  });
});

// GET /lesson/:id/current (Section 6.4 Resume)
router.get('/:id/current', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = db.tables.lessons.find(l => l.id === req.params.id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  const exercises = db.tables.lesson_exercises
    .filter(e => e.lesson_id === lesson.id)
    .sort((a, b) => a.order_index - b.order_index);

  const doneCount = exercises.filter(e => e.status === 'evaluated').length;
  const currentPending = exercises.find(e => e.status === 'pending');

  if (!currentPending) {
    res.status(409).json({
      error: { code: 'lesson_not_active', message: 'Все упражнения уже завершены' },
    });
    return;
  }

  res.json({
    exercise_id: currentPending.id,
    sentence: currentPending.target_sentence,
    order_index: currentPending.order_index,
    exercises_done: doneCount,
    exercises_total: exercises.length,
  });
});

// GET /lesson/:id/summary (Algorithm 5.6)
router.get('/:id/summary', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = db.tables.lessons.find(l => l.id === req.params.id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
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

  const exercises = db.tables.lesson_exercises.filter(e => e.lesson_id === lesson.id);
  const exerciseIds = new Set(exercises.map(e => e.id));
  const exerciseWords = db.tables.lesson_exercise_words.filter(
    ew => exerciseIds.has(ew.exercise_id) && ew.is_target
  );

  const correctCount = exerciseWords.filter(ew => ew.result === 'correct').length;
  const typoCount = exerciseWords.filter(ew => ew.result === 'typo').length;
  const incorrectCount = exerciseWords.filter(ew => ew.result === 'incorrect').length;
  const withoutErrors = correctCount + typoCount;

  const newWordsCount = exerciseWords.filter(ew => ew.is_new).length;
  const reviewedCount = exerciseWords.length - newWordsCount;

  // Count suggestions added
  const suggestionsAdded = db.tables.lesson_exercise_suggestions.filter(
    s => exerciseIds.has(s.exercise_id) && s.state === 'added'
  ).length;

  // Streak calculation
  const today = getLocalDateString(new Date(), user.timezone);
  const completedLessons = db.tables.lessons.filter(l => {
    const p = db.tables.user_language_profiles.find(lp => lp.id === l.language_profile_id);
    return p && p.user_id === user.id && l.status === 'completed' && l.completed_local_date;
  });

  const completedDates = completedLessons.map(l => l.completed_local_date!);
  const streak = calculateStreak(completedDates, today);

  // extended_today: true if this lesson was the FIRST completed for its completed_local_date
  const lessonsOnSameDate = completedLessons.filter(
    l => l.completed_local_date === lesson.completed_local_date
  ).sort((a, b) => new Date(a.completed_at!).getTime() - new Date(b.completed_at!).getTime());

  const extendedToday = lessonsOnSameDate.length > 0 && lessonsOnSameDate[0].id === lesson.id;

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
router.get('/:id/exercises/:eid/result', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = db.tables.lessons.find(l => l.id === req.params.id);
  const exercise = db.tables.lesson_exercises.find(e => e.id === req.params.eid && e.lesson_id === req.params.id);

  if (!lesson || !exercise) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  const exerciseWords = db.tables.lesson_exercise_words.filter(
    ew => ew.exercise_id === exercise.id && ew.is_target
  );
  const suggestions = db.tables.lesson_exercise_suggestions.filter(
    s => s.exercise_id === exercise.id
  );

  const pendingLeft = db.tables.lesson_exercises.filter(
    e => e.lesson_id === lesson.id && e.status === 'pending'
  ).length;

  res.json({
    exercise_id: exercise.id,
    target_sentence: exercise.target_sentence,
    reference_translation: exercise.reference_translation,
    user_translation: exercise.user_translation,
    words: exerciseWords.map(ew => {
      const w = db.tables.words.find(item => item.id === ew.word_id)!;
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
      const w = db.tables.words.find(item => item.id === s.word_id);
      return {
        word_id: s.word_id,
        lemma: w ? w.lemma : '',
        pos: w ? w.pos : 'noun',
        translations: w ? w.translations : [],
        state: s.state,
      };
    }),
    lesson_completed: pendingLeft === 0,
  });
});

// POST /lesson/:id/abandon (Section 6.4)
router.post('/:id/abandon', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const lesson = db.tables.lessons.find(l => l.id === req.params.id);
  if (!lesson) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Урок не найден' },
    });
    return;
  }

  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
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

  lesson.status = 'abandoned';
  lesson.abandoned_at = new Date().toISOString();
  db.saveSync();

  db.recordEvent(user.id, 'lesson_abandoned', {
    lesson_id: lesson.id,
    lesson_number: lesson.lesson_number,
  });

  res.json({ success: true });
});

// POST /lesson/exercises/:eid/suggestions/:word_id { action: 'add' | 'ignore' } (Section 6.6)
router.post('/exercises/:eid/suggestions/:word_id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { eid, word_id } = req.params;
  const { action } = req.body;

  const exercise = db.tables.lesson_exercises.find(e => e.id === eid);
  if (!exercise) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Упражнение не найдено' },
    });
    return;
  }

  const lesson = db.tables.lessons.find(l => l.id === exercise.lesson_id)!;
  const profile = db.tables.user_language_profiles.find(
    p => p.id === lesson.language_profile_id && p.user_id === user.id
  );
  if (!profile) {
    res.status(403).json({
      error: { code: 'forbidden', message: 'Доступ запрещен' },
    });
    return;
  }

  const suggestion = db.tables.lesson_exercise_suggestions.find(
    s => s.exercise_id === eid && s.word_id === word_id
  );
  if (!suggestion) {
    res.status(404).json({
      error: { code: 'suggestion_not_found', message: 'Подсказка не найдена' },
    });
    return;
  }

  const word = db.tables.words.find(w => w.id === word_id);
  if (!word) {
    res.status(404).json({
      error: { code: 'word_not_found', message: 'Слово не найдено' },
    });
    return;
  }

  if (action === 'add') {
    const existingUw = db.tables.user_words.find(
      u => u.language_profile_id === profile.id && u.word_id === word_id
    );

    if (existingUw) {
      if (existingUw.status !== 'active') {
        res.status(409).json({
          error: { code: 'already_in_vocabulary', message: 'Слово уже есть в словаре' },
        });
        return;
      }
    } else {
      db.tables.user_words.push({
        id: crypto.randomUUID(),
        language_profile_id: profile.id,
        word_id,
        status: 'active',
        stage: 0,
        due_lesson_number: lesson.lesson_number + 1,
        last_reviewed_at: null,
        source: 'suggestion',
        created_at: new Date().toISOString(),
      });

      // Link to exercise contexts with is_target = false
      db.tables.lesson_exercise_words.push({
        id: crypto.randomUUID(),
        exercise_id: eid,
        word_id,
        is_target: false,
        is_new: false,
        surface_form: null,
        result: null,
        user_fragment: null,
        stage_before: null,
        stage_after: null,
      });

      db.recordEvent(user.id, 'new_word_accepted', { word_id, lemma: word.lemma });
    }

    suggestion.state = 'added';
  } else if (action === 'ignore') {
    const existingUw = db.tables.user_words.find(
      u => u.language_profile_id === profile.id && u.word_id === word_id
    );

    if (!existingUw) {
      db.tables.user_words.push({
        id: crypto.randomUUID(),
        language_profile_id: profile.id,
        word_id,
        status: 'ignored',
        stage: 0,
        due_lesson_number: null,
        last_reviewed_at: null,
        source: 'suggestion',
        created_at: new Date().toISOString(),
      });
      db.recordEvent(user.id, 'new_word_declined', { word_id, lemma: word.lemma });
    }

    suggestion.state = 'ignored';
  }

  db.saveSync();
  res.json({ success: true, state: suggestion.state });
});

// POST /lesson/exercises/:eid/report (Section 6.8)
router.post('/exercises/:eid/report', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { eid } = req.params;
  const { reason, comment } = req.body;

  const exercise = db.tables.lesson_exercises.find(e => e.id === eid);
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

  // Check 1 report per exercise & user (update if exists)
  const existingReport = db.tables.sentence_reports.find(
    r => r.user_id === user.id && r.exercise_id === eid
  );

  if (existingReport) {
    existingReport.reason = reason;
    existingReport.comment = comment ? String(comment).substring(0, 500) : null;
    existingReport.created_at = new Date().toISOString();
  } else {
    db.tables.sentence_reports.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      exercise_id: eid,
      reason,
      comment: comment ? String(comment).substring(0, 500) : null,
      status: 'new',
      admin_note: null,
      created_at: new Date().toISOString(),
    });
  }

  db.saveSync();
  db.recordEvent(user.id, 'report_sent', { exercise_id: eid, reason });

  res.json({ success: true });
});

export default router;
