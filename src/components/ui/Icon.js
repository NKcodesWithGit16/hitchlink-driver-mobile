import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Single icon entry point so the set can be swapped in one place.
export default function Icon({ name, size = 20, color, style }) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.textPrimary} style={style} />;
}
