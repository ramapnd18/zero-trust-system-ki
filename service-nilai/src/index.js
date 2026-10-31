'use strict';

/**
 * Service Nilai - resource internal (port 3001, TIDAK diekspos ke host).
 *
 * Setiap request (selain /health) wajib membawa X-Gateway-Secret yang benar
 * dan JWT yang valid. Service memverifikasi ulang keduanya secara independen.
 */

require('dotenv').config({ quiet: true });

const express = require('express');

const config = require('./config');
const prisma = require('./lib/prisma');
const { verifyGatewayRequest } = require('./middleware/verify-gateway');
const nilaiRoutes = require('./routes/nilai');
const kelasRoutes = require('./routes/kelas');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

/**
 * GET /health
 *
 * Dikecualikan dari X-Gateway-Secret + JWT agar Docker healthcheck dapat
 * berjalan. Port 3001 hanya ada di network internal zt-network.
 *
 * @route   GET /health
 * @access  Internal network only
 * @returns {void} 200 - { status: 'ok', service: 'service-nilai', phase: 'phase-3' }
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'service-nilai',
    phase: 'phase-3',
  });
});

app.use(verifyGatewayRequest);

app.use('/nilai', nilaiRoutes);
app.use('/kelas', kelasRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_request', reason: 'invalid_json' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  console.error('[service-nilai] unhandled error:', error);
  return res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[service-nilai] listening on http://0.0.0.0:${config.port}`);
});

async function shutdown(signal) {
  console.log(`[service-nilai] received ${signal}, shutting down...`);

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
