#!/usr/bin/env node
/*
 * Build-time guard: refuse to build the `production` EAS profile while it
 * still points at a staging backend.
 *
 * Why this exists: a store build wired to staging would write real drivers'
 * GPS traces, chat and delivery paperwork into the staging database — and
 * read their loads back out of it. `development`, `preview` and `testflight`
 * are all meant to run against staging; only `production` must not.
 *
 * The check is a substring match on "staging", which is why the hostname
 * scheme matters: staging is auth-staging/api-staging.gethitchlink.com and
 * production drops the suffix (auth/api.gethitchlink.com). Renaming the
 * staging hosts to something without "staging" in them silently disarms this.
 *
 * Runs on EAS Build via the `eas-build-pre-install` npm script. EAS sets
 * EAS_BUILD_PROFILE, so this only ever fails the production profile; local
 * `npm install` and development/preview builds are untouched.
 */
const fs = require('fs');
const path = require('path');

const GUARDED_PROFILE = 'production';
const FORBIDDEN = 'staging';
const VARS = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_API_MAIN_URL'];

const profile = process.env.EAS_BUILD_PROFILE;
if (profile !== GUARDED_PROFILE) process.exit(0);

let env = {};
try {
  const easPath = path.join(__dirname, '..', 'eas.json');
  env = JSON.parse(fs.readFileSync(easPath, 'utf8'))?.build?.[GUARDED_PROFILE]?.env ?? {};
} catch (err) {
  console.error(`[check-prod-backend] Could not read eas.json: ${err.message}`);
  process.exit(1);
}

// Prefer the value the build is actually running with; fall back to eas.json.
const offenders = VARS
  .map((name) => ({ name, value: process.env[name] || env[name] || '' }))
  .filter(({ value }) => value.toLowerCase().includes(FORBIDDEN));

if (offenders.length === 0) process.exit(0);

console.error(`
╭──────────────────────────────────────────────────────────────────╮
│  BUILD BLOCKED — production profile is pointed at STAGING        │
╰──────────────────────────────────────────────────────────────────╯

${offenders.map(({ name, value }) => `  ${name}\n    ${value}`).join('\n')}

A production build must not talk to the staging backend: it would put real
driver GPS, chat and delivery paperwork into the staging database.

Fix: set the real production URLs in eas.json under build.production.env,
then rebuild. If you genuinely intend to ship against staging (internal
testing only), use the "preview" profile instead of "production".
`);
process.exit(1);
