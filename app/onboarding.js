import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ImageBackground } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import PrimaryAction from '../src/components/ui/PrimaryAction';
import BrandLogo from '../src/components/BrandLogo';
import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/context/AuthContext';
import { photos } from '../src/theme/photos';
import { space, type, radius } from '../src/theme/tokens';

const SLIDES = [
  {
    icon: 'home', photo: photos.road,
    title: 'Your whole day, one screen',
    body: 'Where you’re headed, when it’s due, and what it pays — always right here. No more digging through texts and sticky notes.',
  },
  {
    icon: 'cloud-snow', photo: photos.dusk,
    title: 'We watch the road ahead for you',
    body: 'HitchLink warns you about storms, ice, and high winds before you reach them, and keeps an eye on your hours so you stay legal. We’ll ask to use your location for this.',
  },
  {
    icon: 'message-circle', photo: photos.cab,
    title: 'Your dispatcher, one tap away',
    body: 'Message, send a voice note, or call without leaving the app — and snap proof of delivery that sends instantly. We’ll ask about notifications and your camera.',
  },
];

export default function Onboarding() {
  const { colors } = useTheme();
  const { completeOnboarding } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  const finish = () => { completeOnboarding(); router.replace('/(auth)/sign-in'); };
  const next = () => (last ? finish() : setI(i + 1));

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ImageBackground source={slide.photo} style={styles.hero}>
        <LinearGradient colors={['rgba(4,40,90,0.12)', colors.bg]} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroTop, { paddingTop: insets.top + 18 }]}>
          <BrandLogo size={26} layout="horizontal" tone="light" />
          {!last ? (
            <Pressable onPress={finish} hitSlop={10}><Text style={styles.skip}>Skip</Text></Pressable>
          ) : null}
        </View>
      </ImageBackground>

      <FadeInView key={i} style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: colors.tealFill }]}>
          <Icon name={slide.icon} size={26} color={colors.teal} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{slide.title}</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>{slide.body}</Text>
      </FadeInView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space[5] }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, k) => (
            <View key={k} style={[styles.dot, { width: k === i ? 22 : 8, backgroundColor: k === i ? colors.teal : colors.surfaceHi }]} />
          ))}
        </View>
        <PrimaryAction label={last ? 'Get started' : 'Next'} icon={last ? 'check' : 'arrow-right'} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { height: '50%' },
  heroTop: { paddingHorizontal: space[6], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { ...type.bodyStrong, color: '#fff' },
  body: { flex: 1, paddingHorizontal: space[6], marginTop: -24, gap: space[4] },
  iconWrap: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.h1 },
  sub: { ...type.body, lineHeight: 25 },
  footer: { paddingHorizontal: space[6], gap: space[5] },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { height: 8, borderRadius: 999 },
});
