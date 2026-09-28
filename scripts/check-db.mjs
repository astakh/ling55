// Скрипт проверки подключения к удалённому PostgreSQL (npm run db:check).
// Использует DATABASE_URL из .env (загружается через scripts/load-env.mjs).
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('❌ DATABASE_URL не задан. Скопируйте .env.example в .env и укажите строку подключения.');
  process.exit(1);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.error('❌ Модуль pg не установлен. Выполните: npm install');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });

try {
  await client.connect();
  const version = await client.query('SHOW server_version');
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log('✅ Подключение к PostgreSQL успешно');
  console.log(`   Сервер: ${version.rows[0].server_version}`);
  if (tables.rows.length === 0) {
    console.log('   ⚠️  В схеме public нет таблиц. Выполните скрипты создания БД (см. README-LOCAL.md, раздел «PostgreSQL»).');
  } else {
    console.log(`   Таблицы (${tables.rows.length}): ${tables.rows.map(t => t.tablename).join(', ')}`);
  }
  await client.end();
} catch (err) {
  console.error('❌ Не удалось подключиться к PostgreSQL:', err.message);
  console.error('   Проверьте: DATABASE_URL, доступность хоста/порта, логин/пароль, pg_hba.conf и firewall на сервере.');
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
}
