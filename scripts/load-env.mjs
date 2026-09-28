// Минимальный загрузчик .env (без внешних зависимостей).
// Вызывается из npm-скриптов: node --import ./scripts/load-env.mjs ...
// Значения, уже заданные в окружении (PowerShell/cmd/Git Bash), имеют приоритет над .env
import fs from 'fs';
import path from 'path';

const envFile = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Снять кавычки: "..." или '...'
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
