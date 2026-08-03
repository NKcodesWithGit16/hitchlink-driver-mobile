// Mirror of HitchLink_frontend/src/lib/storeLinks.js. Two small copies rather
// than a shared package, because the repos have no shared build — keep them in
// step, especially STORE_LIVE on launch day.

export const ANDROID_PACKAGE = 'com.nk16.hitchlinkdriver';
export const IOS_APP_ID = '6794002673';

export const PLAY_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
export const APP_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_ID}`;

// Both ids are real; the listings aren't published yet, so the URLs 404.
// false → don't offer a store link at all. 'search' → submitted, awaiting review.
// true → live. Flip in this file AND its web twin.
export const STORE_LIVE = { ios: false, android: false };
