'use strict';

const config = require('../config');

/**
 * Jam lokal pada timezone operasional (default Asia/Jakarta).
 * Tidak bergantung pada timezone proses Node.
 */
function getLocalHour(date = new Date(), timeZone = config.timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === 'hour');
  if (!hour) throw new Error('Gagal membaca jam lokal');
  return Number.parseInt(hour.value, 10);
}

/**
 * Interval [start, end): 07.00 diizinkan, 21.00 ditolak.
 */
function isWithinOperationalHours(date = new Date()) {
  const hour = getLocalHour(date);
  return hour >= config.operationalStartHour && hour < config.operationalEndHour;
}

function describeOperationalWindow() {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(config.operationalStartHour)}:00-${pad(config.operationalEndHour)}:00 ${config.timezone}`;
}

module.exports = {
  getLocalHour,
  isWithinOperationalHours,
  describeOperationalWindow,
};
