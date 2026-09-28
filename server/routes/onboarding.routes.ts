import { Router, Response } from 'express';
import {
  usersRepo, dictionariesRepo, languagesRepo, profilesRepo, eventsRepo,
} from '../db.js';
import { authenticate, AuthenticatedRequest } from '../auth.js';
import { logger } from '../logger.js';

const router = Router();

// GET /languages/pairs?native=ru
router.get('/pairs', async (req, res: Response) => {
  const native = String(req.query.native || 'ru');
  try {
    const generalDicts = (await dictionariesRepo.all()).filter(
      d => d.native_language === native && d.is_general
    );
    const languages = await languagesRepo.all();

    const supportedTargets = generalDicts.map(d => {
      const lang = languages.find(l => l.code === d.target_language);
      return {
        code: d.target_language,
        name: lang ? lang.name : d.target_language,
        dictionary_id: d.id,
        dictionary_name: d.name,
      };
    });

    logger.info('ONBOARDING', `Language pairs retrieved for native language "${native}"`, {
      pairsCount: supportedTargets.length,
      languages: supportedTargets.map(p => p.code),
    });

    res.json({ native_language: native, pairs: supportedTargets });
  } catch (err: any) {
    logger.error('ONBOARDING', 'DB error loading language pairs', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

// POST /onboarding/complete
router.post('/complete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.is_onboarded) {
    logger.warn('ONBOARDING', 'User attempted duplicate onboarding', { userId: user.id });
    res.status(409).json({
      error: { code: 'already_onboarded', message: 'Онбординг уже пройден' },
    });
    return;
  }

  const { native_language, timezone, target_language, level } = req.body;

  if (!native_language || !target_language || !level) {
    logger.warn('ONBOARDING', 'Onboarding validation failed: missing fields', { userId: user.id, body: req.body });
    res.status(422).json({
      error: { code: 'validation_error', message: 'Все поля обязательны' },
    });
    return;
  }

  if (target_language === native_language) {
    res.status(422).json({
      error: { code: 'same_language', message: 'Изучаемый язык не может совпадать с родным' },
    });
    return;
  }

  const validLevels = ['A1', 'A2', 'B1', 'B2'];
  if (!validLevels.includes(level)) {
    res.status(422).json({
      error: { code: 'invalid_level', message: 'Уровень должен быть от A1 до B2' },
    });
    return;
  }

  try {
    // Find general dictionary for this pair
    const generalDict = await dictionariesRepo.findGeneralPair(native_language, target_language);
    if (!generalDict) {
      logger.warn('ONBOARDING', 'No general dictionary for language pair', { native_language, target_language });
      res.status(422).json({
        error: { code: 'pair_not_supported', message: 'Для данной пары языков нет общего словаря' },
      });
      return;
    }

    const tz = timezone || 'Europe/Moscow';

    // Create language profile
    const newProfile = await profilesRepo.create({
      user_id: user.id,
      target_language,
      level,
      dictionary_id: generalDict.id,
      daily_lesson_limit: 1,
      last_lesson_number: 0,
    });

    // Update user
    const updatedUser = await usersRepo.update(user.id, {
      native_language,
      timezone: tz,
      is_onboarded: true,
      active_language_profile_id: newProfile.id,
    });

    if (updatedUser) Object.assign(user, updatedUser);

    logger.success('ONBOARDING', `Onboarding completed successfully!`, {
      userId: user.id,
      email: user.email,
      targetLanguage: target_language,
      level,
      timezone: tz,
      dictionaryId: generalDict.id,
    });

    eventsRepo.record(user.id, 'onboarding_completed', {
      target_language,
      level,
      dictionary_id: generalDict.id,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        is_onboarded: true,
        is_admin: user.is_admin,
        native_language,
        timezone: tz,
        active_language_profile_id: newProfile.id,
      },
      profile: newProfile,
    });
  } catch (err: any) {
    logger.error('ONBOARDING', 'DB error completing onboarding', { message: err.message });
    res.status(500).json({ error: { code: 'internal_server_error', message: 'Ошибка базы данных' } });
  }
});

export default router;
