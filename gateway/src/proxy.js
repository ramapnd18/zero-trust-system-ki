'use strict';

const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const config = require('./config');

function makeProxy(target, pathFilter) {
  return createProxyMiddleware({
    target,
    pathFilter,
    changeOrigin: false,
    xfwd: false,
    proxyTimeout: config.proxyTimeoutMs,
    timeout: config.proxyTimeoutMs,
    on: {
      proxyReq(proxyReq, req) {
        // Selalu timpa header dari client; client tidak boleh memalsukan secret.
        proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret);

        // Body sudah dikonsumsi express.json(); rekonstruksi body untuk upstream.
        fixRequestBody(proxyReq, req);
      },
      error(error, req, res) {
        console.error(
          `[gateway][proxy] ${req.method} ${req.originalUrl} -> ${target} gagal: ${error.message}`,
        );

        if (res.headersSent) {
          res.end();
          return;
        }

        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'bad_gateway', reason: 'upstream_unavailable' }));
      },
    },
  });
}

module.exports = {
  nilaiProxy: makeProxy(config.serviceNilaiUrl, ['/nilai', '/kelas']),
  transkripProxy: makeProxy(config.serviceTranskripUrl, ['/transkrip']),
};
