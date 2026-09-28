import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { authenticate, requireAdmin, AuthenticatedRequest, hashPassword, revokeAllUserTokens } from '../auth.js';

const router = Router();

const ALLOWED_POS = ['noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'num', 'det', 'intj'];
const ALLOWED_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// GET /admin/dictionaries
router.get('/dictionaries', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const dicts = db.tables.dictionaries.map(d => {
    const wordsCount = db.tables.dictionary_words.filter(dw => dw.dictionary_id === d.id).length;
    return {
      ...d,
      words_total: wordsCount,
    };
  });
  res.json({ dictionaries: dicts });
});

// POST /admin/dictionaries/import (Algorithm 5.9)
router.post('/dictionaries/import', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const dryRun = req.query.dry_run === 'true';
  const payload = req.body;

  if (!payload || payload.schema_version !== 1 || !payload.dictionary || !Array.isArray(payload.words)) {
    res.status(422).json({
      error: { code: 'invalid_format', message: 'Неверный формат файла словаря (ожидается schema_version: 1)' },
    });
    return;
  }

  const { dictionary: dictMeta, words: rawWords } = payload;
  const { code, name, description, target_language, native_language, is_general } = dictMeta;

  if (!code || !name || !target_language || !native_language) {
    res.status(422).json({
      error: { code: 'invalid_dictionary_meta', message: 'Обязательные метаданные словаря не заполнены' },
    });
    return;
  }

  if (target_language === native_language) {
    res.status(422).json({
      error: { code: 'same_language', message: 'Изучаемый и родной языки не могут совпадать' },
    });
    return;
  }

  // Find or create dictionary
  let dictionary = db.tables.dictionaries.find(d => d.code === code);
  let isCreated = false;

  if (dictionary) {
    if (dictionary.target_language !== target_language || dictionary.native_language !== native_language) {
      res.status(409).json({
        error: { code: 'language_pair_mismatch', message: 'Языковая пара существующего словаря не совпадает' },
      });
      return;
    }
  } else if (!dryRun) {
    dictionary = {
      id: crypto.randomUUID(),
      code,
      name,
      description: description || '',
      target_language,
      native_language,
      is_general: Boolean(is_general),
    };
    db.tables.dictionaries.push(dictionary);
    isCreated = true;
  }

  let added = 0;
  let linked = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: Array<{ index: number; lemma: string; reason: string }> = [];

  const seenInFile = new Set<string>();
  const dictId = dictionary ? dictionary.id : 'preview-dict-id';

  for (let i = 0; i < rawWords.length; i++) {
    const item = rawWords[i];
    const lemma = (item.lemma || '').normalize('NFC').trim();

    if (!lemma || lemma.length > 64) {
      errors++;
      errorDetails.push({ index: i, lemma: lemma || '?', reason: 'lemma_too_long_or_empty' });
      continue;
    }

    if (!ALLOWED_POS.includes(item.pos)) {
      errors++;
      errorDetails.push({ index: i, lemma, reason: 'invalid_pos' });
      continue;
    }

    if (is_general && !item.level) {
      errors++;
      errorDetails.push({ index: i, lemma, reason: 'level_required' });
      continue;
    }

    if (item.level && !ALLOWED_LEVELS.includes(item.level)) {
      errors++;
      errorDetails.push({ index: i, lemma, reason: 'invalid_level' });
      continue;
    }

    const translations = Array.isArray(item.translations)
      ? item.translations.map((t: string) => String(t).trim()).filter(Boolean)
      : [];

    if (translations.length === 0) {
      errors++;
      errorDetails.push({ index: i, lemma, reason: 'empty_translations' });
      continue;
    }

    const lemmaKey = lemma.toLowerCase();
    const fileKey = `${lemmaKey}:${item.pos}`;

    if (seenInFile.has(fileKey)) {
      skipped++;
      errorDetails.push({ index: i, lemma, reason: 'duplicate_in_file' });
      continue;
    }
    seenInFile.add(fileKey);

    // Look for existing word in global table
    let existingWord = db.tables.words.find(
      w => w.target_language === target_language &&
           w.native_language === native_language &&
           w.lemma_key === lemmaKey &&
           w.pos === item.pos
    );

    if (!existingWord) {
      added++;
      if (!dryRun) {
        const newWordId = crypto.randomUUID();
        existingWord = {
          id: newWordId,
          target_language,
          native_language,
          lemma,
          lemma_key: lemmaKey,
          pos: item.pos,
          level: item.level || null,
          translations,
        };
        db.tables.words.push(existingWord);
        db.tables.dictionary_words.push({
          dictionary_id: dictId,
          word_id: newWordId,
        });
      }
    } else {
      // Word already exists in words table
      const alreadyLinked = db.tables.dictionary_words.some(
        dw => dw.dictionary_id === dictId && dw.word_id === existingWord!.id
      );

      if (alreadyLinked) {
        skipped++;
      } else {
        linked++;
        if (!dryRun) {
          db.tables.dictionary_words.push({
            dictionary_id: dictId,
            word_id: existingWord.id,
          });
        }
      }
    }
  }

  if (!dryRun) {
    db.saveSync();
    db.tables.dictionary_imports.push({
      id: crypto.randomUUID(),
      admin_id: user.id,
      file_name: payload.file_name || `${code}.json`,
      sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      dictionary_id: dictId,
      counters: { added, linked, skipped, errors },
      dry_run: false,
      created_at: new Date().toISOString(),
    });
  }

  res.json({
    dictionary: {
      code,
      name,
      created: isCreated,
    },
    dry_run: dryRun,
    added,
    linked,
    skipped,
    errors,
    error_details: errorDetails.slice(0, 200),
  });
});

