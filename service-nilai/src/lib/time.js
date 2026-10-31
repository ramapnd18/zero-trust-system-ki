'use strict';

const config = require('../config');

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
 * Service-nilai memeriksa ulang jam operasional (defense in depth), bukan
 * hanya mengandalkan gateway.
 */
function isWithinOperationalHours(date = new Date()) {
  const hour = getLocalHour(date);
  return hour >= config.operationalStartHour && hour < config.operationalEndHour;
}

module.exports = { getLocalHour, isWithinOperationalHours };
