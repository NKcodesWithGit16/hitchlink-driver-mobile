import { AsYouType, Metadata, parsePhoneNumberFromString } from "libphonenumber-js";
import { dialFor } from "../data/countries";

/**
 * Phone numbers, in one place.
 *
 * Mirrors HitchLink_frontend/src/lib/phone.js. Separate repos, no shared
 * package — keep the two in step by hand, and if the rules ever diverge the
 * server is the one that decides (see Identity PhoneNumberRules).
 *
 * Everything here works in two halves — an ISO country code ("US", "GE") and the
 * national number as the user typed it — because that is what the UI shows. The
 * wire format is E.164 (`+15551234567`), produced only at submit.
 *
 * The country is stored as ISO rather than dial code because dial codes are not
 * unique: +1 is the US *and* Canada, +7 is Russia *and* Kazakhstan. Given only
 * "+1" there is no way back to a country, and therefore no way to validate a
 * length or format the number.
 */

/** Sensible default for a US trucking platform, and what the old 10-digit rule assumed. */
export const DEFAULT_COUNTRY = "US";

/** Cheap, and called on every keystroke — the answer per country never changes. */
const maxLengthCache = new Map();

/**
 * The most digits a national number can have in this country: 9 for Georgia,
 * 10 for the US, 10 for the UK (which also allows 7 and 9).
 *
 * Falls back to E.164's own ceiling of 15 for anything the metadata doesn't
 * cover, so an unrecognised country still gets a bound rather than none.
 */
export function maxNationalDigits(country) {
    const key = country || DEFAULT_COUNTRY;
    if (maxLengthCache.has(key)) return maxLengthCache.get(key);

    let max = 15;
    try {
        const metadata = new Metadata();
        metadata.selectNumberingPlan(key);
        const lengths = metadata.numberingPlan?.possibleLengths();
        // Ascending, and a country can have several — take the longest, since a
        // shorter one is still a number someone might be part-way through.
        if (lengths?.length) max = lengths[lengths.length - 1];
    } catch {
        // Unknown numbering plan. 15 stands.
    }

    maxLengthCache.set(key, max);
    return max;
}

/**
 * Drops anything typed past the country's longest valid national number, so a
 * Georgian number stops accepting digits at 9 instead of quietly building an
 * invalid one and only complaining at submit.
 *
 * Length is measured on the *national significant number*, not on the raw
 * digits, which is the whole reason this walks the string instead of calling
 * slice(). A US caller typing their trunk prefix — "1" then 202… — has typed 11
 * digits for a 10-digit number, and truncating raw digits would eat the last
 * one. AsYouType strips the prefix, so what gets counted is what counts.
 *
 * A paste that is too long keeps the valid prefix rather than being rejected
 * whole.
 */
export function clampToCountry(country, digits) {
    const max = maxNationalDigits(country);

    let kept = "";
    for (const digit of digits) {
        const next = kept + digit;
        const asYouType = new AsYouType(country || DEFAULT_COUNTRY);
        asYouType.input(next);

        // Undefined before the formatter has resolved a plan — count the raw
        // digits then; at that length nothing is near the limit anyway.
        const significant = asYouType.getNationalNumber() || next;
        if (significant.length > max) break;

        kept = next;
    }

    return kept;
}

/**
 * Formats as the user types — "(202) 456-1111" for the US, "555 12 34 56" for
 * Georgia. Punctuation is cosmetic and never reaches the server.
 *
 * AsYouType is fed only digits, so deleting a character can't get stuck on a
 * bracket the formatter itself inserted.
 *
 * Since every field runs its input through here on each keystroke, the clamp
 * above is what enforces the per-country length everywhere — there is no
 * maxLength on the inputs, because a formatted number is longer than its digits
 * and by a different amount per country.
 */
export function formatNational(country, raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits) return "";

    const clamped = clampToCountry(country || DEFAULT_COUNTRY, digits);
    return new AsYouType(country || DEFAULT_COUNTRY).input(clamped);
}

/** The submit value: `+15551234567`, or "" if there is nothing usable. */
export function toE164(country, national) {
    const digits = String(national ?? "").replace(/\D/g, "");
    if (!digits) return "";

    const parsed = parsePhoneNumberFromString(digits, country || DEFAULT_COUNTRY);
    if (parsed) return parsed.number;

    // Unparseable but non-empty: fall back to concatenation rather than
    // silently dropping what the user entered. The validator will have already
    // refused it in any form that requires a valid number.
    return `+${dialFor(country || DEFAULT_COUNTRY)}${digits}`;
}

/**
 * Real per-country validity, not just a digit count — this is the whole reason
 * for the library.
 *
 * Note it rejects the US 555-01xx fictional range, so the numbers everyone
 * reaches for while testing will fail. That is correct behaviour, and worth
 * remembering before assuming the validator is broken.
 */
export function isValidPhone(country, national) {
    const digits = String(national ?? "").replace(/\D/g, "");
    if (!digits) return false;

    const parsed = parsePhoneNumberFromString(digits, country || DEFAULT_COUNTRY);
    return Boolean(parsed?.isValid());
}

/**
 * Splits a stored value back into { country, national } so an edit form can
 * show it in the picker.
 *
 * Tolerant on purpose — three formats are already in the database:
 *   "+15551234567"  E.164, what this module writes from now on
 *   "15551234567"   dial code + number, no plus (what AddDriverModal wrote)
 *   "5551234567"    bare national digits (what the old 10-digit signup wrote)
 *
 * The last is genuinely ambiguous — nothing in it says which country — so it is
 * read as the default. Wrong for a non-US legacy row, but the alternative is
 * showing the user an empty field and losing the number entirely.
 */
export function splitE164(value, fallbackCountry = DEFAULT_COUNTRY) {
    const raw = String(value ?? "").trim();
    if (!raw) return { country: fallbackCountry, national: "" };

    const digits = raw.replace(/\D/g, "");

    // Try as an international number first, whether or not the "+" survived
    // whatever wrote it.
    for (const candidate of [raw.startsWith("+") ? raw : `+${digits}`]) {
        const parsed = parsePhoneNumberFromString(candidate);
        if (parsed?.isValid()) {
            return {
                country: parsed.country || fallbackCountry,
                national: parsed.formatNational(),
            };
        }
    }

    // No country to be found in it: treat the digits as national.
    return {
        country: fallbackCountry,
        national: formatNational(fallbackCountry, digits),
    };
}

/** Digits only, for length checks in a Zod schema. */
export function digitCount(national) {
    return String(national ?? "").replace(/\D/g, "").length;
}
