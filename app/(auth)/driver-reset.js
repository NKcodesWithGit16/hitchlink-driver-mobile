import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BrandLogo from '../../src/components/BrandLogo';
import Icon from '../../src/components/ui/Icon';
import PrimaryAction from '../../src/components/ui/PrimaryAction';
import FadeInView from '../../src/components/ui/FadeInView';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { getPasswordResetPreview, completePasswordReset } from '../../src/api/invites';
import { haptics } from '../../src/lib/haptics';
import { extractToken } from '../../src/lib/inviteLink';
import { space, type, radius, FONT, elevation } from '../../src/theme/tokens';

// Mirrors Identity's SetPasswordCommandHandler.MinPasswordLength. Checked here
// so the driver isn't told by a round trip what the field could have told them.
const MIN_PASSWORD = 8;

/**
 * Sets a new password from a dispatcher-issued reset link.
 *
 * Lives under (auth) because a driver using it is signed out by definition —
 * that is the whole situation it exists for. The route group is stripped from
 * the URL, so this file IS `/driver-reset`, matching the path the server builds
 * and the one declared in the association files.
 */
function Frame({ children, colors, styles, insets }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo}>
          <BrandLogo layout="icon" size={56} />
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function DriverReset() {
  const { colors } = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { signedIn, signOut, user } = useAuth();

  const token = typeof params.token === 'string' ? params.token : '';

  const [phase, setPhase] = useState(token ? 'loading' : 'needLink');
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [manual, setManual] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchedFor = useRef(null);
  const styles = makeStyles(colors);

  const load = useCallback(async (value) => {
    fetchedFor.current = value;
    setPhase('loading');
    setLoadError('');
    try {
      const data = await getPasswordResetPreview(value);
      setPreview(data);
      setPhase('ready');
    } catch (e) {
      setLoadError(e?.message || t('reset.error.generic'));
      setPhase('loadFailed');
    }
  }, [t]);

  useEffect(() => {
    if (!token || fetchedFor.current === token) return;
    load(token);
  }, [token, load]);

  const submit = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(t('reset.error.tooShort', { n: MIN_PASSWORD }));
      haptics.error();
      return;
    }
    if (password !== confirm) {
      setError(t('reset.error.mismatch'));
      haptics.error();
      return;
    }

    setError('');
    setSaving(true);
    try {
      const data = await completePasswordReset({
        token: fetchedFor.current || token,
        newPassword: password,
      });
      haptics.success();
      // Straight to sign-in with the username filled in. Signing them in here
      // would need the password again over the wire for no gain, and the server
      // has just invalidated every session on the account by design.
      router.replace({
        pathname: '/(auth)/sign-in',
        params: data?.username ? { username: data.username } : {},
      });
    } catch (e) {
      setError(e?.message || t('reset.error.generic'));
      haptics.error();
      setSaving(false);
    }
  };

  const frameProps = { colors, styles, insets };

  const message = ({ title, body, actionLabel, onAction, icon = 'alert-circle', tone }) => (
    <Frame {...frameProps}>
      <FadeInView style={[styles.card, elevation[3]]}>
        <Icon name={icon} size={28} color={tone || colors.caution} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{body}</Text>
        {actionLabel ? <PrimaryAction label={actionLabel} icon="arrow-right" onPress={onAction} /> : null}
      </FadeInView>
    </Frame>
  );

  if (phase === 'loading') {
    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3], { alignItems: 'center' }]}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.sub}>{t('reset.checking')}</Text>
        </FadeInView>
      </Frame>
    );
  }

  if (phase === 'loadFailed') {
    return message({
      title: t('reset.error.offlineTitle'),
      body: loadError,
      actionLabel: t('common.retry'),
      onAction: () => load(fetchedFor.current || token),
    });
  }

  // No token: they opened the app from the home screen, so the link never
  // reached us. Paste it, or type the code the dispatcher read out.
  if (phase === 'needLink') {
    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3]]}>
          <Text style={styles.title}>{t('reset.needLink.title')}</Text>
          <Text style={styles.sub}>{t('reset.needLink.body')}</Text>

          <View style={[styles.field, { borderColor: colors.border }]}>
            <Icon name="link" size={18} color={colors.textMuted} />
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder={t('reset.needLink.placeholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
          </View>

          <PrimaryAction
            label={t('reset.needLink.action')}
            icon="arrow-right"
            disabled={!manual.trim()}
            onPress={() => load(extractToken(manual))}
          />
        </FadeInView>
      </Frame>
    );
  }

  const status = preview?.status;

  // Three dead ends, three different remedies. Collapsing them into one message
  // would leave the driver guessing which of "ask again", "you already did
  // this" and "check the link" applies.
  if (status !== 'Valid') {
    const key = status === 'Expired' ? 'expired' : status === 'Used' ? 'used' : 'notFound';
    return message({
      title: t(`reset.${key}.title`),
      body: t(`reset.${key}.body`),
      actionLabel: t('reset.backToSignIn'),
      onAction: () => router.replace('/(auth)/sign-in'),
    });
  }

  // Signed in on this handset. A reset is for someone who cannot get in, so the
  // honest thing is to say the link is not needed — but a shared cab phone is a
  // real scenario here, so offer the way through rather than just refusing.
  if (signedIn) {
    return (
      <Frame {...frameProps}>
        <FadeInView style={[styles.card, elevation[3]]}>
          <Icon name="user-check" size={28} color={colors.teal} />
          <Text style={styles.title}>{t('reset.signedIn.title')}</Text>
          <Text style={styles.sub}>
            {t('reset.signedIn.body', {
              current: user?.name || t('more.driver'),
              target: preview?.firstName || t('more.driver'),
            })}
          </Text>
          <PrimaryAction
            label={t('reset.signedIn.signOut')}
            icon="log-out"
            onPress={async () => { await signOut(); }}
          />
          <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={8} style={styles.secondary}>
            <Text style={styles.secondaryText}>{t('reset.signedIn.stay')}</Text>
          </Pressable>
        </FadeInView>
      </Frame>
    );
  }

  return (
    <Frame {...frameProps}>
      <FadeInView style={[styles.card, elevation[3]]}>
        <Text style={styles.title}>{t('reset.title')}</Text>

        {/* Named when we know it, so a driver on a shared cab phone can see at a
            glance whose account this link is for before they change anything. */}
        <Text style={styles.sub}>
          {preview?.firstName ? t('reset.greeting', { name: preview.firstName }) : t('reset.body')}
        </Text>

        {preview?.username ? (
          <>
            <Text style={styles.sub}>{t('reset.usernameIntro')}</Text>
            <View style={[styles.credential, { borderColor: colors.border }]}>
              <Icon name="at-sign" size={18} color={colors.textMuted} />
              <Text style={styles.credentialValue} selectable>{preview.username}</Text>
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{t('reset.newPassword')}</Text>
        <View style={[styles.field, { borderColor: error ? colors.danger : colors.border }]}>
          <Icon name="lock" size={18} color={colors.textMuted} />
          <TextInput
            value={password}
            onChangeText={(v) => { setPassword(v); setError(''); }}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="password-new"
            textContentType="newPassword"
            style={styles.input}
          />
          <Pressable
            onPress={() => setShowPw((p) => !p)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={showPw ? t('invite.hidePasswordA11y') : t('invite.showPasswordA11y')}
          >
            <Icon name={showPw ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <Text style={styles.hint}>{t('reset.hint', { n: MIN_PASSWORD })}</Text>

        <Text style={styles.label}>{t('reset.confirmPassword')}</Text>
        <View style={[styles.field, { borderColor: error ? colors.danger : colors.border }]}>
          <Icon name="lock" size={18} color={colors.textMuted} />
          <TextInput
            value={confirm}
            onChangeText={(v) => { setConfirm(v); setError(''); }}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="password-new"
            textContentType="newPassword"
            style={styles.input}
          />
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Icon name="alert-circle" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <PrimaryAction
          label={saving ? t('reset.saving') : t('reset.action')}
          icon="check"
          loading={saving}
          onPress={submit}
        />

        {/* Said before they commit, not after: every other device signed in on
            this account is about to be signed out. */}
        <Text style={styles.hint}>{t('reset.signsOutOthers')}</Text>
      </FadeInView>
    </Frame>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: space[5], gap: space[5] },
  logo: { alignItems: 'center', marginBottom: space[2] },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space[5],
    gap: space[4],
  },
  title: { ...type.h2, color: colors.textPrimary },
  sub: { ...type.body, color: colors.textSecondary ?? colors.textMuted, lineHeight: 22 },
  label: { ...type.caption, color: colors.textMuted, marginBottom: -space[2] },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[4], minHeight: 58,
  },
  input: { flex: 1, paddingVertical: space[4], ...type.body, color: colors.textPrimary },
  hint: { ...type.caption, color: colors.textMuted },

  credential: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    backgroundColor: colors.surface2,
    borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  credentialValue: { ...type.body, color: colors.textPrimary, fontFamily: FONT.mono, letterSpacing: 0.5 },

  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerFill,
    borderRadius: radius.md, padding: space[3],
  },
  errorText: { ...type.caption, color: colors.danger, flex: 1 },

  secondary: { alignSelf: 'center', paddingVertical: space[2] },
  secondaryText: { ...type.body, color: colors.teal, fontWeight: '600' },
});
