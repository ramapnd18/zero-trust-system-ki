'use strict';

const config = require('../config');

/**
 * Fetch JSON dengan timeout. Dipakai HANYA untuk memanggil gateway internal,
 * tidak pernah langsung ke service-transkrip.
 */
async function postJson(path, body, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gatewayTimeoutMs);

  try {
    const response = await fetch(`${config.gatewayInternalUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return { ok: response.ok, status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function requestServiceToken() {
  const result = await postJson('/auth/service', {
    client_id: config.serviceClientId,
    client_secret: config.serviceClientSecret,
  });

  if (!result.ok || !result.body || typeof result.body.access_token !== 'string') {
    const error = new Error(`Gagal memperoleh service token (status ${result.status})`);
    error.status = result.status;
    throw error;
  }

  return result.body.access_token;
}

async function syncTranscript(payload) {
  const serviceToken = await requestServiceToken();
  const result = await postJson('/transkrip/sinkron', payload, {
    Authorization: `Bearer ${serviceToken}`,
  });

  if (!result.ok) {
    const error = new Error(`Sinkronisasi transkrip gagal (status ${result.status})`);
    error.status = result.status;
    error.body = result.body;
    throw error;
  }

  return result.body;
}

module.exports = {
  requestServiceToken,
  syncTranscript,
};
