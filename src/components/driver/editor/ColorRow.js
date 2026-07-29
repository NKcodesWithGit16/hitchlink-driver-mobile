import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import Icon from '../../ui/Icon';
import { space } from '../../../theme/tokens';

// The colour strip along the bottom of draw and text, with the eraser leading
// it — the same shape as Messenger's.
//
// The eraser sits here rather than being its own tool because it belongs to the
// same decision: what does my next touch do. Undo only walks backwards, so
// fixing the first of five marks without an eraser means losing the other four.
//
// Selection is shown by size — the active swatch grows and gains a ring — which
// survives a glance in a moving cab better than a subtle border would.

export const EDITOR_COLORS = [
  '#FFFFFF', '#1C1C1E', '#32ADE6', '#34C759', '#FFCC00',
  '#FF3B30', '#FF2D95', '#FF9FC7', '#7B5BFF',
];

const DOT = 30;
const DOT_ACTIVE = 40;

export default function ColorRow({ color, onPick, erasing, onToggleErase, style }) {
  return (
    <View style={[styles.wrap, style]}>
      {onToggleErase ? (
        <Pressable
          onPress={onToggleErase}
          style={[styles.eraser, erasing && styles.eraserActive]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ selected: !!erasing }}
        >
          <Icon name="eraser" family="material-community" size={22} color={erasing ? '#0A0E14' : '#FFFFFF'} />
        </Pressable>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {EDITOR_COLORS.map((c) => {
          const active = !erasing && c === color;
          const size = active ? DOT_ACTIVE : DOT;
          return (
            <Pressable
              key={c}
              onPress={() => onPick(c)}
              hitSlop={4}
              style={styles.slot}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  { width: size, height: size, borderRadius: size / 2, backgroundColor: c },
                  active ? styles.dotActive : styles.dot,
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingLeft: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[2], gap: space[2] },
  // Every slot is the active width so the row doesn't reflow as selection moves.
  slot: { width: DOT_ACTIVE, height: DOT_ACTIVE, alignItems: 'center', justifyContent: 'center' },
  dot: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
  dotActive: { borderWidth: 3, borderColor: '#FFFFFF' },

  eraser: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  eraserActive: { backgroundColor: '#FFFFFF' },
});
