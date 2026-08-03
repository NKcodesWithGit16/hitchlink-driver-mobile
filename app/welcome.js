import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import PrimaryAction from '../src/components/ui/PrimaryAction';
import BrandLogo from '../src/components/BrandLogo';
import FadeInView from '../src/components/ui/FadeInView';
import { useT } from '../src/i18n/LanguageContext';
import { space, type, FONT } from '../src/theme/tokens';

/* First thing a new driver sees, once, before they have an account. One
   promise, one big button; the tour and the sign-in form are a tap away.

   Deliberately light and theme-independent, unlike every working screen in the
   app: this is the identity moment, so it shows the mark on white exactly as
   the driver just saw it on the store listing they installed from. Fixed
   colours for the same reason — a driver who has never opened the app has no
   day/night preference yet, and the screen should not change shape under them.
   That also means the status bar has to be forced dark here, or the global
   light-on-dark setting would paint white icons onto a white background. */

const NAVY = '#04285A';
const INK = 'rgba(11,18,32,0.66)';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + space[6] }]}>
        <View style={styles.hero}>
          <FadeInView>
            <BrandLogo layout="icon" size={136} />
          </FadeInView>
          <FadeInView delay={110} style={styles.wordmark}>
            <BrandLogo layout="wordmark" tone="dark" size={26} />
          </FadeInView>
        </View>

        <FadeInView delay={220}>
          <Text style={styles.kicker}>{t('welcome.kicker')}</Text>
          <Text style={styles.headline}>{t('welcome.headline')}</Text>
          <Text style={styles.sub}>{t('welcome.sub')}</Text>
        </FadeInView>

        <FadeInView delay={330} style={styles.actions}>
          <PrimaryAction label={t('welcome.getStarted')} icon="arrow-right" onPress={() => router.push('/onboarding')} />
          <Pressable
            onPress={() => router.push('/(auth)/sign-in')}
            style={styles.signInBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('welcome.signInA11y')}
          >
            <Text style={styles.signInText}>{t('welcome.haveLogin')}</Text>
          </Pressable>
        </FadeInView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flex: 1, paddingHorizontal: space[6] },

  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4] },
  wordmark: { alignItems: 'center' },

  kicker: { ...type.label, color: 'rgba(4,40,90,0.55)', marginBottom: 12 },
  headline: { ...type.display, fontSize: 40, lineHeight: 44, color: NAVY },
  sub: { ...type.body, color: INK, lineHeight: 25, marginTop: 14, maxWidth: 360 },

  actions: { marginTop: 30, gap: space[1] },
  signInBtn: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  signInText: { ...type.bodyStrong, fontFamily: FONT.bold, color: NAVY, textDecorationLine: 'underline' },
});
