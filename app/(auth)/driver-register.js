import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, ScrollView, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import BrandLogo from '../../src/components/BrandLogo';
import Icon from '../../src/components/ui/Icon';
import PrimaryAction from '../../src/components/ui/PrimaryAction';
import PhoneField from '../../src/components/ui/PhoneField';
import FadeInView from '../../src/components/ui/FadeInView';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { useEnsureVisible } from '../../src/hooks/useEnsureVisible';
import { login } from '../../src/api/auth';
import { getInvitePreview, completeDriverRegistration } from '../../src/api/invites';
import { haptics } from '../../src/lib/haptics';
import { extractToken } from '../../src/lib/inviteLink';
import { DEFAULT_COUNTRY, isValidPhone, splitE164, toE164 } from '../../src/lib/phone';
import { space, type, radius, FONT, elevation } from '../../src/theme/tokens';

// Reached three ways: an https invite link the OS handed us (Universal/App
// Links), the hitchlinkdriver:// scheme, or the driver tapping "I have an
// invite" on sign-in and pasting a link / typing the 8-character code.
//
// It lives under (auth) because RouteGate (app/_layout.js) bounces a signed-out
// driver off any segment that isn't (auth)/welcome/onboarding. The group is
// excluded from the URL, so this file's path is /driver-register — the same path
// as the web page, which is what makes the https link resolve without a shim.

const BRAND_BAND = ['#04285A', '#063C6E', '#0B6F82'];

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

// expo-clipboard is a native module, so it is require()d lazily rather than
// imported: a dev client built before the dependency landed would otherwise
// throw the moment this route is reached, taking the registration screen down
// on exactly the build being used to test it. Same reasoning as the lazy
// expo-image-manipulator require in src/api/main.js.
//
// When it isn't there the screen still works — the username is `selectable`, so
// a long press copies it — and the Copy button simply isn't rendered rather
// than being offered and failing.
function getClipboard() {
  try {
    return require('expo-clipboard');
  } catch {
    return null;
  }
}

const ORDER = ['firstName', 'lastName', 'email', 'phone', 'username', 'password', 'confirmPassword'];

const EMPTY = {
  firstName: '', lastName: '', email: '', phone: '', phoneCountry: DEFAULT_COUNTRY,
  username: '', password: '', confirmPassword: '',
};

