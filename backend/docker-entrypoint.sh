#!/bin/sh
# Starts the server as the unprivileged "node" user. Started as root (the default), it first makes
# sure node owns the data folder: a bind-mounted or older volume can arrive owned by root.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data
  exec setpriv --reuid=node --regid=node --init-groups node dist/index.js "$@"
fi
exec node dist/index.js "$@"
