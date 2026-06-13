import { View, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme/ThemeContext';
import { radius as R, glassFor } from '../../theme/tokens';

/* Frosted "glass" surface — the signature material of Modern Depth, used for
   OVERLAYS only (toasts, modals, sheets), never working surfaces. The blur
   reads as premium depth; the translucent overlay behind content is the
   legibility floor so text stays readable even where blur is weak (some
   Android) or the backdrop is busy. Day frosts light, night frosts dark. */
export default function GlassView({ children, style, radius = R.xl, intensity, border = true }) {
  const { colors } = useTheme();
  const g = glassFor(colors);
  return (
    <View
      style={[
        { borderRadius: radius, overflow: 'hidden' },
        border && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      <BlurView
        intensity={intensity ?? g.intensity}
        tint={g.tint}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: g.overlay }]} />
      {children}
    </View>
  );
}
