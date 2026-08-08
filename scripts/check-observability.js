#!/usr/bin/env node
/*
 * Build-time warning: a store-bound build with no Sentry DSN ships blind.
 *
 * src/lib/observability.js is deliberately opt-in — with no
 * EXPO_PUBLIC_SENTRY_DSN it is a no-op, which is the right behaviour for a
 * checkout with no Sentry account. The failure mode is that the same silence
 * looks identical on a build you're about to hand to real drivers, and a crash
 * in a truck at 3am then leaves no trace beyond what the driver can describe
 * over the phone.
 *
 * This WARNS rather than fails, unlike check-prod-backend.js. Pointing a
 * production build at staging corrupts real data; missing telemetry only costs
 * you visibility, and blocking a release over it would be the wrong trade at
 * the wrong moment.
 *
 * Fix: `eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN
 * --value https://…@…ingest.sentry.io/…` — a secret rather than an eas.json
 * entry, so it applies to every profile at once and isn't committed.
 *
 * Runs on EAS Build via the `eas-build-pre-install` npm script.
 */
const WATCHED_PROFILES = ['production', 'testflight', 'preview'];

const profile = process.env.EAS_BUILD_PROFILE;
if (!WATCHED_PROFILES.includes(profile)) process.exit(0);

if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  console.log('[check-observability] Sentry DSN present — crash reporting is live.');
  process.exit(0);
}

// Box drawn to a fixed inner width so the right edge lines up whatever the
// profile is called — a hard-coded pad only ever suits one profile name.
const WIDTH = 66;
const headline = `  WARNING — building "${profile}" with NO crash reporting`;
const pad = ' '.repeat(Math.max(0, WIDTH - headline.length));

console.warn(`
╭${'─'.repeat(WIDTH)}╮
│${headline}${pad}│
╰${'─'.repeat(WIDTH)}╯

  EXPO_PUBLIC_SENTRY_DSN is not set, so src/lib/observability.js is a no-op
  and this build will report nothing when it crashes in the field.

  eas secret:create --scope project \\
    --name EXPO_PUBLIC_SENTRY_DSN --value <your-dsn>

  Building anyway.
`);
process.exit(0);
