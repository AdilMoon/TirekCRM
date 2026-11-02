# Локальный HTTPS

Профиль `npm run dev:https` открывает TirekCRM по **https://localhost:8443**.
Caddy завершает TLS и передаёт запросы Next.js на `127.0.0.1:3000`; существующий
Next.js rewrite передаёт `/api` NestJS на `127.0.0.1:4000`. Весь незашифрованный
внутренний трафик остаётся на loopback этого компьютера. WebSocket обновления Next.js
проходят через тот же прокси. HTTP на **http://localhost:8080** возвращает 308 на
фиксированный HTTPS-адрес с сохранением пути и query; адрес не берётся из Host.

## Подготовка Windows

Из корня своей копии репозитория, после установки Node.js 22.18+:

```sh
npm ci
npm run setup
npm run https:setup
```

Последняя команда скачивает официальный Caddy **2.11.7**, проверяет закреплённый
SHA-512 архива и извлекает только `caddy.exe` в `.local/tools/caddy`. Поддерживаются
Windows x64 и ARM64; нужен штатный `tar.exe`. Глобальная установка программ и
изменение политики выполнения PowerShell не нужны. Повторная подготовка использует
проверенный архив. Обновление Caddy требует обновить версию и обе контрольные суммы.

При проверке конфигурации создаётся отдельный CA этой копии проекта. Один раз добавьте
его **публичный** сертификат в доверенное хранилище текущего пользователя Windows:

```powershell
certutil.exe -user -addstore Root .local/caddy/pki/authorities/local/root.crt
```

Проверить имя перед установкой можно командой
`certutil.exe -dump .local/caddy/pki/authorities/local/root.crt`: ожидается
`TirekCRM Local Development CA`. Caddy не устанавливает доверие автоматически.
Edge/Chrome используют системное доверие; после установки при необходимости
перезапустите браузер. Другой пользователь Windows, другая копия проекта или браузер
с отдельным хранилищем требуют собственной настройки доверия. Не отключайте проверку
сертификата браузером и не используйте `NODE_TLS_REJECT_UNAUTHORIZED=0`.

CA может подписывать сертификаты, поэтому его закрытый ключ необходимо хранить
локально. Весь каталог `.local/caddy` (ключи CA, сертификаты и состояние обновления)
исключён из Git. Не копируйте его в облако и не передавайте другим людям. При удалении
этой копии проекта удалите из доверенного хранилища именно её сертификат по отпечатку;
отпечаток можно получить через `certutil.exe -dump`.

## Запуск

Если локальная БД ещё не запущена, в отдельном терминале:

```sh
npm run db:local
```

В основном терминале:

```sh
npm run db:migrate
npm run dev:https
```

Откройте https://localhost:8443. Для новой пустой БД доступна `/register`;
демонстрационные данные создаются только отдельной командой `npm run db:seed`, если
они нужны. Остановка профиля — Ctrl+C; база останавливается отдельно. Не запускайте
`npm run dev` параллельно. Занятые порты 3000/4000/8080/8443 приводят к отказу запуска,
чтобы прокси не открыл другое приложение.

Профиль передаёт дочерним процессам `WEB_ORIGIN=https://localhost:8443`, фиксированные
локальные адреса API и порты. Редактировать `.env` для переключения не требуется.
Сессии получают `Secure`, `HttpOnly`, `SameSite=Lax`. Origin проверяется строго:
мутации с HTTP-адресов, другим портом или чужим сайтом отклоняются. Cookie и Origin
не зависят от недоверенных `X-Forwarded-*`; `trustProxy` остаётся выключенным.

Сертификаты localhost выпускаются и обновляются локальным CA, а не Let's Encrypt.
Открытых наружу слушателей и административного API Caddy нет. В локальном профиле
не выдаётся HSTS: он распространяется на hostname независимо от порта и мешал бы
отдельному HTTP-профилю `npm run dev` на 3000. Эти внутренние HTTP-порты доступны
локальным процессам; HTTPS-профиль не является изоляцией от других программ этого ПК.

На Linux/macOS установите Caddy по официальной инструкции и настройте доверие к
`.local/caddy/pki/authorities/local/root.crt` средствами своей ОС. Установщик
`https:setup` предназначен только для Windows; запуск профиля кроссплатформенный.

## Проверки

При запущенных БД и `dev:https`:

```sh
npm run test:https
```

Тест использует публичный root.crt как явный доверенный CA: проверяет цепочку и имя,
TLS 1.2/1.3, отказ TLS 1.1, HTTP-редирект, HTML, API, no-store, отсутствие локального
HSTS и отклонение HTTP/чужих Origin. Модульные тесты проверяют флаги реальной cookie
и CSRF-политику независимо от подложных forwarded-заголовков.

Обычные интеграционные проверки можно направить через TLS в PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path '.local/caddy/pki/authorities/local/root.crt').Path
$env:TEST_API_URL = 'https://localhost:8443/api'
$env:WEB_ORIGIN = 'https://localhost:8443'
npm run test:integration
```

Переменные действуют только в этом терминале. Успешные проверки не заменяют аудит
всего приложения. Публичный HTTPS для домена/сервера требует отдельного профиля
развёртывания; текущий предназначен для этого компьютера.

Браузерный сценарий регистрации через установленный Edge, с проверкой системного
доверия сертификату (без `ignoreHTTPSErrors`) и флага `Secure`:

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path '.local/caddy/pki/authorities/local/root.crt').Path
$env:TEST_WEB_URL = 'https://localhost:8443'
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e -- tests/browser/onboarding.spec.ts
```

Источники: [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[локальный CA и skip_install_trust](https://caddyserver.com/docs/caddyfile/options),
[TLS defaults](https://caddyserver.com/docs/caddyfile/directives/tls),
[официальный выпуск Caddy](https://github.com/caddyserver/caddy/releases/tag/v2.11.7).
