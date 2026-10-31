'use strict';

/**
 * Service Transkrip - resource internal (port 3002, TIDAK diekspos ke host).
 *
 * Menerima GET /transkrip/:nim untuk mahasiswa/admin dan
 * POST /transkrip/sinkron hanya dari service-nilai melalui gateway.
 */

require('dotenv').config({ quiet: true });

const express = require('express');

const config = require('./config');
const prisma = require('./lib/prisma');
const { verifyGatewayRequest } = require('./middleware/verify-gateway');
const transkripRoutes = require('./routes/transkrip');

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

/**
 * GET /health
 *
 * Dikecualikan dari X-Gateway-Secret + JWT untuk Docker healthcheck.
 *
 * @route   GET /health
 * @access  Internal network only
 * @returns {void} 200 - { status: 'ok', service: 'service-transkrip', phase: 'phase-3' }
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'service-transkrip',
    phase: 'phase-3',
  });
});

app.use(verifyGatewayRequest);

app.use('/transkrip', transkripRoutes);

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

  console.error('[service-transkrip] unhandled error:', error);
  return res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[service-transkrip] listening on http://0.0.0.0:${config.port}`);
});

async function shutdown(signal) {
  console.log(`[service-transkrip] received ${signal}, shutting down...`);

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
