#!/bin/sh
set -eu

# Bootstrap database dilakukan SATU KALI di gateway sebelum menerima request.
# Untuk production, pertimbangkan menjalankan migrasi sebagai job terpisah
# agar container gateway tidak memegang hak tulis schema.
echo "[gateway] applying database migrations..."
npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[gateway] running idempotent seed..."
  node prisma/seed.js
fi

echo "[gateway] starting API gateway..."
exec node src/index.js
