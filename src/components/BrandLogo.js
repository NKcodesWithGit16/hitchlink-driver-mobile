import { View, Image, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { FONT } from '../theme/tokens';

const MARK = require('../../assets/logo-mark.png');
const WORDMARK_WHITE = require('../../assets/wordmark-white.png');
const WORDMARK_BLACK = require('../../assets/wordmark-black.png');
const WORDMARK_RATIO = 3.5; // mark + "HitchLink"

/* The real HitchLink mark (navy+teal "H" + hitch arrow + road).
   layout: 'icon' (mark only) | 'horizontal' (mark + themed "HitchLink" text)
           | 'wordmark' (official baked PNG, white on dark / black on light) */
export default function BrandLogo({ size = 26, layout = 'horizontal', tone = 'auto', style }) {
  const { colors, isDay } = useTheme();
  const useWhite = tone === 'light' || (tone === 'auto' && !isDay);

  if (layout === 'wordmark') {
    return (
      <View style={[styles.row, style]}>
        <Image
          source={useWhite ? WORDMARK_WHITE : WORDMARK_BLACK}
          style={{ width: Math.round(size * WORDMARK_RATIO), height: size }}
          resizeMode="contain"
          accessibilityLabel="HitchLink"
        />
      </View>
    );
  }

  const mark = (
    <Image source={MARK} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="HitchLink logo" />
  );

  if (layout === 'icon') return <View style={[styles.row, style]}>{mark}</View>;

  const wordColor = tone === 'light' ? '#FFFFFF' : colors.textPrimary;
  return (
    <View style={[styles.row, style]}>
      {mark}
      <Text style={[styles.word, { fontSize: size * 0.7, color: wordColor }]}>HitchLink</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { fontFamily: FONT.extrabold, letterSpacing: -0.4 },
});
