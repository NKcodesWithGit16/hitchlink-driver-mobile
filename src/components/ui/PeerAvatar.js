import { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeContext';
import { FONT } from '../../theme/tokens';

/* Round avatar for the person on the other end of the conversation — the
   dispatcher, today. Falls back to the teal-gradient initials this app already
   used everywhere before dispatchers had photos, so a driver whose dispatcher
   hasn't set one sees no visual change.

   `photoUrl` is a presigned R2 GET that eventually expires; a load failure drops
   back to initials rather than leaving a blank circle, and the failure resets
   whenever the URL changes so a freshly-signed one is retried. */
export default function PeerAvatar({ photoUrl, name, size = 48, style }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [photoUrl]);

  const dims = { width: size, height: size, borderRadius: 999 };

  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.base, dims, { backgroundColor: colors.surface2 }, style]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const initials = (name || 'D')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <LinearGradient colors={colors.gradients.teal} style={[styles.base, dims, style]}>
      {/* Scales with the circle so the 16px "seen" dot and the 48px header
          avatar both stay legible off one component. */}
      <Text style={[styles.initials, { color: colors.onAccent, fontSize: Math.max(8, Math.round(size * 0.34)) }]}>
        {initials}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
  initials: { fontFamily: FONT.black },
});
