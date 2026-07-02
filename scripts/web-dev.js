#!/usr/bin/env node
/*
 * Web dev launcher.
 *
 * Why this exists: in a browser the app is subject to CORS, and the Railway
 * backends don't send Access-Control-Allow-Origin headers, so every API call
 * from http://localhost is blocked. Native builds (APK / iOS) don't do CORS
 * checks, so they call Railway directly and need none of this.
 *
 * This script starts two tiny pass-through proxies that forward to the Railway
 * services and add the missing CORS headers, then launches `expo start --web`.
 * The app sends web traffic to these proxies (see src/api/config.js).
 *
 *   npm run web                 -> proxies + expo web (default port 8081)
 *   npm run web -- --port 8090  -> extra args are passed through to expo
 */
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read EXPO_PUBLIC_* from .env so the proxy targets always match the app config.
function loadEnv() {
  const env = {};
  try {
    const file = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of file.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

const env = loadEnv();
const TARGETS = [
  { port: 8788, origin: env.EXPO_PUBLIC_API_BASE_URL || 'https://dspidentity-staging.up.railway.app' },
  { port: 8789, origin: env.EXPO_PUBLIC_API_MAIN_URL || 'https://dspmain-staging.up.railway.app' },
];

function makeProxy(targetOrigin) {
  const target = new URL(targetOrigin);
  return http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':
        req.headers['access-control-request-headers'] || 'Content-Type,Authorization',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const headers = { ...req.headers, host: target.host };
    delete headers.origin;
    delete headers.referer;

    const upstream = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        method: req.method,
        path: req.url,
        headers,
      },
      (up) => {
        res.writeHead(up.statusCode, { ...up.headers, ...cors });
        up.pipe(res);
      }
    );
    upstream.on('error', (e) => {
      res.writeHead(502, cors);
      res.end(JSON.stringify({ message: 'Proxy error: ' + e.message }));
    });
    req.pipe(upstream);
  });
}

for (const t of TARGETS) {
  makeProxy(t.origin).listen(t.port, () => {
    console.log(`CORS proxy  http://localhost:${t.port}  ->  ${t.origin}`);
  });
}

// Launch Expo web; forward any extra CLI args (e.g. --port 8090).
const extra = process.argv.slice(2);
const expo = spawn('npx', ['expo', 'start', '--web', ...extra], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
expo.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => {
  expo.kill('SIGINT');
  process.exit(0);
});
