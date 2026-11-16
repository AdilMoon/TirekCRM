#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_password="$TIREK_APP_PASSWORD" <<'SQL'
CREATE ROLE tirek LOGIN PASSWORD :'app_password';
ALTER DATABASE tirek OWNER TO tirek;
SQL
