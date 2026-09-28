-- ============================================================================
-- SRS Context LLM — схема БД: таблицы, индексы, права, базовый seed
-- PostgreSQL 13+
-- ============================================================================
-- Выполнять ПОСЛЕ create_database.sql, подключившись к базе srs_context
-- от имени администратора (владельца базы):
--   psql "postgresql://ADMIN_USER:PASSWORD@DB_HOST:5432/srs_context" -f scripts/sql/01_schema.sql
--
-- Структура полностью соответствует модели данных приложения (server/db.ts).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Расширения (gen_random_uuid() встроен в PG13+; pgcrypto — для старых версий)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Таблицы
-- ----------------------------------------------------------------------------

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                       TEXT NOT NULL UNIQUE,
    password_hash               TEXT NOT NULL,
    native_language             TEXT NOT NULL DEFAULT 'ru',
    timezone                    TEXT NOT NULL DEFAULT 'UTC',
    timezone_changed_at         TIMESTAMPTZ,
    is_onboarded                BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin                    BOOLEAN NOT NULL DEFAULT FALSE,
    active_language_profile_id  UUID,          -- FK добавлен ниже (циклическая ссылка)
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refresh-токены (rotation по семействам)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id    UUID NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,          -- sha256 hex от токена (хранится только хеш)
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    replaced_by  UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user   ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- Справочник языков
CREATE TABLE IF NOT EXISTS languages (
    code         TEXT PRIMARY KEY,              -- 'en', 'de', 'es', 'fr'
    name         TEXT NOT NULL,
    is_supported BOOLEAN NOT NULL DEFAULT TRUE
);

-- Словари
CREATE TABLE IF NOT EXISTS dictionaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    target_language TEXT NOT NULL,
    native_language TEXT NOT NULL,
    is_general      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_dictionaries_langs ON dictionaries(target_language, native_language);

-- Слова (леммы)
CREATE TABLE IF NOT EXISTS words (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_language TEXT NOT NULL,
    native_language TEXT NOT NULL,
    lemma           TEXT NOT NULL,
    lemma_key       TEXT NOT NULL,                      -- lower(trim(lemma)) для поиска/дедупликации
    pos             TEXT NOT NULL,                      -- noun/verb/adj/adv/pron/prep/conj/num/det/intj
    level           TEXT CHECK (level IN ('A1','A2','B1','B2','C1','C2') OR level IS NULL),
    translations    JSONB NOT NULL DEFAULT '[]'::jsonb  -- массив переводов
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_words_lemma ON words(target_language, native_language, lemma_key, pos);
CREATE INDEX IF NOT EXISTS idx_words_level ON words(level);

-- Связь M:N словарь <-> слово
CREATE TABLE IF NOT EXISTS dictionary_words (
    dictionary_id UUID NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
    word_id       UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    PRIMARY KEY (dictionary_id, word_id)
);

-- Профили изучения языка пользователем
CREATE TABLE IF NOT EXISTS user_language_profiles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_language    TEXT NOT NULL,
    level              TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
    dictionary_id      UUID NOT NULL REFERENCES dictionaries(id),
    daily_lesson_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_lesson_limit > 0),
    last_lesson_number INTEGER NOT NULL DEFAULT 0 CHECK (last_lesson_number >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, target_language)
);

-- Теперь можно добавить FK из users на активный профиль
ALTER TABLE users
    ADD CONSTRAINT fk_users_active_profile
    FOREIGN KEY (active_language_profile_id)
    REFERENCES user_language_profiles(id) ON DELETE SET NULL;

