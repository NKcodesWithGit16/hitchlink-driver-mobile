import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, space, elevation as ELEV } from '../../theme/tokens';

/* Base surface. `elevation` (0–4) picks a layer from the depth scale;
   `elevated` is kept as a shorthand for level 2 (back-compat). */
export default function Card({ children, style, padded = true, elevated = false, elevation }) {
  const { colors } = useTheme();
  const lvl = elevation != null ? elevation : elevated ? 2 : 0;
  return (
    <View
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border },
        padded && { padding: space[5] },
        ELEV[lvl],
        style,
      ]}
    >
      {children}
    </View>
  );
}
