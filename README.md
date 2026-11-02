# Tirek CRM
CRM для малого бизнеса Казахстана. Рабочая локальная версия на NestJS, PostgreSQL и Next.js.

Приватный GitHub: [AdilMoon/TirekCRM](https://github.com/AdilMoon/TirekCRM). Порядок коммитов и проверок — в [git-workflow.md](docs/git-workflow.md).

## Быстрый старт
Откройте терминал в корне своей копии **TirekCRM**. На новом компьютере с Windows:
```sh
npm ci
npm run setup
npm run https:setup
certutil.exe -user -addstore Root .local/caddy/pki/authorities/local/root.crt
npm run db:local
```
Оставьте базу запущенной. Во втором терминале:
```sh
npm run db:migrate
npm run db:seed
npm run dev:https
```
Сайт: https://localhost:8443. [Локальный TLS, доверие сертификату и проверки](docs/https.md).
Демо-вход после seed: owner@tirek.local; начальный пароль TirekDemo2026! (см. .env).
На текущем компьютере база и зависимости уже настроены. Seed не очищает данные.

Можно также создать пустую компанию через [форму регистрации](https://localhost:8443/register). В production она по умолчанию закрыта; конфигурация и ограничения описаны в [company-onboarding.md](docs/company-onboarding.md).

## Структура
```text
TirekCRM/
├── backend/         NestJS: API, бизнес-правила, Prisma, миграции
├── frontend/        Next.js: страницы, компоненты, переводы
├── packages/        Общие контракты API и схемы проверки
├── docs/            Архитектура, запуск, план развития
├── tests/           Интеграционные и браузерные проверки
├── scripts/         Запуск, настройка, проверка структуры
├── .local/          Локальная база и результаты проверок (не в Git)
└── node_modules/    Установленные зависимости (не в Git)
```

## Возможности
Русский, қазақша, English; создание компании и первого аккаунта владельца; первые шаги в пустом пространстве; сохранение языка; клиенты с реквизитами и защитой одновременного редактирования; поиск и страницы клиентов/заказов; редактирование открытых заказов; история действий; команда и одноразовые приглашения; задачи с исполнителями, сроками и обсуждениями; личные уведомления о назначениях, статусах и комментариях; заказы; частичные оплаты; расходы; сводка; настройки предприятия; смена пароля и управление своими сеансами; неизменяемые снимки счетов на оплату и актов с печатью/PDF. Даты: Asia/Almaty, валюта: KZT.
Счета и акты являются черновиками без ЭЦП и расчёта НДС. Денежный поток не является бухгалтерской прибылью. ИИ и отдельное мобильное приложение ещё не реализованы.

## Документация
- [Функциональные блоки продукта — Word-отчет](docs/reports/functional-blocks-2026-10-24.docx), [текстовый исходник](docs/reports/functional-blocks-2026-10-24.md)
- [Запуск и проверки](docs/development.md)
- [Архитектура и правила размещения файлов](docs/architecture.md)
- [API, поиск и защита изменений](docs/backend-api.md)
- [Команда, права, приглашения и задачи](docs/team-and-tasks.md)
- [Обсуждения задач](docs/task-discussions.md)
- [Личные уведомления](docs/notifications.md)
- [Реквизиты и счета на оплату](docs/document-workflow.md)
- [Финансовые отчёты, CSV-экспорт и документы](docs/financial-reports.md)
- [Создание компании и первые шаги](docs/company-onboarding.md)
- [Безопасность аккаунта и сеансы](docs/account-security.md)
- [Правила локализации](docs/localization.md)
- [План выхода к пилоту](docs/roadmap.md)
- [Изменения](docs/changelog.md)

Перед завершением изменения выполните npm run check:structure, npm run typecheck, npm test и npm run build. Проверки API и браузера требуют запущенных серверов; подробности в docs/development.md.
