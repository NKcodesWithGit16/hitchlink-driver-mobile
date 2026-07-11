import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import BrandLogo from '../../src/components/BrandLogo';
import Icon from '../../src/components/ui/Icon';
import PrimaryAction from '../../src/components/ui/PrimaryAction';
import FadeInView from '../../src/components/ui/FadeInView';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { login } from '../../src/api/auth';
import { space, type, radius, FONT, elevation } from '../../src/theme/tokens';

// Brand navy → teal. Fixed in both themes so the white wordmark always reads and
// the identity stays put even if the driver picked a non-teal accent.
const BRAND_BAND = ['#04285A', '#063C6E', '#0B6F82'];

export default function SignIn() {
  const { colors } = useTheme();
  const { signIn, sessionNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const bandH = insets.top + 158;

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const onSubmit = async () => {
    if (loading) return;
    if (!email.trim() || !password) { setError('Enter your username and password.'); return; }
    setError('');
    setLoading(true);
    try {
      const data = await login(email.trim(), password);
      const token = data?.token || data?.accessToken || data;
      if (!token || typeof token !== 'string') throw new Error('No token in response');
      // name/email come from the form — backend is source of truth after profile fetch
      await signIn(token, '', email.trim(), data?.refreshToken || null);
      router.replace('/(tabs)');
    } catch (e) {
      setError(e.message === 'Login failed' ? 'Wrong username or password.' : (e.message || 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  };

  const borderFor = () => (error ? colors.danger : colors.border);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Brand gradient band */}
      <View style={[styles.band, { height: bandH }]}>
        <LinearGradient colors={BRAND_BAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* soft diagonal sheen for depth */}
        <LinearGradient
          colors={['rgba(255,255,255,0.12)', 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.8 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.bandInner, { paddingTop: insets.top + 30 }]}>
          <BrandLogo layout="wordmark" tone="light" size={26} />
        </View>
      </View>

      {/* padding on both platforms — edge-to-edge kills Android's adjustResize,
          so the KAV must add the bottom inset itself for the ScrollView to
          reveal the focused field above the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={styles.kav}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: bandH - 44, paddingBottom: insets.bottom + space[6] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FadeInView style={[styles.card, elevation[3]]}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.sub}>Sign in with the login your dispatcher set up for you.</Text>
            {sessionNotice ? <Text style={styles.notice}>{sessionNotice}</Text> : null}

            {/* Username / email */}
            <View style={[styles.field, { borderColor: borderFor() }]}>
              <Icon name="user" size={18} color={colors.textMuted} />
              <TextInput
                value={email}
                onChangeText={v => { setEmail(v); setError(''); }}
                placeholder="Username or email"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                style={styles.input}
              />
            </View>

            {/* Password */}
            <View style={[styles.field, { borderColor: borderFor() }]}>
              <Icon name="lock" size={18} color={colors.textMuted} />
              <TextInput
                value={password}
                onChangeText={v => { setPassword(v); setError(''); }}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPw}
                autoComplete="password"
                style={styles.input}
                onSubmitEditing={onSubmit}
                returnKeyType="done"
              />
              <Pressable onPress={() => setShowPw(p => !p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                <Icon name={showPw ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            {/* Error */}
            {error ? (
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={14} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={{ height: 2 }} />
            <PrimaryAction label="Sign in" icon="arrow-right" onPress={onSubmit} loading={loading} />
          </FadeInView>

          <Text style={styles.help}>Trouble signing in? Call your dispatcher.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  notice: { ...type.caption, color: colors.caution },

  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[4], minHeight: 58,
  },
  input: { flex: 1, paddingVertical: space[4], ...type.body, color: colors.textPrimary },

  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.dangerFill,
    borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10,
  },
  errorText: { ...type.caption, fontFamily: FONT.bold, color: colors.danger, flex: 1 },

  help: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: space[6] },
});
