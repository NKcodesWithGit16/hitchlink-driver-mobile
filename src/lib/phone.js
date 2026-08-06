import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import { dialFor } from "../data/countries";

/**
 * Phone numbers, in one place.
 *
 * Mirrors HitchLink_frontend/src/lib/phone.js. Separate repos, no shared
 * package — keep the two in step by hand, and if the rules ever diverge the
 * server is the one that decides (see Identity's PhoneNumber validation).
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

/**
 * Formats as the user types — "(202) 456-1111" for the US, "555 12 34 56" for
 * Georgia. Punctuation is cosmetic and never reaches the server.
 *
 * AsYouType is fed only digits, so deleting a character can't get stuck on a
 * bracket the formatter itself inserted.
 */
export function formatNational(country, raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return new AsYouType(country || DEFAULT_COUNTRY).input(digits);
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
