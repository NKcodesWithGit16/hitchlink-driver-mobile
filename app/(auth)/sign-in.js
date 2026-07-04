import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ImageBackground, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import BrandLogo from '../../src/components/BrandLogo';
import Icon from '../../src/components/ui/Icon';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { login } from '../../src/api/auth';
import { photos } from '../../src/theme/photos';
import { space, type, radius, FONT, shadow } from '../../src/theme/tokens';

export default function SignIn() {
  const { colors } = useTheme();
  const { signIn, sessionNotice } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const onSubmit = async () => {
    if (!email.trim() || !password) { setError('Enter your username and password.'); return; }
    setError('');
    setLoading(true);
    try {
      const data = await login(email.trim(), password);
      const token = data?.token || data?.accessToken || data;
      if (!token || typeof token !== 'string') throw new Error('No token in response');
      // name/email come from the form — backend will be the source of truth after profile fetch
      await signIn(token, '', email.trim(), data?.refreshToken || null);
      router.replace('/(tabs)');
    } catch (e) {
      setError(e.message === 'Login failed' ? 'Wrong username or password.' : (e.message || 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ImageBackground source={photos.dusk} style={styles.hero}>
        <LinearGradient colors={['rgba(4,40,90,0.25)', colors.bg]} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroInner, { paddingTop: insets.top + 28 }]}>
          <BrandLogo size={30} layout="horizontal" tone="light" />
        </View>
      </ImageBackground>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            Use the username and password you created when you accepted your invite.
          </Text>
          {sessionNotice ? (
            <Text style={[styles.sub, { color: colors.caution, marginTop: 8 }]}>{sessionNotice}</Text>
          ) : null}
        </View>

        {/* Username / email */}
        <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}>
          <Icon name="user" size={18} color={colors.textMuted} />
          <TextInput
            value={email}
            onChangeText={v => { setEmail(v); setError(''); }}
            placeholder="Username or email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="username"
            style={[styles.input, { color: colors.textPrimary }]}
          />
        </View>

        {/* Password */}
        <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}>
          <Icon name="lock" size={18} color={colors.textMuted} />
          <TextInput
            value={password}
            onChangeText={v => { setPassword(v); setError(''); }}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPw}
            autoComplete="password"
            style={[styles.input, { color: colors.textPrimary }]}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />
          <Pressable onPress={() => setShowPw(p => !p)} hitSlop={8}>
            <Icon name={showPw ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Error */}
        {error ? (
          <View style={[styles.errorRow, { backgroundColor: colors.dangerFill }]}>
            <Icon name="alert-circle" size={14} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          </View>
        ) : null}

        {/* Submit */}
        <Pressable
          onPress={onSubmit}
          disabled={loading}
          style={({ pressed }) => [
            styles.submitBtn,
            { backgroundColor: colors.teal, opacity: pressed || loading ? 0.85 : 1 },
            shadow.glow(colors.teal),
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.onAccent} />
            : <>
                <Text style={[styles.submitText, { color: colors.onAccent }]}>Sign in</Text>
                <Icon name="arrow-right" size={18} color={colors.onAccent} />
              </>}
        </Pressable>
      </KeyboardAvoidingView>

      <Text style={[styles.help, { color: colors.textMuted, paddingBottom: insets.bottom + space[4] }]}>
        Trouble signing in? Call your dispatcher.
      </Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1 },
  hero: { height: '40%', justifyContent: 'flex-start' },
  heroInner: { paddingHorizontal: space[6] },
  body: { flex: 1, paddingHorizontal: space[6], marginTop: -28, gap: space[4] },
  title: { ...type.h1 },
  sub: { ...type.body, lineHeight: 24 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space[4],
  },
  input: { flex: 1, paddingVertical: space[4], ...type.body },
  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10,
  },
  errorText: { ...type.caption, fontFamily: FONT.bold, flex: 1 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, paddingVertical: 16,
  },
  submitText: { fontSize: 16, fontFamily: FONT.bold },
  help: { ...type.caption, textAlign: 'center' },
});
