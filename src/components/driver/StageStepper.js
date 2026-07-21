import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { type, FONT, shadow } from '../../theme/tokens';
import { stageIndex } from '../../lib/load';
import { useT } from '../../i18n/LanguageContext';

export default function StageStepper({ status }) {
  const { colors } = useTheme();
  const t = useT();
  const active = stageIndex(status);
  const stages = t('load.stages');
  const last = stages.length - 1;

  return (
    <View style={styles.wrap}>
      {stages.map((label, i) => {
        const done = i < active;
        const here = i === active;
        const lineLeft  = i > 0;
        const lineRight = i < last;
        const lineDoneLeft  = i <= active;
        const lineDoneRight = i < active;

        return (
          <View key={label} style={styles.seg}>
            <View style={styles.row}>
              {/* left connector — invisible on first segment */}
              <View style={[
                styles.line,
                { backgroundColor: lineDoneLeft ? colors.teal : colors.surfaceHi,
                  opacity: lineLeft ? 1 : 0 },
              ]} />

              {/* dot */}
              <View style={[
                styles.dot,
                { backgroundColor: done || here ? colors.teal : colors.surfaceHi,
                  borderColor: here ? colors.tealBright : done ? colors.teal : colors.surfaceHi,
                  borderWidth: here ? 2.5 : 2,
                  transform: [{ scale: here ? 1.25 : 1 }] },
                here ? shadow.glow(colors.teal) : null,
              ]} />

              {/* right connector — invisible on last segment */}
              <View style={[
                styles.line,
                { backgroundColor: lineDoneRight ? colors.teal : colors.surfaceHi,
                  opacity: lineRight ? 1 : 0 },
              ]} />
            </View>

            <Text
              style={[
                styles.label,
                { color: here ? colors.teal : done ? colors.textSecondary : colors.textMuted,
                  fontFamily: here ? FONT.extrabold : FONT.medium },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', paddingVertical: 8 },
  seg: { flex: 1, minWidth: 0, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  dot: { width: 20, height: 20, borderRadius: 999, flexShrink: 0, zIndex: 1 },
  line: { flex: 1, height: 4, borderRadius: 2 },
  label: { ...type.caption, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
