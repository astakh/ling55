import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

import { logger } from './server/logger.js';
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

async function bootstrap() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