function splitName(full) {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/* ── Module-scope pieces ──────────────────────────────────────────────────
   Declared out here on purpose. A component defined inside another is a new
   type on every render, so React unmounts and remounts the subtree — which
   drops focus out of whichever field is being typed in. */

function Frame({ children, colors, styles, insets, bandH, scrollRef, onScroll }) {
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={[styles.band, { height: bandH }]}>
        <LinearGradient colors={BRAND_BAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.bandInner, { paddingTop: insets.top + 24 }]}>
          <BrandLogo layout="wordmark" tone="light" size={24} />
        </View>
      </View>
      {/* padding on both platforms, and the bottom inset applied INSIDE the
          KAV — edge-to-edge kills Android's adjustResize, so the KAV has to
          add it itself for the ScrollView to reveal the focused field. */}
      <KeyboardAvoidingView behavior="padding" style={styles.kav}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.scroll, { paddingTop: bandH - 40, paddingBottom: insets.bottom + space[6] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  name, label, icon, value, error, hint, colors, styles,
  inputRef, blockRef, onChange, onFocus, onBlur, trailing, ...rest
}) {
  return (
    <View style={styles.block} ref={blockRef} collapsable={false}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, { borderColor: error ? colors.danger : colors.border }]}>
        <Icon name={icon} size={18} color={colors.textMuted} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          {...rest}
        />
        {trailing}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export default function DriverRegister() {
  const { colors } = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { signIn, signOut, signedIn, user, onboarded, completeOnboarding } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bandH = insets.top + 128;

  const { scrollRef, onScroll, registerBlock, onFocusField, onBlurField: releaseField } = useEnsureVisible();

  const [token, setToken] = useState(params.token ? String(params.token) : '');
  const [manual, setManual] = useState('');
  const [preview, setPreview] = useState(null);
  const [phase, setPhase] = useState(params.token ? 'loading' : 'needLink');
  const [loadError, setLoadError] = useState('');

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  // The signed-in session, held back until the driver has seen their username.
  const [pending, setPending] = useState(null);
  const [copied, setCopied] = useState(false);
  // Resolved once, not per render — require() is cheap after the first call but
  // this also keeps the null case stable across re-renders.
  const clipboard = useMemo(getClipboard, []);
  const [switching, setSwitching] = useState(false);

  const inputs = {
    firstName: useRef(null), lastName: useRef(null), email: useRef(null),
    phone: useRef(null), username: useRef(null),
    password: useRef(null), confirmPassword: useRef(null),
  };

  // Deduped on the token VALUE, not a bare "has run" flag: a second, different
  // invite arriving while the app is warm must not be swallowed.
  const fetchedFor = useRef(null);

  // A param arriving later (warm start via the deep-link router) has to replace
  // whatever this screen was showing.
  useEffect(() => {
    const incoming = params.token ? String(params.token) : '';
    if (incoming && incoming !== token) setToken(incoming);
  }, [params.token, token]);

  const load = useCallback(async (value) => {
    if (!value) return;
    fetchedFor.current = value;
    setPhase('loading');
    setLoadError('');
    try {
      const data = await getInvitePreview(value);
      setPreview(data);
      setPhase('ready');
      if (data?.status === 'Valid') {
        const { firstName, lastName } = splitName(data.name);
        // A WhatsApp invite carries the number the dispatcher dialled, with its
        // country code. Split it so the picker opens on the right flag rather
        // than defaulting to US and mangling a foreign number.
        const { country, national } = splitE164(data.phoneNumber);
        setForm({
          ...EMPTY,
          firstName,
          lastName,
          email: data.email ?? '',
          phone: national,
          phoneCountry: country,
        });
      }
    } catch (e) {
      setLoadError(e?.message || t('invite.error.generic'));
      setPhase('loadFailed');
    }
  }, [t]);

  useEffect(() => {
    if (!token || fetchedFor.current === token) return;
    load(token);
  }, [token, load]);

  // Already signed in and this is the driver's OWN, already-redeemed invite:
  // they tapped their old link again. Nothing to say — put them back in the app.
  useEffect(() => {
    if (signedIn && phase === 'ready' && preview?.status === 'Used') {
      router.replace('/(tabs)');
    }
  }, [signedIn, phase, preview?.status, router]);

  const emailLocked = !!preview?.email;

  const setField = useCallback((key, v) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((e) => (e[key] ? { ...e, [key]: null } : e));
    setFormError((prev) => (prev ? '' : prev));
  }, []);

  const errorFor = useCallback((key, value, current) => {
    const v = (value ?? '').trim();
    switch (key) {
      case 'firstName': return v ? null : t('invite.err.firstName');
      case 'lastName':  return v ? null : t('invite.err.lastName');
      case 'email':     return EMAIL_RE.test(v) ? null : t('invite.err.email');
      // Optional — an email invite may never have asked for a number. But a
      // number that IS given has to be real for the country selected: a
      // dispatcher will try to call it.
      case 'phone':     return !v || isValidPhone(current.phoneCountry, v) ? null : t('invite.err.phone');
      case 'username':
        if (v.length < 3)  return t('invite.err.usernameShort');
        if (v.length > 20) return t('invite.err.usernameLong');
        if (!USERNAME_RE.test(v)) return t('invite.err.usernameChars');
        return null;
      case 'password':  return v.length >= 8 ? null : t('invite.err.password');
      case 'confirmPassword':
        return value === current.password ? null : t('invite.err.passwordMatch');
      default: return null;
    }
  }, [t]);

  // Validate on blur so a mistake is flagged as the driver leaves the field, not
  // only when they reach the bottom. A field they never touched stays quiet —
  // that is submit's job.
  // Reads through a ref rather than the closure so the callback can stay stable
  // (a new identity every keystroke would remount every Field), and without
  // hiding a setState inside another setState's updater.
  const formRef = useRef(form);
  formRef.current = form;

  const blurField = useCallback((key) => {
    releaseField(key);
    const current = formRef.current;
    if (!current[key].trim()) return;
    const e = errorFor(key, current[key], current);
    if (e) setErrors((prev) => ({ ...prev, [key]: e }));
  }, [errorFor, releaseField]);

  const onSubmit = async () => {
    if (saving) return;

    const found = {};
    ORDER.forEach((k) => { found[k] = errorFor(k, form[k], form); });
    const firstBad = ORDER.find((k) => found[k]);
    if (firstBad) {
      setErrors(found);
      haptics.error();
      inputs[firstBad].current?.focus();
      return;
    }

    setErrors({});
    setFormError('');
    setSaving(true);
    haptics.press();

    try {
      await completeDriverRegistration({
        token,
        firstName:   form.firstName.trim(),
        lastName:    form.lastName.trim(),
        // E.164, not the formatted display value.
        phoneNumber: toE164(form.phoneCountry, form.phone),
        email:       form.email.trim(),
        username:    form.username.trim(),
        password:    form.password,
      });
    } catch (e) {
      // The server names the field it rejected — put the message on that input
      // rather than in a banner the driver has to map back to a filled form.
      if (e?.field && ORDER.includes(e.field)) {
        setErrors((prev) => ({ ...prev, [e.field]: e.message }));
        inputs[e.field].current?.focus();
      } else {
        setFormError(e?.message || t('invite.error.generic'));
      }
      haptics.error();
      setSaving(false);
      return;
    }

    // The account exists from here on. A failure below is NOT "registration
    // failed" — retrying the form would hit a taken username and read as one.
    try {
      const data = await login(form.username.trim(), form.password);
      const authToken = data?.token || data?.accessToken;
      if (!authToken || typeof authToken !== 'string') throw new Error('No token in response');

      // Hold the session rather than starting it. This is the one moment a driver
      // will ever see the username they just chose — there is no "forgot
      // username" flow — so the confirmation screen goes up first and signs them
      // in when they continue.
      setPending({ authToken, refreshToken: data?.refreshToken || null });
      haptics.success();
      setPhase('saved');
    } catch {
      haptics.warning();
      setPhase('created');
    } finally {
      setSaving(false);
    }
  };

  const frameProps = { colors, styles, insets, bandH, scrollRef, onScroll };

  const message = ({ title, body, actionLabel, onAction, icon = 'alert-circle', tone, secondary }) => (
    <Frame {...frameProps}>
      <FadeInView style={[styles.card, elevation[3]]}>
        <Icon name={icon} size={28} color={tone || colors.caution} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{body}</Text>
        {actionLabel ? <PrimaryAction label={actionLabel} icon="arrow-right" onPress={onAction} /> : null}
        {secondary}
      </FadeInView>
    </Frame>
  );

  if (phase === 'loading') {
    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3], { alignItems: 'center' }]}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.sub}>{t('invite.checking')}</Text>
        </FadeInView>
      </Frame>
    );
  }

  if (phase === 'loadFailed') {
    return message({
      title: t('invite.error.offlineTitle'),
      body: loadError,
      actionLabel: t('invite.retry'),
      onAction: () => load(token),
    });
  }

  // Registered AND signed in — but held here on purpose. This is the only
  // moment the driver is guaranteed to see the username they just chose, and a
  // driver who loses it has no self-service way back in: there is no "forgot
  // username" flow, only a call to their dispatcher.
  if (phase === 'saved') {
    const username = form.username.trim();

    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3]]}>
          <Icon name="check-circle" size={28} color={colors.go} />
          <Text style={styles.title}>
            {t('invite.saved.title', { name: form.firstName.trim() })}
          </Text>
          <Text style={styles.sub}>{t('invite.saved.body')}</Text>

          <View style={[styles.credential, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.credentialLabel}>{t('invite.field.username')}</Text>
              {/* selectable as well as copyable: the copy button is faster, but a
                  driver reading it aloud to their dispatcher wants to highlight it. */}
              <Text style={styles.credentialValue} selectable>{username}</Text>
            </View>
            {clipboard ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('invite.saved.copy')}
                hitSlop={8}
                onPress={async () => {
                  try {
                    await clipboard.setStringAsync(username);
                    haptics.success();
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    haptics.error();
                  }
                }}
                style={styles.copyBtn}
              >
                <Icon name={copied ? 'check' : 'copy'} size={18} color={copied ? colors.go : colors.teal} />
                <Text style={[styles.copyText, { color: copied ? colors.go : colors.teal }]}>
                  {copied ? t('invite.saved.copied') : t('invite.saved.copy')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.sub}>{t('invite.saved.password')}</Text>

          <PrimaryAction
            label={t('invite.saved.action')}
            icon="arrow-right"
            loading={saving}
            onPress={async () => {
              setSaving(true);
              try {
                // A driver who arrived by link has never seen welcome/onboarding,
                // so the flag has to be set here or the next cold start routes
                // them back to it.
                if (!onboarded) await completeOnboarding();
                await signIn(
                  pending.authToken,
                  `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
                  form.email.trim(),
                  pending.refreshToken,
                );

                // Navigate explicitly. RouteGate does NOT move a signed-in driver
                // off this route — it exempts it by name, so that a driver holding
                // someone else's invite isn't bounced out of the screen that
                // explains it. Every other (auth) screen can leave the move to
                // RouteGate; this one is the exception, and assuming otherwise is
                // what made this button look dead.
                router.replace('/(tabs)');
              } catch {
                // The account exists and the password works — only the session
                // handoff failed. Send them to sign in by hand rather than
                // leaving them on a button that appears to do nothing.
                haptics.warning();
                setPhase('created');
              } finally {
                setSaving(false);
              }
            }}
          />
        </FadeInView>
      </Frame>
    );
  }

  if (phase === 'created') {
    return message({
      icon: 'check-circle',
      tone: colors.go,
      title: t('invite.created.title'),
      body: t('invite.created.body'),
      actionLabel: t('invite.created.action'),
      onAction: () => router.replace({ pathname: '/(auth)/sign-in', params: { username: form.username.trim() } }),
    });
  }

  // No token: the driver installed the app and opened it from the home screen,
  // so the link never reached us. Paste it, or type the code from the message.
  if (phase === 'needLink') {
    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3]]}>
          <Text style={styles.title}>{t('invite.needLink.title')}</Text>
          <Text style={styles.sub}>{t('invite.needLink.body')}</Text>

          <View style={[styles.field, { borderColor: colors.border }]}>
            <Icon name="link" size={18} color={colors.textMuted} />
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder={t('invite.needLink.placeholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={() => setToken(extractToken(manual))}
              returnKeyType="go"
            />
          </View>

          <PrimaryAction
            label={t('invite.needLink.action')}
            icon="arrow-right"
            disabled={!manual.trim()}
            onPress={() => setToken(extractToken(manual))}
          />
          <Pressable onPress={() => router.replace('/(auth)/sign-in')} hitSlop={8}>
            <Text style={styles.link}>{t('invite.backToSignIn')}</Text>
          </Pressable>
        </FadeInView>
      </Frame>
    );
  }

  const status = preview?.status;

  // The effect above is already sending this driver back to (tabs) — render
  // nothing rather than flashing "already used" for a frame on the way.
  if (signedIn && status === 'Used') return null;

  if (status !== 'Valid') {
    const key = status === 'Expired' ? 'expired' : status === 'Used' ? 'used' : 'notFound';
    return message({
      title: t(`invite.${key}.title`),
      body: t(`invite.${key}.body`),
      actionLabel: t('invite.backToSignIn'),
      onAction: () => router.replace('/(auth)/sign-in'),
    });
  }

  // Signed in as someone else. Shared cab phones are a real case here, so this
  // explains rather than silently bouncing — and never signs anyone out unasked.
  if (signedIn && !switching) {
    return message({
      icon: 'user-check',
      title: t('invite.signedIn.title'),
      body: t('invite.signedIn.body', { current: user?.name || '', invited: preview.name || '' }),
      actionLabel: t('invite.signedIn.switch'),
      onAction: async () => { setSwitching(true); await signOut(); },
      secondary: (
        <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={8}>
          <Text style={styles.link}>{t('invite.signedIn.stay')}</Text>
        </Pressable>
      ),
    });
  }

  const fleet = preview.companyName || preview.dispatcherName;

  const fieldProps = (name) => ({
    name,
    colors,
    styles,
    value: form[name],
    error: errors[name],
    inputRef: inputs[name],
    blockRef: registerBlock(name),
    onChange: (v) => setField(name, v),
    onFocus: () => onFocusField(name),
    onBlur: () => blurField(name),
  });

  return (
    <Frame {...frameProps}>
      <FadeInView style={[styles.card, elevation[3]]}>
        <Text style={styles.title}>{t('invite.title')}</Text>
        <Text style={styles.sub}>
          {fleet ? t('invite.invitedBy', { company: fleet }) : t('invite.subtitle')}
        </Text>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field {...fieldProps('firstName')} label={t('invite.field.firstName')} icon="user" autoCapitalize="words" />
          </View>
          <View style={{ flex: 1 }}>
            <Field {...fieldProps('lastName')} label={t('invite.field.lastName')} icon="user" autoCapitalize="words" />
          </View>
        </View>

        <Field
          {...fieldProps('email')}
          label={t('invite.field.email')}
          icon="mail"
          hint={emailLocked ? t('invite.hint.emailLocked') : null}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!emailLocked}
        />

        {/* Not a Field: the country picker has no icon slot and owns half the
            row. The label and error line are reproduced here so the block still
            matches its neighbours. */}
        <View style={styles.block} ref={registerBlock('phone')} collapsable={false}>
          <Text style={styles.label}>{t('invite.field.phone')}</Text>
          <PhoneField
            country={form.phoneCountry}
            onCountryChange={(code) => setField('phoneCountry', code)}
            value={form.phone}
            onChange={(v) => setField('phone', v)}
            onFocus={() => onFocusField('phone')}
            onBlur={() => blurField('phone')}
            error={errors.phone}
            inputRef={inputs.phone}
            countryLabel={t('invite.field.phone')}
          />
        </View>

        {/* textContentType is what makes iOS offer to save this to the Keychain
            on submit, and to autofill it at sign-in later. It only works because
            the app declares webcredentials: for these domains in app.json and
            the site serves a matching apple-app-site-association — without both,
            these props are inert. This is the whole mitigation for a driver who
            forgets what they chose: there is no "forgot username" flow. */}
        <Field
          {...fieldProps('username')}
          label={t('invite.field.username')}
          icon="at-sign"
          hint={t('invite.hint.username')}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          autoComplete="username-new"
        />

        <Field
          {...fieldProps('password')}
          label={t('invite.field.password')}
          icon="lock"
          secureTextEntry={!showPw}
          autoCapitalize="none"
          textContentType="newPassword"
          autoComplete="password-new"
          trailing={
            <Pressable
              onPress={() => setShowPw((p) => !p)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPw ? t('invite.hidePasswordA11y') : t('invite.showPasswordA11y')}
            >
              <Icon name={showPw ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
            </Pressable>
          }
        />

        <Field
          {...fieldProps('confirmPassword')}
          label={t('invite.field.confirmPassword')}
          icon="lock"
          secureTextEntry={!showPw}
          autoCapitalize="none"
          textContentType="newPassword"
          autoComplete="password-new"
        />

        {formError ? (
          <View style={styles.errorRow}>
            <Icon name="alert-circle" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{formError}</Text>
          </View>
        ) : null}

        <View style={{ height: 2 }} />
        <PrimaryAction label={t('invite.submit')} icon="check" onPress={onSubmit} loading={saving} />
      </FadeInView>
    </Frame>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1 },
  band: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  bandInner: { paddingHorizontal: space[6], alignItems: 'center' },
  kav: { flex: 1 },
  scroll: { paddingHorizontal: space[5], flexGrow: 1 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[5],
    gap: space[4],
  },
  title: { ...type.h1, color: colors.textPrimary },
  sub: { ...type.body, color: colors.textSecondary, lineHeight: 24, marginTop: -6 },
  link: { ...type.caption, color: colors.teal, textAlign: 'center', fontFamily: FONT.bold },

  row: { flexDirection: 'row', gap: space[3] },
  block: { gap: 6 },
  label: { ...type.label, color: colors.textMuted },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[4], minHeight: 58,
  },
  input: { flex: 1, paddingVertical: space[4], ...type.body, color: colors.textPrimary },
  hint: { ...type.caption, color: colors.textMuted },

  // The username on the confirmation screen. Deliberately louder than a form
  // field — it is the one thing on that screen worth remembering.
  credential: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    backgroundColor: colors.surface2,
    borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  credentialLabel: { ...type.caption, color: colors.textMuted },
  credentialValue: {
    ...type.body,
    color: colors.textPrimary,
    fontFamily: FONT.mono,
    // l/1/0/O have to be tellable apart: a driver reads this to a dispatcher
    // down a phone line, or types it into a second device.
    letterSpacing: 0.5,
  },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space[2] },
  copyText: { ...type.caption, fontWeight: '600' },
  fieldError: { ...type.caption, color: colors.danger },

  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerFill,
    borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10,
  },
  errorText: { ...type.caption, fontFamily: FONT.bold, color: colors.danger, flex: 1 },
});
