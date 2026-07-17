import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

const FAMILIES = {
  feather: Feather,
  ionicons: Ionicons,
  'material-community': MaterialCommunityIcons,
};

// Single icon entry point so the set can be swapped in one place. Defaults to
// Feather (matches the rest of the app); pass `family` to reach into Ionicons
// or MaterialCommunityIcons for a specific glyph Feather doesn't have a good
// version of (e.g. a proper filled "hang up" receiver).
export default function Icon({ name, family = 'feather', size = 20, color, style }) {
  const { colors } = useTheme();
  const Family = FAMILIES[family] ?? Feather;
  return <Family name={name} size={size} color={color ?? colors.textPrimary} style={style} />;
}
