# Локальная установка и запуск (Windows + VS Code)

Проект: сервер Express + клиент React/Vite (запускаются одной командой),
данные — PostgreSQL **на удалённом сервере**.

---

## 1. Требования

| ПО | Версия | Как проверить |
|---|---|---|
| Node.js | **20 LTS или 22+** (нужен ≥ 20.6 из-за `node --import`) | `node -v` |
| npm | идёт в комплекте с Node.js | `npm -v` |
| Git | любая | `git -v` |
| psql (опционально) | для выполнения SQL-скриптов с локальной машины | `psql -V` |

Скачать Node.js: https://nodejs.org (LTS, Windows Installer .msi).
PostgreSQL client входит в установщик PostgreSQL или ставится отдельно (компонент «Command Line Tools»).

---

## 2. Установка проекта

В терминале PowerShell внутри VS Code (`Ctrl+`` `):

```powershell
# из корня проекта
npm install

# создаём локальный конфиг из образца
Copy-Item .env.example .env
```

Откройте `.env` и заполните:

| Переменная | Что указать |
|---|---|
| `GEMINI_API_KEY` | ваш ключ API Google Gemini |
| `JWT_SECRET` | случайная длинная строка (например, вывод `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `DATABASE_URL` | строка подключения к удалённому PostgreSQL, см. раздел 3 |
| `PORT` | по умолчанию `3000` |
| `APP_URL` | `http://localhost:3000` |

Остальные переменные можно оставить по умолчанию.

### Формат DATABASE_URL

```
postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@ХОСТ:5432/ИМЯ_БД?schema=public
```

Пример:

```
DATABASE_URL='postgresql://srs_app:MyStr0ng!Pass@db.example.com:5432/srs_context?schema=public'
```

Если в пароле есть спецсимволы — закодируйте их URL-encoding (`@` → `%40`, `/` → `%2F`, `#` → `%23`).
Используйте **одинарные кавычки**, чтобы `$` в пароле не подставлялся как переменная окружения.

---

## 3. Подготовка PostgreSQL на удалённом сервере

В репозитории два SQL-скрипта:

1. **`scripts/sql/create_database.sql`** — создаёт базу `srs_context` и пользователя приложения `srs_app`.
   Выполняется один раз от имени администратора кластера.
2. **`scripts/sql/01_schema.sql`** — создаёт все таблицы, индексы, внешние ключи, выдаёт права `srs_app`
   и загружает справочник языков. Выполняется от имени владельца базы `srs_context`.

> ⚠️ Перед выполнением отредактируйте скрипты, если у вас другие имена БД/пользователя,
> и **обязательно замените** `CHANGE_ME_STRONG_PASSWORD` на реальный пароль.

### Вариант А — через psql с локальной машины (если открыт сетевой доступ)

```powershell
# 1) создание БД и пользователя (от администратора кластера)
psql "postgresql://ADMIN:PASSWORD@DB_HOST:5432/postgres" -f scripts\sql\create_database.sql

# 2) создание таблиц в новой базе
psql "postgresql://ADMIN:PASSWORD@DB_HOST:5432/srs_context" -f scripts\sql\01_schema.sql
```

### Вариант Б — на самом сервере

```bash
sudo -u postgres psql -f create_database.sql
sudo -u postgres psql -d srs_context -f 01_schema.sql
```

### Быстрая проверка без psql (после заполнения .env)

```powershell
npm run db:check
```

Скрипт подключится к БД по `DATABASE_URL`, покажет версию сервера и список таблиц.

### Если подключение не проходит

- убедитесь, что PostgreSQL слушает внешний интерфейс: `listen_addresses = '*'` в `postgresql.conf`;
- в `pg_hba.conf` должен быть пункт для вашего IP, например:
  `host  srs_context  srs_app  ВАШ_IP/32  scram-sha-256`, затем `reload` конфигурации;
- порт `5432` должен быть открыт в firewall / security group;
- при использовании managed-сервисов (Yandex Cloud, Supabase и т.п.) просто возьмите
  готовую `DATABASE_URL` из панели управления и выполните только `01_schema.sql`
  (БД и пользователь там уже созданы).

---

## 4. Запуск в VS Code

### Способ 1 — терминал

```powershell
npm run dev
```

Откроется http://localhost:3000 (Express + Vite в middleware-режиме, HMR включён).
При старте автоматически проверяется подключение к PostgreSQL (отключается
переменной `CHECK_DB_ON_STARTUP=false`).

### Способ 2 — отладка с точками останова

Нажмите `F5` (конфигурация **«Dev: сервер + клиент»** в `.vscode/launch.json`) —
сервер запустится под отладчиком Node.js, после старта автоматически откроется
Chrome с активным debug. Для подключения к уже запущенному процессу используйте
конфигурацию «Attach» (запустите вручную с флагом `--inspect`).

### Полезные команды

| Команда | Назначение |
|---|---|
| `npm run dev` | dev-сервер (клиент + API) |
| `npm run db:check` | проверка подключения к PostgreSQL |
| `npm run lint` | проверка типов TypeScript |
| `npm run build` | production-сборка клиента в `dist/` |
| `npm start` | запуск собранного приложения (`NODE_ENV=production`) |

Все команды продублированы в Tasks VS Code: `Ctrl+Shift+B` / Terminal → Run Task.

---

## 5. Первый запуск приложения

- Данные сейчас хранятся в JSON-файле `data/db.json` (автоматически создаётся
  и засевается словарями при первом запуске). Пользователь, зарегистрированный
  первым, получает права администратора.
- SQL-скрипты из раздела 3 создают **зеркальную схему в PostgreSQL** — она готова
  к миграции приложения на pg-драйвер (`pg` уже добавлен в зависимости).
  Пока приложение работает с JSON-хранилищем, `DATABASE_URL` используется
  для проверки связи и последующего переезда.

---

## 6. Структура добавленных файлов

```
.vscode/                 задачи, запуск отладки, рекомендации расширений VS Code
scripts/load-env.mjs     загрузчик .env для npm-скриптов (без сторонних зависимостей)
scripts/check-db.mjs     проверка подключения к PostgreSQL (npm run db:check)
scripts/sql/create_database.sql  создание БД и пользователя
scripts/sql/01_schema.sql        создание таблиц, прав и базового seed
```
