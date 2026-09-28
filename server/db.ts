import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
  level: string | null; // A1, A2, B1, B2, C1, C2
  translations: string[];
}

export interface DictionaryWord {
  dictionary_id: string;
  word_id: string;
}

export interface UserLanguageProfile {
  id: string;
  user_id: string;
  target_language: string;
  level: string; // A1, A2, B1, B2
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

export interface LlmCall {
  id: string;
  purpose: 'generate' | 'evaluate';
  user_id: string | null;
  language_profile_id: string | null;
  lesson_id: string | null;
  exercise_id: string | null;
  attempt: number;
  request: any;
  response: any;
  status: 'ok' | 'http_error' | 'timeout' | 'invalid_json' | 'invalid_schema' | 'validation_failed';
  http_status: number | null;
  latency_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
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
  counters: {
    added: number;
    linked: number;
    skipped: number;
    errors: number;
  };
  dry_run: boolean;
  created_at: string;
}

export interface DatabaseSchema {
  users: User[];
  refresh_tokens: RefreshToken[];
  languages: Language[];
  dictionaries: Dictionary[];
  words: Word[];
  dictionary_words: DictionaryWord[];
  user_language_profiles: UserLanguageProfile[];
  user_words: UserWord[];
  lessons: Lesson[];
  lesson_exercises: LessonExercise[];
  lesson_exercise_words: LessonExerciseWord[];
  lesson_exercise_suggestions: LessonExerciseSuggestion[];
  sentence_reports: SentenceReport[];
  llm_calls: LlmCall[];
  events: EventLog[];
  dictionary_imports: DictionaryImport[];
}

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// In-memory locks for profile lesson generation (pg_try_advisory_lock emulation)
const profileLocks = new Set<string>();

export class Database {
  private data: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = this.load();
    this.seedIfNeeded();
  }

