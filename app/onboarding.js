import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PrimaryAction from '../src/components/ui/PrimaryAction';
import BrandLogo from '../src/components/BrandLogo';
import Icon from '../src/components/ui/Icon';
import CinematicHero from '../src/components/ui/CinematicHero';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/context/AuthContext';
import { photos } from '../src/theme/photos';
import { space, type, radius } from '../src/theme/tokens';

/* Three tight, skimmable slides. Swipe or tap Next — the big button never moves,
   so a driver who is new to phones always knows where "forward" is. Copy names
   the permissions we'll ask for, so the OS prompts later don't feel out of the
   blue. */
const SLIDES = [
  {
    icon: 'home', photo: photos.road,
    title: 'Your whole day,\none screen',
    body: 'Where you’re headed, when it’s due, and what it pays — all in one place. No more digging through texts.',
  },
  {
    icon: 'cloud-snow', photo: photos.dusk,
    title: 'We watch the\nroad ahead',
    body: 'Storm, ice, and high-wind warnings before you reach them — and your hours kept legal. We’ll ask to use your location.',
  },
  {
    icon: 'message-circle', photo: photos.cab,
    title: 'Your dispatcher,\none tap away',
    body: 'Message, send a voice note, or call — and snap proof of delivery in seconds. We’ll ask about notifications and your camera.',
  },
];

export default function Onboarding() {
  const { colors } = useTheme();
  const { completeOnboarding } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scroller = useRef(null);
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const styles = makeStyles(colors);
  // Cap the hero so the body always clears the pinned action bar, even on short phones.
  const heroH = Math.min(Math.round(height * 0.54), height - 380);

  const finish = () => { completeOnboarding(); router.replace('/(auth)/sign-in'); };
  const next = () => (last ? finish() : scroller.current?.scrollTo({ x: (i + 1) * width, animated: true }));
  const onScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    if (idx !== i) setI(idx);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={32}
      >
        {SLIDES.map((s, k) => (
          <View key={k} style={{ width, height }}>
            <CinematicHero photo={s.photo} active={k === i} style={{ height: heroH }} />
            <View style={styles.body}>
              <View style={[styles.iconWrap, { backgroundColor: colors.tealFill }]}>
                <Icon name={s.icon} size={26} color={colors.teal} />
              </View>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{s.title}</Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>{s.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Pinned brand + skip (over the photo). */}
      <View style={[styles.top, { paddingTop: insets.top + 16 }]} pointerEvents="box-none">
        <BrandLogo layout="wordmark" tone="light" size={22} />
        {!last ? (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        ) : <View style={{ width: 44 }} />}
      </View>

      {/* Pinned dots + action — the button that never moves. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space[5] }]} pointerEvents="box-none">
        <View style={styles.dots}>
          {SLIDES.map((_, k) => (
            <View
              key={k}
              style={[styles.dot, { width: k === i ? 24 : 8, backgroundColor: k === i ? colors.teal : colors.surfaceHi }]}
            />
          ))}
        </View>
        <PrimaryAction label={last ? 'Get started' : 'Next'} icon={last ? 'check' : 'arrow-right'} onPress={next} />
      </View>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, paddingHorizontal: space[6], paddingTop: space[2], paddingBottom: 140, marginTop: -16, gap: space[3] },
  iconWrap: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.h1, lineHeight: 34 },
  sub: { ...type.body, lineHeight: 25 },
  top: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: space[6],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  skip: { ...type.bodyStrong, color: '#FFFFFF' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space[6], gap: space[5],
  },
  dots: { flexDirection: 'row', gap: 8, alignSelf: 'flex-start' },
  dot: { height: 8, borderRadius: 999 },
});
