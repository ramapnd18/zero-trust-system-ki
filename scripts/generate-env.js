#!/usr/bin/env node
'use strict';

/**
 * Membuat .env dari .env.example dengan secret acak.
 * Aman dijalankan ulang dengan flag --force (akan menimpa .env).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');

if (!fs.existsSync(examplePath)) {
  console.error('[env] .env.example tidak ditemukan.');
  process.exit(1);
}

if (fs.existsSync(envPath) && !force) {
  console.error('[env] .env sudah ada. Gunakan --force untuk menimpa.');
  process.exit(1);
}

let content = fs.readFileSync(examplePath, 'utf8');

const replacements = {
  CHANGE_ME_JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  CHANGE_ME_GATEWAY_SECRET: crypto.randomBytes(48).toString('hex'),
  CHANGE_ME_SERVICE_CLIENT_SECRET: crypto.randomBytes(48).toString('hex'),
};

for (const [placeholder, secret] of Object.entries(replacements)) {
  content = content.split(placeholder).join(secret);
}

fs.writeFileSync(envPath, content, { mode: 0o600 });
console.log('[env] .env berhasil dibuat dengan secret acak.');
console.log('[env] File ini gitignored. Jangan pernah commit isinya.');
