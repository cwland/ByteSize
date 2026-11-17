#!/bin/sh
# Starts the server as the unprivileged "node" user. Started as root (the default), it first makes
# sure node owns the data folder: a bind-mounted or older volume can arrive owned by root.
# A folder whose owner can't be changed (an NFS share, a read-only mount) only gets a warning:
# the server still starts, and says so if it later can't write there.
set -e
if [ "$(id -u)" = "0" ]; then
  # Only walk the whole folder when its top isn't node's already (keeps restarts fast)
  if [ "$(stat -c %U /app/data 2>/dev/null || echo unknown)" != "node" ]; then
    chown -R node:node /app/data 2>/dev/null || echo "ByteSize: couldn't change the owner of /app/data to node; if saving photos or backups fails, fix the folder's permissions on the server" >&2
  fi
  exec setpriv --reuid=node --regid=node --init-groups node dist/index.js "$@"
fi
exec node dist/index.js "$@"