// GET /admin/reports
router.get('/reports', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const statusFilter = req.query.status as string;
  let reports = db.tables.sentence_reports;

  if (statusFilter) {
    reports = reports.filter(r => r.status === statusFilter);
  }

  const enriched = reports.map(r => {
    const exercise = db.tables.lesson_exercises.find(e => e.id === r.exercise_id);
    const lesson = exercise ? db.tables.lessons.find(l => l.id === exercise.lesson_id) : null;
    const profile = lesson ? db.tables.user_language_profiles.find(p => p.id === lesson.language_profile_id) : null;
    const author = db.tables.users.find(u => u.id === r.user_id);

    return {
      id: r.id,
      reason: r.reason,
      comment: r.comment,
      status: r.status,
      admin_note: r.admin_note,
      created_at: r.created_at,
      user_email: author ? author.email : 'unknown',
      target_sentence: exercise ? exercise.target_sentence : '',
      reference_translation: exercise ? exercise.reference_translation : '',
      user_translation: exercise ? exercise.user_translation : '',
      target_language: profile ? profile.target_language : 'en',
    };
  });

  enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json({ reports: enriched });
});

// PATCH /admin/reports/:id
router.patch('/reports/:id', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const report = db.tables.sentence_reports.find(r => r.id === req.params.id);
  if (!report) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Жалоба не найдена' },
    });
    return;
  }

  const { status, admin_note } = req.body;
  if (status && ['new', 'processed'].includes(status)) {
    report.status = status;
  }
  if (admin_note !== undefined) {
    report.admin_note = String(admin_note);
  }

  db.saveSync();
  res.json({ report });
});

// GET /admin/users
router.get('/users', authenticate, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const query = (req.query.q as string || '').toLowerCase().trim();
  let users = db.tables.users;

  if (query) {
    users = users.filter(u => u.email.toLowerCase().includes(query));
  }

  res.json({
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      native_language: u.native_language,
      timezone: u.timezone,
      is_onboarded: u.is_onboarded,
      is_admin: u.is_admin,
      created_at: u.created_at,
    })),
  });
});

// POST /admin/users/:id/reset-password
router.post('/users/:id/reset-password', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const user = db.tables.users.find(u => u.id === req.params.id);
  if (!user) {
    res.status(404).json({
      error: { code: 'not_found', message: 'Пользователь не найден' },
    });
    return;
  }

  const temporaryPassword = `Tmp_${crypto.randomBytes(6).toString('base64url')}!`;
  user.password_hash = await hashPassword(temporaryPassword);
  revokeAllUserTokens(user.id);
  db.saveSync();

  res.json({
    success: true,
    user_id: user.id,
    email: user.email,
    temporary_password: temporaryPassword,
    message: 'Пароль успешно сброшен. Передайте временный пароль пользователю.',
  });
});

export default router;
