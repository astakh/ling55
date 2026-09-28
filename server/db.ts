/**
 * Слой доступа к данным: PostgreSQL (удалённый сервер).
 * Все операции выполняются SQL-запросами через пул соединений (server/pg.ts).
 * Интерфейсы строк соответствуют схеме scripts/sql/01_schema.sql.
 */
import crypto from 'crypto';
import { query, queryOne, exec, withTransaction } from './pg.js';

// ----------------------------------------------------------------------------
// Типы строк (camelCase не используется — как в колонках БД)
// ----------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  password_hash: string;
  native_language: string;
  timezone: string;
  timezone_changed_at: string | null;
  is_onboarded: boolean;
  is_admin: boolean;
  active_language_profile_id: string | null;
  created_at: string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

export interface Language {
  code: string;
  name: string;
  is_supported: boolean;
}

export interface Dictionary {
  id: string;
  code: string;
  name: string;
  description: string;
  target_language: string;
  native_language: string;
  is_general: boolean;
}

export interface Word {
  id: string;
  target_language: string;
  native_language: string;
  lemma: string;
  lemma_key: string;
  pos: string;
  level: string | null;
  translations: string[];
}

export interface UserLanguageProfile {
  id: string;
  user_id: string;
  target_language: string;
  level: string;
  dictionary_id: string;
  daily_lesson_limit: number;
  last_lesson_number: number;
  created_at: string;
}

export interface UserWord {
  id: string;
  language_profile_id: string;
  word_id: string;
  status: 'active' | 'mastered' | 'ignored';
  stage: number;
  due_lesson_number: number | null;
  last_reviewed_at: string | null;
  source: 'dictionary' | 'suggestion' | 'decline';
  created_at: string;
}

export interface Lesson {
  id: string;
  language_profile_id: string;
  lesson_number: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  words_per_lesson: number;
  started_at: string;
  started_local_date: string;
  completed_at: string | null;
  completed_local_date: string | null;
  abandoned_at: string | null;
}

export interface LessonExercise {
  id: string;
  lesson_id: string;
  order_index: number;
  target_sentence: string;
  reference_translation: string;
  user_translation: string | null;
  dont_know: boolean;
  status: 'pending' | 'evaluated';
  evaluated_at: string | null;
}

export interface LessonExerciseWord {
  id: string;
  exercise_id: string;
  word_id: string;
  is_target: boolean;
  is_new: boolean;
  surface_form: string | null;
  result: 'correct' | 'typo' | 'incorrect' | null;
  user_fragment: string | null;
  stage_before: number | null;
  stage_after: number | null;
}

export interface LessonExerciseSuggestion {
  id: string;
  exercise_id: string;
  word_id: string;
  state: 'suggested' | 'added' | 'ignored';
}

export interface SentenceReport {
  id: string;
  user_id: string;
  exercise_id: string;
  reason: 'bad_sentence' | 'wrong_translation' | 'grammar_error' | 'other';
  comment: string | null;
  status: 'new' | 'processed';
  admin_note: string | null;
  created_at: string;
}

export interface EventLog {
  id: string;
  user_id: string;
  type: string;
  payload: any;
  created_at: string;
}

