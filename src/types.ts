export interface User {
  id: string;
  email: string;
  native_language: string;
  timezone: string;
  is_onboarded: boolean;
  is_admin: boolean;
  active_language_profile_id: string | null;
}

export interface LanguageProfile {
  id: string;
  target_language: string;
  language_name?: string;
  level: string; // A1, A2, B1, B2
  dictionary_id: string;
  dictionary_name?: string;
  dictionary?: { id: string; name: string };
  daily_lesson_limit: number;
  daily_lesson_limit_max?: number;
  last_lesson_number: number;
  is_active?: boolean;
}

export interface StreakInfo {
  current: number;
  longest: number;
  today_done: boolean;
  extended_today?: boolean;
}

export interface DashboardSummary {
  profile: LanguageProfile;
  profiles: Array<{ id: string; target_language: string; language_name?: string }>;
  today: string;
  lessons_today: number;
  daily_lesson_limit: number;
  resets_at: string;
  cta: 'start' | 'resume' | 'limit_reached';
  resume: {
    lesson_id: string;
    exercises_done: number;
    exercises_total: number;
  } | null;
  words: {
    active: number;
    mastered: number;
    ignored: number;
  };
  streak: StreakInfo;
}

export interface DueWordPreview {
  word_id: string;
  lemma: string;
  pos: string;
}

export interface NewWordPreview {
  word_id: string;
  lemma: string;
  pos: string;
  translations: string[];
}

export interface LessonPreviewResponse {
  state: 'ready' | 'resume' | 'limit_reached' | 'no_words';
  lesson_number?: number;
  lesson_id?: string;
  exercises_done?: number;
  exercises_total?: number;
  resets_at?: string;
  due_words?: DueWordPreview[];
  new_words?: NewWordPreview[];
  dictionary_exhausted?: boolean;
}

export interface CurrentExerciseResponse {
  exercise_id: string;
  sentence: string;
  order_index: number;
  exercises_done: number;
  exercises_total: number;
}

export interface EvaluatedWord {
  word_id: string;
  lemma: string;
  pos: string;
  surface_form: string | null;
  result: 'correct' | 'typo' | 'incorrect' | null;
  user_fragment: string | null;
  translations: string[];
}

export interface SuggestedWord {
  word_id: string;
  lemma: string;
  pos: string;
  translations: string[];
  state?: 'suggested' | 'added' | 'ignored';
}

export interface EvaluationResponse {
  exercise_id: string;
  target_sentence: string;
  reference_translation: string;
  user_translation: string | null;
  words: EvaluatedWord[];
  suggestions: SuggestedWord[];
  lesson_completed: boolean;
}

export interface LessonSummaryResponse {
  lesson_number: number;
  words_total: number;
  reviewed: number;
  new_words: number;
  correct: number;
  typo: number;
  incorrect: number;
  without_errors: number;
  suggestions_added: number;
  streak: StreakInfo;
}

export interface VocabularyItem {
  word_id: string;
  lemma: string;
  pos: string;
  level: string | null;
  translations: string[];
  status: 'active' | 'mastered' | 'ignored';
  stage: number;
  due_in_lessons: number | null;
}

export interface WordContextItem {
  exercise_id: string;
  target_sentence: string;
  reference_translation: string;
  surface_form: string | null;
  result: 'correct' | 'typo' | 'incorrect' | null;
  is_target: boolean;
  date: string | null;
}

export interface WordDetailResponse {
  word_id: string;
  lemma: string;
  pos: string;
  level: string | null;
  translations: string[];
  status: 'active' | 'mastered' | 'ignored';
  stage: number;
  due_in_lessons: number | null;
  last_reviewed_at: string | null;
  history: WordContextItem[];
}

export interface ProfileStatsResponse {
  streak: StreakInfo;
  heatmap: Record<string, number>;
  accuracy: {
    all_time: number;
    last_30_days: number;
    total_evaluated: number;
  };
  words: {
    active: number;
    mastered: number;
    ignored: number;
  };
  completed_lessons: number;
  languages: Array<{
    profile_id: string;
    target_language: string;
    language_name?: string;
    level: string;
    words: { active: number; mastered: number; ignored: number };
    completed_lessons: number;
    accuracy: number;
    total_words_evaluated: number;
  }>;
}

export interface SentenceReportItem {
  id: string;
  reason: 'bad_sentence' | 'wrong_translation' | 'grammar_error' | 'other';
  comment: string | null;
  status: 'new' | 'processed';
  admin_note: string | null;
  created_at: string;
  user_email: string;
  target_sentence: string;
  reference_translation: string;
  user_translation: string | null;
  target_language: string;
}
