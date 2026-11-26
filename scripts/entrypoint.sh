#!/bin/sh
set -eu

MAX_ATTEMPTS=30
ATTEMPT=1

echo "Waiting for database and running Prisma migrations..."
until ./node_modules/.bin/prisma migrate deploy; do
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "Database migrations failed after $MAX_ATTEMPTS attempts."
    exit 1
  fi
  echo "Database not ready yet (attempt $ATTEMPT/$MAX_ATTEMPTS), retrying in 2s..."
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done

echo "Seeding database..."
node dist/seed.js

exec node dist/index.js