-- Слова пользователя (состояние SRS)
CREATE TABLE IF NOT EXISTS user_words (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    language_profile_id  UUID NOT NULL REFERENCES user_language_profiles(id) ON DELETE CASCADE,
    word_id              UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','ignored')),
    stage                INTEGER NOT NULL DEFAULT 0 CHECK (stage >= 0),
    due_lesson_number    INTEGER,
    last_reviewed_at     TIMESTAMPTZ,
    source               TEXT NOT NULL DEFAULT 'dictionary' CHECK (source IN ('dictionary','suggestion','decline')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (language_profile_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_user_words_due ON user_words(language_profile_id, status, due_lesson_number);

-- Уроки
CREATE TABLE IF NOT EXISTS lessons (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    language_profile_id  UUID NOT NULL REFERENCES user_language_profiles(id) ON DELETE CASCADE,
    lesson_number        INTEGER NOT NULL CHECK (lesson_number > 0),
    status               TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
    words_per_lesson     INTEGER NOT NULL DEFAULT 10 CHECK (words_per_lesson > 0),
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_local_date   DATE NOT NULL,
    completed_at         TIMESTAMPTZ,
    completed_local_date DATE,
    abandoned_at         TIMESTAMPTZ,
    UNIQUE (language_profile_id, lesson_number)
);
CREATE INDEX IF NOT EXISTS idx_lessons_profile ON lessons(language_profile_id, status);

-- Упражнения урока (предложение + перевод пользователя)
CREATE TABLE IF NOT EXISTS lesson_exercises (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id             UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    order_index           INTEGER NOT NULL,
    target_sentence       TEXT NOT NULL,
    reference_translation TEXT NOT NULL,
    user_translation      TEXT,
    dont_know             BOOLEAN NOT NULL DEFAULT FALSE,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','evaluated')),
    evaluated_at          TIMESTAMPTZ,
    UNIQUE (lesson_id, order_index)
);

-- Целевые слова упражнения и результаты проверки
CREATE TABLE IF NOT EXISTS lesson_exercise_words (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id    UUID NOT NULL REFERENCES lesson_exercises(id) ON DELETE CASCADE,
    word_id        UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    is_target      BOOLEAN NOT NULL DEFAULT TRUE,
    is_new         BOOLEAN NOT NULL DEFAULT FALSE,
    surface_form   TEXT,
    result         TEXT CHECK (result IN ('correct','typo','incorrect') OR result IS NULL),
    user_fragment  TEXT,
    stage_before   INTEGER,
    stage_after    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lew_exercise ON lesson_exercise_words(exercise_id);

-- Новые слова, предложенные LLM к упражнению
CREATE TABLE IF NOT EXISTS lesson_exercise_suggestions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID NOT NULL REFERENCES lesson_exercises(id) ON DELETE CASCADE,
    word_id     UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    state       TEXT NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested','added','ignored'))
);
CREATE INDEX IF NOT EXISTS idx_suggestions_exercise ON lesson_exercise_suggestions(exercise_id);

-- Жалобы на предложения (модерация админом)
CREATE TABLE IF NOT EXISTS sentence_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES lesson_exercises(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL CHECK (reason IN ('bad_sentence','wrong_translation','grammar_error','other')),
    comment     TEXT,
    status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','processed')),
    admin_note  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON sentence_reports(status);

-- Журнал вызовов LLM (отладка/аналитика)
CREATE TABLE IF NOT EXISTS llm_calls (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose             TEXT NOT NULL CHECK (purpose IN ('generate','evaluate')),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    language_profile_id UUID REFERENCES user_language_profiles(id) ON DELETE SET NULL,
    lesson_id           UUID REFERENCES lessons(id) ON DELETE SET NULL,
    exercise_id         UUID REFERENCES lesson_exercises(id) ON DELETE SET NULL,
    attempt             INTEGER NOT NULL DEFAULT 1,
    request             JSONB,
    response            JSONB,
    status              TEXT NOT NULL CHECK (status IN ('ok','http_error','timeout','invalid_json','invalid_schema','validation_failed')),
    http_status         INTEGER,
    latency_ms          INTEGER NOT NULL DEFAULT 0,
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_status  ON llm_calls(status);

-- События пользователей (аналитика, стрики)
CREATE TABLE IF NOT EXISTS events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);

-- История импортов словарей (админка)
CREATE TABLE IF NOT EXISTS dictionary_imports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name     TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    dictionary_id UUID NOT NULL REFERENCES dictionaries(id) ON DELETE CASCADE,
    counters      JSONB NOT NULL DEFAULT '{"added":0,"linked":0,"skipped":0,"errors":0}'::jsonb,
    dry_run       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Права для пользователя приложения srs_app
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO srs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO srs_app;

-- ----------------------------------------------------------------------------
-- Базовый seed: справочник языков
-- (словари и стартовые слова загружаются при первом запуске приложения
--  либо скриптом: npm run db:seed)
-- ----------------------------------------------------------------------------
INSERT INTO languages (code, name, is_supported) VALUES
    ('en', 'Английский',  TRUE),
    ('de', 'Немецкий',    TRUE),
    ('es', 'Испанский',   TRUE),
    ('fr', 'Французский', TRUE)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Проверка: SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
