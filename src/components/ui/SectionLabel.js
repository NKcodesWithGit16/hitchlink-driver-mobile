import { Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { type, space } from '../../theme/tokens';

export default function SectionLabel({ children, style }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ ...type.label, color: colors.textMuted, marginBottom: space[3], marginTop: space[2] }, style]}>
      {children}
    </Text>
  );
}
