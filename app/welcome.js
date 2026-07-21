import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PrimaryAction from '../src/components/ui/PrimaryAction';
import BrandLogo from '../src/components/BrandLogo';
import CinematicHero from '../src/components/ui/CinematicHero';
import FadeInView from '../src/components/ui/FadeInView';
import { useT } from '../src/i18n/LanguageContext';
import { photos } from '../src/theme/photos';
import { space, type } from '../src/theme/tokens';

/* First thing a new driver sees. One promise, one big button. The tour and the
   sign-in form live one tap away — this screen only has to feel like the app
   was built by people who know the road. Text is white on the photo, so it does
   not follow the day/night theme. */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <View style={styles.screen}>
      <CinematicHero photo={photos.dusk} strength="full" style={StyleSheet.absoluteFill} />

      <View style={[styles.content, { paddingTop: insets.top + 22, paddingBottom: insets.bottom + space[6] }]}>
        <FadeInView>
          <BrandLogo layout="wordmark" tone="light" size={30} />
        </FadeInView>

        <View style={{ flex: 1 }} />

        <FadeInView delay={120}>
          <Text style={styles.kicker}>{t('welcome.kicker')}</Text>
          <Text style={styles.headline}>{t('welcome.headline')}</Text>
          <Text style={styles.sub}>
            {t('welcome.sub')}
          </Text>
        </FadeInView>

        <FadeInView delay={240} style={styles.actions}>
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
  screen: { flex: 1, backgroundColor: '#04101F' },
  content: { flex: 1, paddingHorizontal: space[6] },
  kicker: { ...type.label, color: 'rgba(255,255,255,0.68)', marginBottom: 12 },
  headline: { ...type.display, fontSize: 40, lineHeight: 44, color: '#FFFFFF' },
  sub: { ...type.body, color: 'rgba(255,255,255,0.84)', lineHeight: 25, marginTop: 14, maxWidth: 360 },
  actions: { marginTop: 30, gap: space[1] },
  signInBtn: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  signInText: { ...type.bodyStrong, color: '#FFFFFF', textDecorationLine: 'underline' },
});
