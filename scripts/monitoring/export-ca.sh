#!/bin/sh
set -eu
for attempt in $(seq 1 30); do
  if [ -s /source/caddy/pki/authorities/local/root.crt ]; then
    cp /source/caddy/pki/authorities/local/root.crt /trust/root.crt
    chmod 444 /trust/root.crt
    exit 0
  fi
  sleep 1
done
echo "Caddy public CA certificate is not ready" >&2
exit 1
