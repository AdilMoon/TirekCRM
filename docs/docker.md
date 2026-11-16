# Локальный запуск TirekCRM в Docker

Запустите Docker Desktop с Linux-контейнерами. Из корня TirekCRM выполните:

```powershell
npm run docker:up
```

Для этой команды достаточно Docker Compose и Node.js 22.18 или новее. Зависимости приложения устанавливаются внутри сборки. `docker:up` создаёт `.local/docker.env` один раз, собирает образ, запускает PostgreSQL и применяет миграции перед стартом API. Дождитесь завершения команды.

## HTTPS и вход

На Windows один раз добавьте сертификат именно своего Docker-профиля в хранилище текущего пользователя:

```powershell
docker compose --env-file .local/docker.env cp caddy:/data/caddy/pki/authorities/local/root.crt .local/tirek-docker-ca.crt
certutil.exe -user -addstore Root .local/tirek-docker-ca.crt
```

Откройте [регистрацию компании](https://localhost:9443/register) и создайте аккаунт владельца. Затем входите на [https://localhost:9443](https://localhost:9443) с этим аккаунтом. Через `TIREK_DOCKER_HTTPS_PORT` в `.local/docker.env` можно выбрать другой свободный порт, например 9444. Этот профиль рассчитан на работу с того же компьютера.

## Контейнеры и данные

- Caddy публикует HTTPS на `127.0.0.1:9443`. PostgreSQL доступен API и миграциям по внутренней сети. У приложения отдельная роль PostgreSQL без прав суперпользователя.
- Docker использует отдельную базу в томе `tirekcrm-docker_postgres_data`. На первом запуске она пустая. База обычной версии на `127.0.0.1:5432` и Docker-версия хранят данные отдельно. Сохраняйте `.local/docker.env` вместе с резервными копиями Docker-базы, так как PostgreSQL использует пароль, созданный при инициализации тома.
- Остановить контейнеры и сохранить данные можно командой `docker compose --env-file .local/docker.env stop`. Повторный запуск — `npm run docker:up`. Флаг `down -v` удаляет данные и сертификат Docker-профиля.
- Для просмотра статуса выполните `docker compose --env-file .local/docker.env ps -a`. У контейнера `migrate` после успешного применения миграций статус `Exited (0)`. [Проверка API и базы](https://localhost:9443/api/health) должна вернуть `{"status":"ok","service":"tirek-api"}`.

## Telegram и почта

Новый Docker-профиль запускается с выключенными внешними интеграциями. Для Telegram задайте `TIREK_DOCKER_TELEGRAM_DELIVERY=telegram` и `TIREK_DOCKER_TELEGRAM_BOT_TOKEN` в `.local/docker.env`. У токена должен быть один работающий обработчик. Если обычная версия использует текущий токен, используйте отдельного бота для Docker. Сотрудник привязывает Telegram в той копии CRM, где ему назначают задачи.

Для Gmail задайте `TIREK_DOCKER_MAIL_DELIVERY=gmail`, `TIREK_DOCKER_GMAIL_USER` и `TIREK_DOCKER_GMAIL_APP_PASSWORD`. Ключ `TIREK_DOCKER_MAIL_ENCRYPTION_KEY` создаётся автоматически. После изменения настроек снова выполните `npm run docker:up`.
