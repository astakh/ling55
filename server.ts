import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import pg from 'pg';

import { logger } from './server/logger.js';
import { initDatabase } from './server/db.js';
import { closePool } from './server/pg.js';
import authRoutes from './server/routes/auth.routes.js';
import onboardingRoutes from './server/routes/onboarding.routes.js';
import languagesRoutes from './server/routes/languages.routes.js';
import settingsRoutes from './server/routes/settings.routes.js';
import dashboardRoutes from './server/routes/dashboard.routes.js';
import lessonRoutes from './server/routes/lesson.routes.js';
import vocabularyRoutes from './server/routes/vocabulary.routes.js';
import profileRoutes from './server/routes/profile.routes.js';
import adminRoutes from './server/routes/admin.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Проверка подключения к удалённому PostgreSQL (DATABASE_URL из .env).
 * Выполняется только в dev-режиме; при ошибке сервер НЕ останавливается,
 * но в консоль выводится предупреждение. Отключить: CHECK_DB_ON_STARTUP=false
 */
async function checkPostgresConnection(): Promise<void> {
  if (process.env.CHECK_DB_ON_STARTUP === 'false') return;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.warn('DB', 'DATABASE_URL не задан в .env — проверка подключения к PostgreSQL пропущена');
    return;
  }

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const tablesRes = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    const versionRes = await client.query('SHOW server_version');
    await client.end();
    logger.success(
      'DB',
      `PostgreSQL подключен: ${versionRes.rows[0].server_version}, таблиц в public: ${tablesRes.rows.length}`,
      { tables: tablesRes.rows.map((r: any) => r.tablename).join(', ') || 'нет таблиц — выполните scripts/sql/01_schema.sql' }
    );
  } catch (err: any) {
    logger.error('DB', 'Не удалось подключиться к PostgreSQL', {
      host: (() => { try { return new URL(connectionString).host; } catch { return 'unknown'; } })(),
      message: err.message,
    });
    logger.warn('DB', 'Сервер запущен без доступа к БД. Проверьте DATABASE_URL, права и сетевой доступ к серверу.');
    try { await client.end(); } catch { /* ignore */ }
  }
}

async function bootstrap() {
  // Проверка доступности PostgreSQL и корректности схемы (или остановка с ошибкой)
  if (process.env.CHECK_DB_ON_STARTUP !== 'false') {
    await initDatabase();
  } else {
    logger.warn('DB', 'CHECK_DB_ON_STARTUP=false — проверка БД при старте пропущена');
  }

  if (!isProduction) {
    await checkPostgresConnection();
  }

  const app = express();

  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // Global HTTP Request Logging Middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') && req.path !== '/api/health') {
      const startTime = Date.now();
      const method = req.method;
      const url = req.originalUrl || req.url;

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        const details: Record<string, any> = {
          status,
          duration: `${duration}ms`,
        };
        if (req.body && Object.keys(req.body).length > 0) {
          // Avoid logging password in plain text
          const sanitizedBody = { ...req.body };
          if (sanitizedBody.password) sanitizedBody.password = '***';
          details.body = sanitizedBody;
        }

        if (status >= 400) {
          logger.warn('HTTP', `${method} ${url}`, details);
        } else {
          logger.info('HTTP', `${method} ${url}`, details);
        }
      });
    }
    next();
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/languages', onboardingRoutes);
  app.use('/api/onboarding', onboardingRoutes);
  app.use('/api', languagesRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/lesson', lessonRoutes);
  app.use('/api/vocabulary', vocabularyRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/admin', adminRoutes);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Global API error handler
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    res.status(500).json({
      error: {
        code: 'internal_server_error',
        message: err.message || 'Внутренняя ошибка сервера',
      },
    });
  });

  if (!isProduction) {
    // Development mode: attach Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: serve static build
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: закрываем HTTP-сервер и пул соединений с PostgreSQL
  const shutdown = async (signal: string) => {
    logger.info('SERVER', `Получен ${signal} — остановка сервера...`);
    server.close();
    try {
      await closePool();
      logger.success('SERVER', 'Пул соединений с PostgreSQL закрыт');
    } catch (err: any) {
      logger.error('SERVER', 'Ошибка при закрытии пула PostgreSQL', { message: err.message });
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