export interface DictionaryImport {
  id: string;
  admin_id: string;
  file_name: string;
  sha256: string;
  dictionary_id: string;
  counters: { added: number; linked: number; skipped: number; errors: number };
  dry_run: boolean;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

export const usersRepo = {
  findByEmail(email: string): Promise<User | null> {
    return queryOne<User>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  },
  findById(id: string): Promise<User | null> {
    return queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
  },
  count(): Promise<number> {
    return queryOne<{ c: string }>('SELECT COUNT(*)::text AS c FROM users').then(r => Number(r?.c ?? 0));
  },
  create(u: Omit<User, 'id' | 'created_at'> & { id?: string }): Promise<User> {
    return queryOne<User>(
      `INSERT INTO users (id, email, password_hash, native_language, timezone, timezone_changed_at,
                          is_onboarded, is_admin, active_language_profile_id)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        u.id ?? null, u.email, u.password_hash, u.native_language, u.timezone,
        u.timezone_changed_at, u.is_onboarded, u.is_admin, u.active_language_profile_id,
      ]
    ).then(r => r!);
  },
  update(id: string, patch: Partial<Omit<User, 'id' | 'email'>>): Promise<User | null> {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'email') continue;
      cols.push(`${k} = $${vals.length + 1}`);
      vals.push(v);
    }
    if (cols.length === 0) return this.findById(id);
    vals.push(id);
    return queryOne<User>(`UPDATE users SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  },
  setActiveProfile(id: string, profileId: string | null): Promise<User | null> {
    return queryOne<User>(
      'UPDATE users SET active_language_profile_id = $2 WHERE id = $1 RETURNING *',
      [id, profileId]
    );
  },
  listAll(q?: string): Promise<User[]> {
    if (q) {
      return query<User>(
        'SELECT * FROM users WHERE LOWER(email) LIKE $1 ORDER BY created_at DESC',
        [`%${q.toLowerCase()}%`]
      );
    }
    return query<User>('SELECT * FROM users ORDER BY created_at DESC');
  },
};

// ----------------------------------------------------------------------------
// Refresh tokens
// ----------------------------------------------------------------------------

export const refreshTokensRepo = {
  create(userId: string, familyId: string, tokenHash: string, expiresAt: string): Promise<RefreshToken> {
    return queryOne<RefreshToken>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, familyId, tokenHash, expiresAt]
    ).then(r => r!);
  },
  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return queryOne<RefreshToken>('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  },
  revokeFamily(familyId: string): Promise<number> {
    return exec('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);
  },
  revokeByHash(tokenHash: string): Promise<number> {
    return exec('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  },
  markReplaced(oldHash: string, newHash: string): Promise<number> {
    return exec(
      'UPDATE refresh_tokens SET replaced_by = $2, revoked_at = now() WHERE token_hash = $1',
      [oldHash, newHash]
    );
  },
  revokeAllForUser(userId: string): Promise<number> {
    return exec('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  },
};

// ----------------------------------------------------------------------------
// Languages / dictionaries / words
// ----------------------------------------------------------------------------

export const languagesRepo = {
  all(): Promise<Language[]> {
    return query<Language>('SELECT * FROM languages ORDER BY code');
  },
  findByCode(code: string): Promise<Language | null> {
    return queryOne<Language>('SELECT * FROM languages WHERE code = $1', [code]);
  },
};

export const dictionariesRepo = {
  all(): Promise<Dictionary[]> {
    return query<Dictionary>('SELECT * FROM dictionaries ORDER BY name');
  },
  findById(id: string): Promise<Dictionary | null> {
    return queryOne<Dictionary>('SELECT * FROM dictionaries WHERE id = $1', [id]);
  },
  findByCode(code: string): Promise<Dictionary | null> {
    return queryOne<Dictionary>('SELECT * FROM dictionaries WHERE code = $1', [code]);
  },
  findGeneralPair(native: string, target: string): Promise<Dictionary | null> {
    return queryOne<Dictionary>(
      'SELECT * FROM dictionaries WHERE native_language = $1 AND target_language = $2 AND is_general LIMIT 1',
      [native, target]
    );
  },
  findPair(target: string, native: string): Promise<Dictionary[]> {
    return query<Dictionary>(
      'SELECT * FROM dictionaries WHERE target_language = $1 AND native_language = $2 ORDER BY is_general DESC, name',
      [target, native]
    );
  },
  findPairById(id: string, target: string, native: string): Promise<Dictionary | null> {
    return queryOne<Dictionary>(
      'SELECT * FROM dictionaries WHERE id = $1 AND target_language = $2 AND native_language = $3',
      [id, target, native]
    );
  },
  create(d: Omit<Dictionary, 'id'>): Promise<Dictionary> {
    return queryOne<Dictionary>(
      `INSERT INTO dictionaries (code, name, description, target_language, native_language, is_general)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [d.code, d.name, d.description, d.target_language, d.native_language, d.is_general]
    ).then(r => r!);
  },
  wordCount(dictionaryId: string): Promise<number> {
    return queryOne<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM dictionary_words WHERE dictionary_id = $1',
      [dictionaryId]
    ).then(r => Number(r?.c ?? 0));
  },
  wordIds(dictionaryId: string): Promise<string[]> {
    return query<{ word_id: string }>(
      'SELECT word_id FROM dictionary_words WHERE dictionary_id = $1',
      [dictionaryId]
    ).then(rows => rows.map(r => r.word_id));
  },
  linkWord(dictionaryId: string, wordId: string): Promise<number> {
    return exec(
      'INSERT INTO dictionary_words (dictionary_id, word_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [dictionaryId, wordId]
    );
  },
  isWordLinked(dictionaryId: string, wordId: string): Promise<boolean> {
    return queryOne<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM dictionary_words WHERE dictionary_id = $1 AND word_id = $2) AS exists',
      [dictionaryId, wordId]
    ).then(r => Boolean(r?.exists));
  },
};

export const wordsRepo = {
  findById(id: string): Promise<Word | null> {
    return queryOne<Word>('SELECT * FROM words WHERE id = $1', [id]);
  },
  findByIds(ids: string[]): Promise<Word[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return query<Word>('SELECT * FROM words WHERE id = ANY($1::uuid[])', [ids]);
  },
  findByLemmaKey(target: string, native: string, lemmaKey: string, pos?: string): Promise<Word | null> {
    if (pos) {
      return queryOne<Word>(
        'SELECT * FROM words WHERE target_language = $1 AND native_language = $2 AND lemma_key = $3 AND pos = $4 LIMIT 1',
        [target, native, lemmaKey, pos]
      );
    }
    return queryOne<Word>(
      'SELECT * FROM words WHERE target_language = $1 AND native_language = $2 AND lemma_key = $3 LIMIT 1',
      [target, native, lemmaKey]
    );
  },
  create(w: Omit<Word, 'id'>): Promise<Word> {
    return queryOne<Word>(
      `INSERT INTO words (target_language, native_language, lemma, lemma_key, pos, level, translations)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
      [w.target_language, w.native_language, w.lemma, w.lemma_key, w.pos, w.level, JSON.stringify(w.translations)]
    ).then(r => r!);
  },
  /** Кандидаты новых слов из словаря профиля (Alg 5.2 шаг 5). */
  candidatesFromDictionary(params: {
    dictionaryId: string;
    excludeWordIds: string[];
    targetLanguage: string;
    nativeLanguage: string;
    allowedLevels: string[];
    isGeneral: boolean;
  }): Promise<Word[]> {
    return query<Word>(
      `SELECT w.* FROM words w
         JOIN dictionary_words dw ON dw.word_id = w.id
        WHERE dw.dictionary_id = $1
          AND NOT (w.id = ANY($2::uuid[]))
          AND w.target_language = $3
          AND w.native_language = $4
          AND (
            (w.level IS NOT NULL AND w.level = ANY($5::text[]))
            OR (w.level IS NULL AND $6 = FALSE)
          )`,
      [
        params.dictionaryId,
        params.excludeWordIds,
        params.targetLanguage,
        params.nativeLanguage,
        params.allowedLevels,
        params.isGeneral,
      ]
    );
  },
};

// ----------------------------------------------------------------------------
// User language profiles
// ----------------------------------------------------------------------------

export const profilesRepo = {
  findById(id: string): Promise<UserLanguageProfile | null> {
    return queryOne<UserLanguageProfile>('SELECT * FROM user_language_profiles WHERE id = $1', [id]);
  },
  findByIdAndUser(id: string, userId: string): Promise<UserLanguageProfile | null> {
    return queryOne<UserLanguageProfile>(
      'SELECT * FROM user_language_profiles WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
  },
  listByUser(userId: string): Promise<UserLanguageProfile[]> {
    return query<UserLanguageProfile>(
      'SELECT * FROM user_language_profiles WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );
  },
  findByUserAndTarget(userId: string, target: string): Promise<UserLanguageProfile | null> {
    return queryOne<UserLanguageProfile>(
      'SELECT * FROM user_language_profiles WHERE user_id = $1 AND target_language = $2',
      [userId, target]
    );
  },
  create(p: Omit<UserLanguageProfile, 'id' | 'created_at'>): Promise<UserLanguageProfile> {
    return queryOne<UserLanguageProfile>(
      `INSERT INTO user_language_profiles
         (user_id, target_language, level, dictionary_id, daily_lesson_limit, last_lesson_number)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [p.user_id, p.target_language, p.level, p.dictionary_id, p.daily_lesson_limit, p.last_lesson_number]
    ).then(r => r!);
  },
  update(id: string, patch: Partial<Pick<UserLanguageProfile, 'level' | 'dictionary_id' | 'daily_lesson_limit' | 'last_lesson_number'>>): Promise<UserLanguageProfile | null> {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = $${vals.length + 1}`);
      vals.push(v);
    }
    if (cols.length === 0) return this.findById(id);
    vals.push(id);
    return queryOne<UserLanguageProfile>(
      `UPDATE user_language_profiles SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
  },
};

// ----------------------------------------------------------------------------
// User words (SRS state)
// ----------------------------------------------------------------------------

export const userWordsRepo = {
  findByProfileAndWord(profileId: string, wordId: string): Promise<UserWord | null> {
    return queryOne<UserWord>(
      'SELECT * FROM user_words WHERE language_profile_id = $1 AND word_id = $2',
      [profileId, wordId]
    );
  },
  listByProfile(profileId: string, status?: string): Promise<UserWord[]> {
    if (status) {
      return query<UserWord>(
        'SELECT * FROM user_words WHERE language_profile_id = $1 AND status = $2',
        [profileId, status]
      );
    }
    return query<UserWord>('SELECT * FROM user_words WHERE language_profile_id = $1', [profileId]);
  },
  wordIdsByProfile(profileId: string): Promise<string[]> {
    return query<{ word_id: string }>(
      'SELECT word_id FROM user_words WHERE language_profile_id = $1',
      [profileId]
    ).then(rows => rows.map(r => r.word_id));
  },
  dueWords(profileId: string, upToLessonNumber: number): Promise<UserWord[]> {
    return query<UserWord>(
      `SELECT * FROM user_words
        WHERE language_profile_id = $1 AND status = 'active'
          AND due_lesson_number IS NOT NULL AND due_lesson_number <= $2`,
      [profileId, upToLessonNumber]
    );
  },
  statusCounts(profileId: string): Promise<{ active: number; mastered: number; ignored: number }> {
    return queryOne<{ active: string; mastered: string; ignored: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::text   AS active,
         COUNT(*) FILTER (WHERE status = 'mastered')::text AS mastered,
         COUNT(*) FILTER (WHERE status = 'ignored')::text  AS ignored
       FROM user_words WHERE language_profile_id = $1`,
      [profileId]
    ).then(r => ({
      active: Number(r?.active ?? 0),
      mastered: Number(r?.mastered ?? 0),
      ignored: Number(r?.ignored ?? 0),
    }));
  },
  create(uw: {
    language_profile_id: string;
    word_id: string;
    status: UserWord['status'];
    stage: number;
    due_lesson_number: number | null;
    source: UserWord['source'];
  }): Promise<UserWord | null> {
    return queryOne<UserWord>(
      `INSERT INTO user_words (language_profile_id, word_id, status, stage, due_lesson_number, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (language_profile_id, word_id) DO NOTHING
       RETURNING *`,
      [uw.language_profile_id, uw.word_id, uw.status, uw.stage, uw.due_lesson_number, uw.source]
    );
  },
  updateSrs(id: string, patch: {
    status?: UserWord['status'];
    stage?: number;
    due_lesson_number?: number | null;
    last_reviewed_at?: string | null;
  }): Promise<UserWord | null> {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = $${vals.length + 1}`);
      vals.push(v);
    }
    if (cols.length === 0) return queryOne<UserWord>('SELECT * FROM user_words WHERE id = $1', [id]);
    vals.push(id);
    return queryOne<UserWord>(
      `UPDATE user_words SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
  },
};

// ----------------------------------------------------------------------------
// Lessons
// ----------------------------------------------------------------------------

export const lessonsRepo = {
  findById(id: string): Promise<Lesson | null> {
    return queryOne<Lesson>('SELECT * FROM lessons WHERE id = $1', [id]);
  },
  findInProgress(profileId: string): Promise<Lesson | null> {
    return queryOne<Lesson>(
      `SELECT * FROM lessons WHERE language_profile_id = $1 AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
      [profileId]
    );
  },
  listByProfile(profileId: string): Promise<Lesson[]> {
    return query<Lesson>(
      'SELECT * FROM lessons WHERE language_profile_id = $1 ORDER BY lesson_number',
      [profileId]
    );
  },
  countStartedToday(profileId: string, localDate: string): Promise<number> {
    return queryOne<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM lessons WHERE language_profile_id = $1 AND started_local_date = $2',
      [profileId, localDate]
    ).then(r => Number(r?.c ?? 0));
  },
  /** Даты завершения уроков (локальные) по всем профилям пользователя. */
  completedDatesByUser(userId: string): Promise<string[]> {
    return query<{ completed_local_date: string }>(
      `SELECT l.completed_local_date FROM lessons l
         JOIN user_language_profiles p ON p.id = l.language_profile_id
        WHERE p.user_id = $1 AND l.status = 'completed' AND l.completed_local_date IS NOT NULL`,
      [userId]
    ).then(rows => rows.map(r => r.completed_local_date));
  },
  create(l: {
    id?: string;
    language_profile_id: string;
    lesson_number: number;
    words_per_lesson: number;
    started_local_date: string;
  }): Promise<Lesson> {
    return queryOne<Lesson>(
      `INSERT INTO lessons (id, language_profile_id, lesson_number, status, words_per_lesson, started_local_date)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, 'in_progress', $4, $5) RETURNING *`,
      [l.id ?? null, l.language_profile_id, l.lesson_number, l.words_per_lesson, l.started_local_date]
    ).then(r => r!);
  },
  markCompleted(id: string, completedLocalDate: string): Promise<number> {
    return exec(
      `UPDATE lessons SET status = 'completed', completed_at = now(), completed_local_date = $2
       WHERE id = $1 AND status = 'in_progress'`,
      [id, completedLocalDate]
    );
  },
  markAbandoned(id: string): Promise<number> {
    return exec(
      `UPDATE lessons SET status = 'abandoned', abandoned_at = now()
       WHERE id = $1 AND status = 'in_progress'`,
      [id]
    );
  },
};

// ----------------------------------------------------------------------------
// Lesson exercises
// ----------------------------------------------------------------------------

export const exercisesRepo = {
  findById(id: string): Promise<LessonExercise | null> {
    return queryOne<LessonExercise>('SELECT * FROM lesson_exercises WHERE id = $1', [id]);
  },
  listByLesson(lessonId: string): Promise<LessonExercise[]> {
    return query<LessonExercise>(
      'SELECT * FROM lesson_exercises WHERE lesson_id = $1 ORDER BY order_index',
      [lessonId]
    );
  },
  firstPending(lessonId: string): Promise<LessonExercise | null> {
    return queryOne<LessonExercise>(
      `SELECT * FROM lesson_exercises WHERE lesson_id = $1 AND status = 'pending'
       ORDER BY order_index LIMIT 1`,
      [lessonId]
    );
  },
  listByLessons(lessonIds: string[]): Promise<LessonExercise[]> {
    if (lessonIds.length === 0) return Promise.resolve([]);
    return query<LessonExercise>(
      'SELECT * FROM lesson_exercises WHERE lesson_id = ANY($1::uuid[]) ORDER BY order_index',
      [lessonIds]
    );
  },
  countPending(lessonId: string): Promise<number> {
    return queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM lesson_exercises WHERE lesson_id = $1 AND status = 'pending'`,
      [lessonId]
    ).then(r => Number(r?.c ?? 0));
  },
  countEvaluatedByLesson(lessonId: string): Promise<{ done: number; total: number }> {
    return queryOne<{ done: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'evaluated')::text AS done,
              COUNT(*)::text AS total
       FROM lesson_exercises WHERE lesson_id = $1`,
      [lessonId]
    ).then(r => ({ done: Number(r?.done ?? 0), total: Number(r?.total ?? 0) }));
  },
  create(e: {
    id?: string;
    lesson_id: string;
    order_index: number;
    target_sentence: string;
    reference_translation: string;
  }): Promise<LessonExercise> {
    return queryOne<LessonExercise>(
      `INSERT INTO lesson_exercises (id, lesson_id, order_index, target_sentence, reference_translation)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5) RETURNING *`,
      [e.id ?? null, e.lesson_id, e.order_index, e.target_sentence, e.reference_translation]
    ).then(r => r!);
  },
  markEvaluated(id: string, userTranslation: string | null, dontKnow: boolean): Promise<LessonExercise | null> {
    return queryOne<LessonExercise>(
      `UPDATE lesson_exercises
       SET user_translation = $2, dont_know = $3, status = 'evaluated', evaluated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, userTranslation, dontKnow]
    );
  },
  /** Предыдущие предложения, содержащие данные слова (для avoid_sentences). */
  pastSentencesForWords(wordIds: string[], limit = 4): Promise<string[]> {
    return query<{ target_sentence: string }>(
      `SELECT DISTINCT e.target_sentence FROM lesson_exercises e
         JOIN lesson_exercise_words ew ON ew.exercise_id = e.id
        WHERE ew.word_id = ANY($1::uuid[])
        LIMIT $2`,
      [wordIds, limit]
    ).then(rows => rows.map(r => r.target_sentence));
  },
};

// ----------------------------------------------------------------------------
// Lesson exercise words
// ----------------------------------------------------------------------------

export const exerciseWordsRepo = {
  listByExercise(exerciseId: string, targetsOnly = false): Promise<LessonExerciseWord[]> {
    if (targetsOnly) {
      return query<LessonExerciseWord>(
        'SELECT * FROM lesson_exercise_words WHERE exercise_id = $1 AND is_target',
        [exerciseId]
      );
    }
    return query<LessonExerciseWord>('SELECT * FROM lesson_exercise_words WHERE exercise_id = $1', [exerciseId]);
  },
  listByExercises(exerciseIds: string[], targetsOnly = false): Promise<LessonExerciseWord[]> {
    if (exerciseIds.length === 0) return Promise.resolve([]);
    const sql = targetsOnly
      ? 'SELECT * FROM lesson_exercise_words WHERE exercise_id = ANY($1::uuid[]) AND is_target'
      : 'SELECT * FROM lesson_exercise_words WHERE exercise_id = ANY($1::uuid[])';
    return query<LessonExerciseWord>(sql, [exerciseIds]);
  },
  create(ew: {
    exercise_id: string;
    word_id: string;
    is_target: boolean;
    is_new: boolean;
    surface_form: string | null;
    stage_before: number | null;
  }): Promise<LessonExerciseWord> {
    return queryOne<LessonExerciseWord>(
      `INSERT INTO lesson_exercise_words
         (exercise_id, word_id, is_target, is_new, surface_form, stage_before)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ew.exercise_id, ew.word_id, ew.is_target, ew.is_new, ew.surface_form, ew.stage_before]
    ).then(r => r!);
  },
  setResult(id: string, patch: {
    result: 'correct' | 'typo' | 'incorrect' | null;
    user_fragment: string | null;
    stage_before: number | null;
    stage_after: number | null;
  }): Promise<number> {
    return exec(
      `UPDATE lesson_exercise_words
       SET result = $2, user_fragment = $3, stage_before = $4, stage_after = $5
       WHERE id = $1`,
      [id, patch.result, patch.user_fragment, patch.stage_before, patch.stage_after]
    );
  },
  /** История употреблений слова (последние N, для карточки слова). */
  recentByWord(wordId: string, limit = 20): Promise<Array<LessonExerciseWord & {
    target_sentence: string; reference_translation: string; started_at: string | null; evaluated_at: string | null;
  }>> {
    return query(
      `SELECT ew.*, e.target_sentence, e.reference_translation, e.evaluated_at, l.started_at
       FROM lesson_exercise_words ew
       JOIN lesson_exercises e ON e.id = ew.exercise_id
       LEFT JOIN lessons l ON l.id = e.lesson_id
       WHERE ew.word_id = $1
       ORDER BY COALESCE(l.started_at, e.evaluated_at) DESC NULLS LAST
       LIMIT $2`,
      [wordId, limit]
    );
  },
  /** Точность по урокам: количество target-слов с результатами и без ошибок. */
  accuracyStatsByLessonIds(lessonIds: string[], sinceIso?: string): Promise<{ total: number; correct: number }> {
    return queryOne<{ total: string; correct: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE ew.result IN ('correct','typo'))::text AS correct
       FROM lesson_exercise_words ew
       JOIN lesson_exercises e ON e.id = ew.exercise_id
       WHERE ew.is_target AND ew.result IS NOT NULL
         AND ew.exercise_id IN (SELECT id FROM lesson_exercises WHERE lesson_id = ANY($1::uuid[]))
         AND ($2::timestamptz IS NULL OR e.evaluated_at >= $2::timestamptz)`,
      [lessonIds, sinceIso ?? null]
    ).then(r => ({ total: Number(r?.total ?? 0), correct: Number(r?.correct ?? 0) }));
  },
};

// ----------------------------------------------------------------------------
// Suggestions
// ----------------------------------------------------------------------------

export const suggestionsRepo = {
  listByExercise(exerciseId: string): Promise<LessonExerciseSuggestion[]> {
    return query<LessonExerciseSuggestion>(
      'SELECT * FROM lesson_exercise_suggestions WHERE exercise_id = $1',
      [exerciseId]
    );
  },
  listByExercises(exerciseIds: string[]): Promise<LessonExerciseSuggestion[]> {
    if (exerciseIds.length === 0) return Promise.resolve([]);
    return query<LessonExerciseSuggestion>(
      'SELECT * FROM lesson_exercise_suggestions WHERE exercise_id = ANY($1::uuid[])',
      [exerciseIds]
    );
  },
  create(exerciseId: string, wordId: string): Promise<LessonExerciseSuggestion | null> {
    return queryOne<LessonExerciseSuggestion>(
      `INSERT INTO lesson_exercise_suggestions (exercise_id, word_id, state)
       VALUES ($1, $2, 'suggested')
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [exerciseId, wordId]
    );
  },
  findByExerciseAndWord(exerciseId: string, wordId: string): Promise<LessonExerciseSuggestion | null> {
    return queryOne<LessonExerciseSuggestion>(
      'SELECT * FROM lesson_exercise_suggestions WHERE exercise_id = $1 AND word_id = $2',
      [exerciseId, wordId]
    );
  },
  setState(id: string, state: LessonExerciseSuggestion['state']): Promise<number> {
    return exec('UPDATE lesson_exercise_suggestions SET state = $2 WHERE id = $1', [id, state]);
  },
  countAddedByExerciseIds(exerciseIds: string[]): Promise<number> {
    return queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM lesson_exercise_suggestions
       WHERE state = 'added' AND exercise_id = ANY($1::uuid[])`,
      [exerciseIds]
    ).then(r => Number(r?.c ?? 0));
  },
};

// ----------------------------------------------------------------------------
// Sentence reports
// ----------------------------------------------------------------------------

export const reportsRepo = {
  list(status?: string): Promise<SentenceReport[]> {
    if (status) {
      return query<SentenceReport>(
        'SELECT * FROM sentence_reports WHERE status = $1 ORDER BY created_at DESC',
        [status]
      );
    }
    return query<SentenceReport>('SELECT * FROM sentence_reports ORDER BY created_at DESC');
  },
  findById(id: string): Promise<SentenceReport | null> {
    return queryOne<SentenceReport>('SELECT * FROM sentence_reports WHERE id = $1', [id]);
  },
  findByUserAndExercise(userId: string, exerciseId: string): Promise<SentenceReport | null> {
    return queryOne<SentenceReport>(
      'SELECT * FROM sentence_reports WHERE user_id = $1 AND exercise_id = $2',
      [userId, exerciseId]
    );
  },
  upsert(report: { user_id: string; exercise_id: string; reason: string; comment: string | null }): Promise<SentenceReport> {
    return queryOne<SentenceReport>(
      `INSERT INTO sentence_reports (user_id, exercise_id, reason, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, exercise_id)
       DO UPDATE SET reason = EXCLUDED.reason, comment = EXCLUDED.comment, created_at = now()
       RETURNING *`,
      [report.user_id, report.exercise_id, report.reason, report.comment]
    ).then(r => r!);
  },
  update(id: string, patch: { status?: string; admin_note?: string | null }): Promise<SentenceReport | null> {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = $${vals.length + 1}`);
      vals.push(v);
    }
    if (cols.length === 0) return this.findById(id);
    vals.push(id);
    return queryOne<SentenceReport>(
      `UPDATE sentence_reports SET ${cols.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
  },
};

// ----------------------------------------------------------------------------
// LLM calls / events / imports
// ----------------------------------------------------------------------------

export const llmCallsRepo = {
  record(call: {
    purpose: 'generate' | 'evaluate';
    user_id: string | null;
    language_profile_id: string | null;
    lesson_id: string | null;
    exercise_id: string | null;
    attempt: number;
    request: any;
    response: any;
    status: string;
    http_status: number | null;
    latency_ms: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  }): Promise<void> {
    return query(
      `INSERT INTO llm_calls
         (purpose, user_id, language_profile_id, lesson_id, exercise_id, attempt,
          request, response, status, http_status, latency_ms, prompt_tokens, completion_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)`,
      [
        call.purpose, call.user_id, call.language_profile_id, call.lesson_id, call.exercise_id,
        call.attempt, JSON.stringify(call.request ?? null), JSON.stringify(call.response ?? null),
        call.status, call.http_status, call.latency_ms,
        call.prompt_tokens ?? null, call.completion_tokens ?? null,
      ]
    ).then(() => undefined).catch(err => { console.error('Failed to record llm_call:', err.message); });
  },
};

export const eventsRepo = {
  record(userId: string, type: string, payload: any = {}): Promise<void> {
    return query(
      'INSERT INTO events (user_id, type, payload) VALUES ($1, $2, $3::jsonb)',
      [userId, type, JSON.stringify(payload ?? {})]
    ).then(() => undefined).catch(err => { console.error('Failed to record event:', err.message); });
  },
};

export const importsRepo = {
  record(imp: {
    admin_id: string;
    file_name: string;
    sha256: string;
    dictionary_id: string;
    counters: DictionaryImport['counters'];
    dry_run: boolean;
  }): Promise<void> {
    return query(
      `INSERT INTO dictionary_imports (admin_id, file_name, sha256, dictionary_id, counters, dry_run)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [imp.admin_id, imp.file_name, imp.sha256, imp.dictionary_id, JSON.stringify(imp.counters), imp.dry_run]
    ).then(() => undefined).catch(err => { console.error('Failed to record dictionary import:', err.message); });
  },
};

export const userWordsRepoExt = {
  /** Активные слова профиля с id слов (для preview). */
  dueWithWords(profileId: string, upToLessonNumber: number): Promise<Array<UserWord & { word: Word }>> {
    return query<UserWord & { word: Word }>(
      `SELECT uw.*, to_jsonb(w.*) AS word FROM user_words uw
         JOIN words w ON w.id = uw.word_id
        WHERE uw.language_profile_id = $1 AND uw.status = 'active'
          AND uw.due_lesson_number IS NOT NULL AND uw.due_lesson_number <= $2`,
      [profileId, upToLessonNumber]
    );
  },
};

// ----------------------------------------------------------------------------
// Совместимость: утилиты, использовавшиеся в JSON-слое
// ----------------------------------------------------------------------------

export function uuid(): string {
  return crypto.randomUUID();
}

export { nowIso };

/** Инициализация/проверка доступности БД при старте сервера. */
export async function initDatabase(): Promise<void> {
  const row = await queryOne<{ c: string }>(
    "SELECT COUNT(*)::text AS c FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const tables = Number(row?.c ?? 0);
  if (tables < 16) {
    throw new Error(
      `Похоже, схема БД не установлена (таблиц: ${tables}). Выполните scripts/sql/create_database.sql и scripts/sql/01_schema.sql.`
    );
  }
}
