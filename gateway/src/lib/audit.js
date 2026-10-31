'use strict';

const prisma = require('./prisma');

function clip(value, maxLength) {
  return String(value ?? '').slice(0, maxLength);
}

/**
 * Menulis audit log untuk setiap keputusan akses.
 *
 * Nilai diklip agar input pengguna tidak dapat membuat baris audit sangat besar.
 * Fungsi mengembalikan false bila penulisan gagal; pemanggil yang memutuskan
 * apakah request harus fail-closed (503).
 */
async function recordAudit({ subject, endpoint, device, decision, reason }) {
  try {
    await prisma.auditLog.create({
      data: {
        subjek: clip(subject || 'anonymous', 200),
        endpoint: clip(endpoint || '-', 300),
        device: device ? clip(device, 200) : null,
        keputusan: decision,
        alasan: clip(reason || '-', 300),
      },
    });
    return true;
  } catch (error) {
    console.error('[gateway][audit] gagal menulis audit log:', error.message);
    return false;
  }
}

module.exports = { recordAudit };
