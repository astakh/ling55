import { Router, Response } from 'express';
import crypto from 'crypto';
import {
  usersRepo, dictionariesRepo, wordsRepo,
  reportsRepo, exercisesRepo, lessonsRepo, profilesRepo, importsRepo,
} from '../db.js';
import { authenticate, requireAdmin, AuthenticatedRequest, hashPassword, revokeAllUserTokens } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();

const ALLOWED_POS = ['noun', 'verb', 'adj', 'adv', 'pron', 'prep', 'conj', 'num', 'det', 'intj'];
const ALLOWED_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// GET /admin/dictionaries
router.get('/dictionaries', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dicts = await dictionariesRepo.all();
    const out = [];
    for (const d of dicts) {
      const wordsCount = await dictionariesRepo.wordCount(d.id);
      out.push({ ...d, words_total: wordsCount });
    }
    res.json({ dictionaries: out });
  } catch (err: any) {
    logger.error('ADMIN', 'DB error listing dictionaries', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /admin/dictionaries/import (Algorithm 5.9)
router.post('/dictionaries/import', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
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

  try {
    // Find or create dictionary
    let dictionary = await dictionariesRepo.findByCode(code);
    let isCreated = false;

    if (dictionary) {
      if (dictionary.target_language !== target_language || dictionary.native_language !== native_language) {
        res.status(409).json({
          error: { code: 'language_pair_mismatch', message: 'Языковая пара существующего словаря не совпадает' },
        });
        return;
      }
    } else if (!dryRun) {
      dictionary = await dictionariesRepo.create({
        code,
        name,
        description: description || '',
        target_language,
        native_language,
        is_general: Boolean(is_general),
      });
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
      const existingWord = await wordsRepo.findByLemmaKey(target_language, native_language, lemmaKey, item.pos);

      if (!existingWord) {
        added++;
        if (!dryRun) {
          const newWord = await wordsRepo.create({
            target_language,
            native_language,
            lemma,
            lemma_key: lemmaKey,
            pos: item.pos,
            level: item.level || null,
            translations,
          });
          await dictionariesRepo.linkWord(dictId, newWord.id);
        }
      } else {
        // Word already exists in words table
        const alreadyLinked = await dictionariesRepo.isWordLinked(dictId, existingWord.id);

        if (alreadyLinked) {
          skipped++;
        } else {
          linked++;
          if (!dryRun) {
            await dictionariesRepo.linkWord(dictId, existingWord.id);
          }
        }
      }
    }

    if (!dryRun) {
      importsRepo.record({
        admin_id: user.id,
        file_name: payload.file_name || `${code}.json`,
        sha256: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        dictionary_id: dictId,
        counters: { added, linked, skipped, errors },
        dry_run: false,
      });
    }

    logger.info('ADMIN', `Dictionary import finished: "${name}" (${code})`, {
      adminId: user.id,
      dryRun,
      added,
      linked,
      skipped,
      errors,
    });

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
  } catch (err: any) {
    logger.error('ADMIN', 'DB error importing dictionary', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /admin/reports
router.get('/reports', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const statusFilter = req.query.status as string;
    const reports = await reportsRepo.list(statusFilter || undefined);

    const enriched = [];
    for (const r of reports) {
      const exercise = await exercisesRepo.findById(r.exercise_id);
      const lesson = exercise ? await lessonsRepo.findById(exercise.lesson_id) : null;
      const profile = lesson ? await profilesRepo.findById(lesson.language_profile_id) : null;
      const author = await usersRepo.findById(r.user_id);

      enriched.push({
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
      });
    }

    res.json({ reports: enriched });
  } catch (err: any) {
    logger.error('ADMIN', 'DB error listing reports', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// PATCH /admin/reports/:id
router.patch('/reports/:id', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const report = await reportsRepo.findById(req.params.id);
    if (!report) {
      res.status(404).json({
        error: { code: 'not_found', message: 'Жалоба не найдена' },
      });
      return;
    }

    const { status, admin_note } = req.body;
    const patch: Record<string, any> = {};
    if (status && ['new', 'processed'].includes(status)) {
      patch.status = status;
    }
    if (admin_note !== undefined) {
      patch.admin_note = String(admin_note);
    }

    const updated = Object.keys(patch).length > 0
      ? await reportsRepo.update(report.id, patch)
      : report;

    logger.info('ADMIN', `Report updated: ${report.id}`, {
      adminId: req.user!.id,
      newStatus: updated?.status,
      adminNote: updated?.admin_note,
    });

    res.json({ report: updated });
  } catch (err: any) {
    logger.error('ADMIN', 'DB error updating report', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// GET /admin/users
router.get('/users', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const query = (req.query.q as string || '').toLowerCase().trim();
    const users = await usersRepo.listAll(query || undefined);

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
  } catch (err: any) {
    logger.error('ADMIN', 'DB error listing users', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /admin/users/:id/reset-password
router.post('/users/:id/reset-password', authenticate, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    if (!user) {
      res.status(404).json({
        error: { code: 'not_found', message: 'Пользователь не найден' },
      });
      return;
    }

    const temporaryPassword = `Tmp_${crypto.randomBytes(6).toString('base64url')}!`;
    await usersRepo.update(user.id, { password_hash: await hashPassword(temporaryPassword) });
    await revokeAllUserTokens(user.id);

    logger.warn('ADMIN', `Admin reset password for user: ${user.email}`, {
      adminId: req.user!.id,
      targetUserId: user.id,
    });

    res.json({
      success: true,
      user_id: user.id,
      email: user.email,
      temporary_password: temporaryPassword,
      message: 'Пароль успешно сброшен. Передайте временный пароль пользователю.',
    });
  } catch (err: any) {
    logger.error('ADMIN', 'DB error resetting password', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
