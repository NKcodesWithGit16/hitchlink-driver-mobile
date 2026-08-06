import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COUNTRIES, countryByCode } from '../../data/countries';
import { useTheme } from '../../theme/ThemeContext';
import { radius, space, tap, type } from '../../theme/tokens';
import Icon from './Icon';

/**
 * Country picker for the phone fields.
 *
 * Flags are emoji built from the ISO code, not images. A driver fills this in
 * at the roadside as often as at home, and 217 flag PNGs fetched from a CDN is
 * 217 blank boxes with no signal. Regional indicator pairs render from the
 * system font, offline, with nothing to bundle.
 */
function flagEmoji(code) {
  // 'US' -> two regional indicator symbols. 0x1F1E6 is 'A'.
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Lower is a better match. Mirrors the web picker so the two behave the same:
 * "ge" reaches Georgia and Germany before Algeria, "1" reaches the US.
 */
function rank(country, nq, digits) {
  const name = norm(country.name);
  if (name.startsWith(nq)) return 0;
  if (nq.length <= 3 && country.code.toLowerCase().startsWith(nq)) return 1;
  if (digits && country.dial.startsWith(digits)) return 2;
  if (name.includes(nq)) return 3;
  return -1;
}

function search(query) {
  const q = query.trim();
  if (!q) return COUNTRIES;

  const nq = norm(q);
  const digits = q.replace(/\D/g, '');

  const hits = [];
  for (const country of COUNTRIES) {
    const score = rank(country, nq, digits);
    if (score >= 0) hits.push({ country, score });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.map((h) => h.country);
}

export default function CountrySelect({ value, onChange, disabled = false, label = 'Country code' }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const selected = countryByCode(value);
  const results = useMemo(() => search(query), [query]);

  // Opens on a clean list showing everything — reopening onto the last search
  // would present a three-row list with no visible reason why.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    // Autofocus fires before the modal has finished animating on Android.
    const id = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(id);
  }, [open]);

  const choose = (country) => {
    onChange(country.code);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.trigger,
          pressed && !disabled && styles.triggerPressed,
          disabled && styles.triggerDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected.name} +${selected.dial}`}
      >
        <Text style={styles.flag}>{flagEmoji(selected.code)}</Text>
        <Text style={styles.dial} numberOfLines={1}>+{selected.dial}</Text>
        <Icon name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={[styles.sheet, { paddingTop: insets.top ? space[3] : space[5] }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityRole="button">
              <Icon name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Icon name="search" size={17} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search country or code"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              // Selecting the first hit on Enter is what someone who typed a
              // full country name expects; scrolling to tap it is a wasted step.
              onSubmitEditing={() => results[0] && choose(results[0])}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                <Icon name="x-circle" size={17} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={results}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
            // The list is long and every row is the same height, so let
            // FlatList skip measuring — it makes the initial open snappy.
            getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
            ListEmptyComponent={
              <Text style={styles.empty}>No country matches “{query.trim()}”.</Text>
            }
            renderItem={({ item }) => {
              const isSelected = item.code === selected.code;
              return (
                <Pressable
                  onPress={() => choose(item)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.rowFlag}>{flagEmoji(item.code)}</Text>
                  <Text style={[styles.rowName, isSelected && styles.rowNameSelected]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowDial}>+{item.dial}</Text>
                  {isSelected && <Icon name="check" size={17} color={colors.teal} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const ROW_HEIGHT = 52;

const makeStyles = (colors) => StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    // tap.secondary: this sits beside a text input a driver hits with gloves on.
    height: tap.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  triggerPressed: { backgroundColor: colors.surfaceHi },
  triggerDisabled: { opacity: 0.5 },
  flag: { fontSize: 20 },
  dial: {
    flex: 1,
    ...type.body,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },

  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space[4],
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[3],
  },
  sheetTitle: { ...type.h2, color: colors.textPrimary },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    height: tap.icon,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    marginBottom: space[3],
  },
  searchInput: {
    flex: 1,
    ...type.body,
    color: colors.textPrimary,
    padding: 0,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: ROW_HEIGHT,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  rowPressed: { backgroundColor: colors.surface2 },
  rowFlag: { fontSize: 22 },
  rowName: { flex: 1, ...type.body, color: colors.textPrimary },
  rowNameSelected: { fontWeight: '700' },
  rowDial: {
    ...type.caption,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },

  empty: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: space[6],
  },
});