  private load(): DatabaseSchema {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        console.error('Error loading db.json, creating new database', e);
      }
    }
    return {
      users: [],
      refresh_tokens: [],
      languages: [],
      dictionaries: [],
      words: [],
      dictionary_words: [],
      user_language_profiles: [],
      user_words: [],
      lessons: [],
      lesson_exercises: [],
      lesson_exercise_words: [],
      lesson_exercise_suggestions: [],
      sentence_reports: [],
      llm_calls: [],
      events: [],
      dictionary_imports: [],
    };
  }

  public save() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      try {
        if (!fs.existsSync(DB_DIR)) {
          fs.mkdirSync(DB_DIR, { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to save db.json', err);
      }
    }, 50);
  }

  public saveSync() {
    try {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save db.json synchronously', err);
    }
  }

  public get tables(): DatabaseSchema {
    return this.data;
  }

  public tryLockProfile(profileId: string): boolean {
    if (profileLocks.has(profileId)) {
      return false;
    }
    profileLocks.add(profileId);
    return true;
  }

  public unlockProfile(profileId: string): void {
    profileLocks.delete(profileId);
  }

  public recordEvent(userId: string, type: string, payload: any = {}) {
    this.data.events.push({
      id: crypto.randomUUID(),
      user_id: userId,
      type,
      payload,
      created_at: new Date().toISOString(),
    });
    this.save();
  }

  public recordLlmCall(call: Omit<LlmCall, 'id' | 'created_at'>) {
    this.data.llm_calls.push({
      ...call,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
    this.save();
  }

  private seedIfNeeded() {
    // Seed languages
    if (this.data.languages.length === 0) {
      this.data.languages = [
        { code: 'en', name: 'Английский', is_supported: true },
        { code: 'de', name: 'Немецкий', is_supported: true },
        { code: 'es', name: 'Испанский', is_supported: true },
        { code: 'fr', name: 'Французский', is_supported: true },
      ];
    }

    // Seed General Dictionaries if empty
    if (this.data.dictionaries.length === 0) {
      const enDictId = crypto.randomUUID();
      const enItDictId = crypto.randomUUID();
      const deDictId = crypto.randomUUID();
      const esDictId = crypto.randomUUID();
      const frDictId = crypto.randomUUID();

      this.data.dictionaries.push(
        {
          id: enDictId,
          code: 'general-en-ru',
          name: 'Общий словарь (EN → RU)',
          description: 'Базовый словарь общего назначения по уровням A1–B2',
          target_language: 'en',
          native_language: 'ru',
          is_general: true,
        },
        {
          id: enItDictId,
          code: 'it-en-ru',
          name: 'IT и разработка (EN → RU)',
          description: 'Термины из области программирования, серверов и DevOps',
          target_language: 'en',
          native_language: 'ru',
          is_general: false,
        },
        {
          id: deDictId,
          code: 'general-de-ru',
          name: 'Общий словарь (DE → RU)',
          description: 'Базовый немецкий словарь A1–A2',
          target_language: 'de',
          native_language: 'ru',
          is_general: true,
        },
        {
          id: esDictId,
          code: 'general-es-ru',
          name: 'Общий словарь (ES → RU)',
          description: 'Базовый испанский словарь A1–A2',
          target_language: 'es',
          native_language: 'ru',
          is_general: true,
        },
        {
          id: frDictId,
          code: 'general-fr-ru',
          name: 'Общий словарь (FR → RU)',
          description: 'Базовый французский словарь A1–A2',
          target_language: 'fr',
          native_language: 'ru',
          is_general: true,
        }
      );

      // Seed core words
      const rawWords: Array<{
        target: string;
        native: string;
        lemma: string;
        pos: string;
        level: string | null;
        translations: string[];
        dicts: string[];
      }> = [
        // English A1
        { target: 'en', native: 'ru', lemma: 'apple', pos: 'noun', level: 'A1', translations: ['яблоко'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'book', pos: 'noun', level: 'A1', translations: ['книга'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'city', pos: 'noun', level: 'A1', translations: ['город'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'friend', pos: 'noun', level: 'A1', translations: ['друг', 'подруга'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'water', pos: 'noun', level: 'A1', translations: ['вода'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'house', pos: 'noun', level: 'A1', translations: ['дом'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'read', pos: 'verb', level: 'A1', translations: ['читать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'write', pos: 'verb', level: 'A1', translations: ['писать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'speak', pos: 'verb', level: 'A1', translations: ['говорить', 'разговаривать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'listen', pos: 'verb', level: 'A1', translations: ['слушать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'good', pos: 'adj', level: 'A1', translations: ['хороший', 'добрый'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'small', pos: 'adj', level: 'A1', translations: ['маленький', 'небольшой'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'fast', pos: 'adv', level: 'A1', translations: ['быстро'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'today', pos: 'adv', level: 'A1', translations: ['сегодня'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'always', pos: 'adv', level: 'A1', translations: ['всегда'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'under', pos: 'prep', level: 'A1', translations: ['под'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'with', pos: 'prep', level: 'A1', translations: ['с', 'вместе с'], dicts: [enDictId] },

        // English A2
        { target: 'en', native: 'ru', lemma: 'journey', pos: 'noun', level: 'A2', translations: ['путешествие', 'поездка'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'market', pos: 'noun', level: 'A2', translations: ['рынок', 'базар'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'village', pos: 'noun', level: 'A2', translations: ['деревня', 'село'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'decide', pos: 'verb', level: 'A2', translations: ['решать', 'принимать решение'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'explain', pos: 'verb', level: 'A2', translations: ['объяснять'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'remember', pos: 'verb', level: 'A2', translations: ['помнить', 'вспоминать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'careful', pos: 'adj', level: 'A2', translations: ['осторожный', 'внимательный'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'bright', pos: 'adj', level: 'A2', translations: ['яркий', 'светлый'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'suddenly', pos: 'adv', level: 'A2', translations: ['вдруг', 'внезапно'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'already', pos: 'adv', level: 'A2', translations: ['уже'], dicts: [enDictId] },

        // English B1
        { target: 'en', native: 'ru', lemma: 'challenge', pos: 'noun', level: 'B1', translations: ['вызов', 'сложная задача'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'opportunity', pos: 'noun', level: 'B1', translations: ['возможность', 'шанс'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'achieve', pos: 'verb', level: 'B1', translations: ['достигать', 'добиваться'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'encourage', pos: 'verb', level: 'B1', translations: ['поощрять', 'подбадривать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'reliable', pos: 'adj', level: 'B1', translations: ['надёжный'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'efficient', pos: 'adj', level: 'B1', translations: ['эффективный', 'продуктивный'], dicts: [enDictId] },

        // English B2
        { target: 'en', native: 'ru', lemma: 'ambiguity', pos: 'noun', level: 'B2', translations: ['двусмысленность', 'неопределённость'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'consequence', pos: 'noun', level: 'B2', translations: ['последствие', 'следствие'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'comprehend', pos: 'verb', level: 'B2', translations: ['постигать', 'понимать'], dicts: [enDictId] },
        { target: 'en', native: 'ru', lemma: 'inevitable', pos: 'adj', level: 'B2', translations: ['неизбежный'], dicts: [enDictId] },

        // English IT Thematic
        { target: 'en', native: 'ru', lemma: 'deploy', pos: 'verb', level: 'B1', translations: ['развёртывать', 'выкатывать'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'server', pos: 'noun', level: null, translations: ['сервер'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'database', pos: 'noun', level: 'A2', translations: ['база данных'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'query', pos: 'noun', level: 'B1', translations: ['запрос'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'compile', pos: 'verb', level: 'B1', translations: ['компилировать', 'собирать'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'debug', pos: 'verb', level: 'A2', translations: ['отлаживать', 'искать ошибки'], dicts: [enItDictId] },
        { target: 'en', native: 'ru', lemma: 'cache', pos: 'noun', level: null, translations: ['кэш', 'буфер'], dicts: [enItDictId] },

        // German A1/A2
        { target: 'de', native: 'ru', lemma: 'Haus', pos: 'noun', level: 'A1', translations: ['дом'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'Buch', pos: 'noun', level: 'A1', translations: ['книга'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'Freund', pos: 'noun', level: 'A1', translations: ['друг'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'lesen', pos: 'verb', level: 'A1', translations: ['читать'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'schreiben', pos: 'verb', level: 'A1', translations: ['писать'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'schnell', pos: 'adv', level: 'A1', translations: ['быстро'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'gut', pos: 'adj', level: 'A1', translations: ['хороший'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'arbeiten', pos: 'verb', level: 'A2', translations: ['работать'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'verstehen', pos: 'verb', level: 'A2', translations: ['понимать'], dicts: [deDictId] },
        { target: 'de', native: 'ru', lemma: 'wichtig', pos: 'adj', level: 'A2', translations: ['важный'], dicts: [deDictId] },

        // Spanish A1/A2
        { target: 'es', native: 'ru', lemma: 'casa', pos: 'noun', level: 'A1', translations: ['дом'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'amigo', pos: 'noun', level: 'A1', translations: ['друг'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'leer', pos: 'verb', level: 'A1', translations: ['читать'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'escribir', pos: 'verb', level: 'A1', translations: ['писать'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'bueno', pos: 'adj', level: 'A1', translations: ['хороший', 'добрый'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'rapido', pos: 'adv', level: 'A1', translations: ['быстро'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'viajar', pos: 'verb', level: 'A2', translations: ['путешествовать'], dicts: [esDictId] },
        { target: 'es', native: 'ru', lemma: 'entender', pos: 'verb', level: 'A2', translations: ['понимать'], dicts: [esDictId] },

        // French A1/A2
        { target: 'fr', native: 'ru', lemma: 'maison', pos: 'noun', level: 'A1', translations: ['дом'], dicts: [frDictId] },
        { target: 'fr', native: 'ru', lemma: 'livre', pos: 'noun', level: 'A1', translations: ['книга'], dicts: [frDictId] },
        { target: 'fr', native: 'ru', lemma: 'ami', pos: 'noun', level: 'A1', translations: ['друг'], dicts: [frDictId] },
        { target: 'fr', native: 'ru', lemma: 'lire', pos: 'verb', level: 'A1', translations: ['читать'], dicts: [frDictId] },
        { target: 'fr', native: 'ru', lemma: 'bon', pos: 'adj', level: 'A1', translations: ['хороший'], dicts: [frDictId] },
        { target: 'fr', native: 'ru', lemma: 'comprendre', pos: 'verb', level: 'A2', translations: ['понимать'], dicts: [frDictId] },
      ];

      for (const w of rawWords) {
        const lemmaKey = w.lemma.trim().normalize('NFC').toLowerCase();
        const wordId = crypto.randomUUID();
        this.data.words.push({
          id: wordId,
          target_language: w.target,
          native_language: w.native,
          lemma: w.lemma,
          lemma_key: lemmaKey,
          pos: w.pos,
          level: w.level,
          translations: w.translations,
        });

        for (const dictId of w.dicts) {
          this.data.dictionary_words.push({
            dictionary_id: dictId,
            word_id: wordId,
          });
        }
      }
    }

    this.saveSync();
  }
}

export const db = new Database();
