import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, space, tap, type } from '../../theme/tokens';
import { formatNational, toE164 } from '../../lib/phone';
import CountrySelect from './CountrySelect';

/**
 * Country picker + national number, matching the web app's PhoneField.
 *
 * Controlled as two values rather than one E.164 string, for the same reason as
 * the web version: clearing the number would otherwise take the country with it
 * and leave the picker nothing to show.
 *
 * The label is rendered by the caller, so this drops into the existing `Field`
 * blocks in driver-register and edit-profile without them growing a second
 * label style. It does own its error line, because the error belongs to the
 * pair and not to either half.
 */
export default function PhoneField({
  country,
  onCountryChange,
  value,
  onChange,
  onFocus,
  onBlur,
  error,
  placeholder,
  editable = true,
  inputRef,
  countryLabel = 'Country code',
  showResolved = true,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const resolved = toE164(country, value);

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.pickerCol}>
          <CountrySelect
            value={country}
            onChange={onCountryChange}
            disabled={!editable}
            label={countryLabel}
          />
        </View>

        <View
          style={[
            styles.field,
            { borderColor: error ? colors.danger : colors.border },
            !editable && styles.fieldDisabled,
          ]}
        >
          <TextInput
            ref={inputRef}
            value={value ?? ''}
            // Reformatted per keystroke for the selected country, so the shape
            // changes the moment someone switches country.
            onChangeText={(next) => onChange(formatNational(country, next))}
            onFocus={onFocus}
            onBlur={onBlur}
            editable={editable}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            // iOS floats its own "Done" pill above a phone pad and it is the
            // only way to dismiss that keyboard — see edit-profile.js.
            returnKeyType="done"
          />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* The only place the country code is shown joined to the number before
          it is saved. The input itself is formatted for reading, not storage. */}
      {!error && showResolved && resolved.length > 6 ? (
        <Text style={styles.resolved}>Saved as {resolved}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  // Wide enough for a flag next to the longest dial code (+1268), and no wider
  // — the number is the part being read.
  pickerCol: { width: 118 },

  field: {
    flex: 1,
    justifyContent: 'center',
    height: tap.secondary,
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  fieldDisabled: { opacity: 0.5 },

  input: {
    ...type.body,
    ...type.num,
    color: colors.textPrimary,
    padding: 0,
  },

  error: {
    ...type.caption,
    color: colors.danger,
    marginTop: space[2],
  },
  resolved: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: space[2],
  },
});
