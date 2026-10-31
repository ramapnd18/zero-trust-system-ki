'use strict';

const { isWithinOperationalHours } = require('../lib/time');

/**
 * Defense in depth: service menolak perubahan/finalisasi di luar jam operasional
 * meskipun gateway sudah memeriksanya.
 */
module.exports = function requireOperationalHours(_req, res, next) {
  if (!isWithinOperationalHours()) {
    return res.status(403).json({
      error: 'forbidden',
      reason: 'outside_operational_hours',
    });
  }
  return next();
};
