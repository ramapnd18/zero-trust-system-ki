'use strict';

/**
 * API Gateway - SATU-SATUNYA entry point publik.
 *
 * Bertanggung jawab sebagai PEP/PE-PA:
 *  - autentikasi JWT + device context
 *  - policy role/ABAC + jam operasional
 *  - audit setiap keputusan akses
 *  - proxy ke resource service dengan X-Gateway-Secret
 */

require('dotenv').config({ quiet: true });

const express = require('express');

const config = require('./config');
const prisma = require('./lib/prisma');
const authRoutes = require('./routes/auth');
const { authenticate, isProtectedPath } = require('./middleware/authenticate');
const { enforcePolicy } = require('./policy');
const { nilaiProxy, transkripProxy } = require('./proxy');
const { describeOperationalWindow } = require('./lib/time');

const app = express();

app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '100kb' }));

/**
 * GET /health
 *
 * Liveness/readiness probe gateway. Dikecualikan dari autentikasi agar dapat
 * dipakai Docker healthcheck dan monitoring.
 *
 * @route   GET /health
 * @access  Public
 * @returns {void} 200 - { status: 'ok', service: 'gateway', phase: 'phase-2-3' }
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'gateway',
    phase: 'phase-2-3',
  });
});

app.use('/auth', authRoutes);

// Autentikasi + policy hanya untuk resource service. Auth/health tidak masuk.
app.use((req, res, next) => {
  if (!isProtectedPath(req.path)) return next();
  return authenticate(req, res, next);
});

app.use((req, res, next) => {
  if (!isProtectedPath(req.path)) return next();
  return enforcePolicy(req, res, next);
});

// Policy sudah memanggil next() hanya untuk request yang diizinkan.
app.use(nilaiProxy);
app.use(transkripProxy);

/**
 * Fallback 404 untuk path yang tidak terdaftar.
 *
 * @route   ANY *
 * @access  Public
 * @returns {void} 404 - { error: 'not_found' }
 */
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Error handler terpusat; jangan bocorkan stack/internal detail ke client.
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_json' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  console.error('[gateway] unhandled error:', error);
  return res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[gateway] listening on http://0.0.0.0:${config.port}`);
  console.log(`[gateway] jam operasional perubahan/finalisasi: ${describeOperationalWindow()}`);
});

async function shutdown(signal) {
  console.log(`[gateway] received ${signal}, shutting down...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
