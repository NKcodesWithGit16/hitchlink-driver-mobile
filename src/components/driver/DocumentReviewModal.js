// Review/edit step shown after picking a file to add on the Documents tab.
// When the picked file is an image, documents.js has already tried an AI
// (Claude Haiku vision) read of it — this screen shows whatever came back
// (or a blank form if extraction was skipped/failed/quota-exhausted) and lets
// the driver correct it before anything is actually saved. Self-contained and
// theme-driven, like the app's other overlays (see LoadDetailSheet.js).

import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import haptics from '../../lib/haptics';
import { uploadDocument, DOC_TYPE_META } from '../../api/main';
import { useT } from '../../i18n/LanguageContext';
import { space, radius, FONT, type } from '../../theme/tokens';

const TYPE_OPTIONS = ['License', 'MedicalCard', 'Insurance', 'Registration', 'Inspection', 'Other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Chip labels for the type picker — kept separate from DOC_TYPE_META (which
// also backstops the Documents list's fallback label/sub for real backend
// data) so this purely-UI translation doesn't touch that shared data path.
const TYPE_LABEL_KEYS = {
  License: 'documents.typeLicense',
  MedicalCard: 'documents.typeMedicalCard',
  Insurance: 'documents.typeInsurance',
  Registration: 'documents.typeRegistration',
  Inspection: 'documents.typeInspection',
  Other: 'documents.typeOther',
};

const extractionErrorMessage = (err, t) => {
  if (!err) return null;
  if (err.status === 429) return t('documents.quotaUsedUp');
  if (err.status === 503) return t('documents.aiUnavailable');
  return t('documents.couldntReadAuto');
};

export default function DocumentReviewModal({ visible, asset, extraction, extractionError, driverId, onSaved, onCancel, colors }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [docType, setDocType] = useState('Other');
  const [label, setLabel] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const f = extraction?.fields;
    const nextType = TYPE_OPTIONS.includes(f?.documentType) ? f.documentType : 'Other';
    setDocType(nextType);
    // Always start with a usable label, even when there's no AI extraction
    // (non-image file, AI unavailable, quota exhausted) — otherwise Save has
    // nothing to submit and the driver has no obvious next step.
    setLabel(f?.label || t(TYPE_LABEL_KEYS[nextType]));
    setDocumentNumber(f?.documentNumber || '');
    setExpiresAt(f?.expiresAt || '');
    setFormError('');
  }, [visible, extraction, t]);

  if (!visible || !asset) return null;

  const lowConfidence = new Set((extraction?.lowConfidenceFields || []).map((s) => s.toLowerCase()));

  // Save is never silently disabled — an empty/invalid field surfaces a
  // message instead of the button just doing nothing when tapped.
  const save = async () => {
    if (saving) return;
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setFormError(t('documents.enterLabel'));
      haptics.error();
      return;
    }
    const trimmedDate = expiresAt.trim();
    if (trimmedDate && !DATE_RE.test(trimmedDate)) {
      setFormError(t('documents.expiryFormatError'));
      haptics.error();
      return;
    }
    setFormError('');
    setSaving(true);
    haptics.press();
    try {
      await uploadDocument(driverId, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        sizeBytes: asset.size,
        base64: asset.base64,
        type: docType,
        label: trimmedLabel,
        documentNumber: documentNumber.trim() || null,
        expiresAt: trimmedDate || null,
      });
      haptics.success();
      onSaved?.();
    } catch {
      setFormError(t('documents.saveFailedError'));
      haptics.error();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('documents.cancel')}>
            <Text style={[styles.headerAction, { color: colors.textSecondary }]}>{t('documents.cancel')}</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t('documents.reviewDocument')}</Text>
          <Pressable onPress={save} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('documents.saveDocumentA11y')}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.teal} />
            ) : (
              <Text style={[styles.headerAction, { color: colors.teal, fontFamily: FONT.black }]}>{t('documents.save')}</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space[8] }]} keyboardShouldPersistTaps="handled">
          {extractionError ? (
            <View style={[styles.banner, { backgroundColor: colors.cautionFill, borderColor: colors.caution + '55' }]}>
              <Icon name="alert-triangle" size={15} color={colors.caution} />
              <Text style={[styles.bannerText, { color: colors.textPrimary }]}>{extractionErrorMessage(extractionError, t)}</Text>
            </View>
          ) : extraction ? (
            <View style={[styles.banner, { backgroundColor: colors.tealFill, borderColor: colors.teal + '44' }]}>
              <Icon name="check-circle" size={15} color={colors.teal} />
              <Text style={[styles.bannerText, { color: colors.textPrimary }]}>{t('documents.autoFilledNote')}</Text>
            </View>
          ) : null}

          {/* Type chips */}
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('documents.documentType')}</Text>
          <View style={styles.chipRow}>
            {TYPE_OPTIONS.map((docTypeKey) => {
              const active = docType === docTypeKey;
              const meta = DOC_TYPE_META[docTypeKey];
              const typeLabel = t(TYPE_LABEL_KEYS[docTypeKey]);
              return (
                <Pressable
                  key={docTypeKey}
                  onPress={() => {
                    haptics.tap();
                    // Keep the label in sync with the type unless the driver already
                    // typed something custom over the previous default.
                    setLabel((prev) => (!prev.trim() || prev === t(TYPE_LABEL_KEYS[docType])) ? typeLabel : prev);
                    setDocType(docTypeKey);
                  }}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.teal : colors.border, backgroundColor: active ? colors.teal + '22' : colors.surface },
                  ]}
                >
                  <Icon name={meta.icon} size={13} color={active ? colors.teal : colors.textMuted} />
                  <Text style={[styles.chipText, { color: active ? colors.teal : colors.textMuted }]}>{typeLabel}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Fields */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <FieldRow
              label={t('documents.fieldLabel')} value={label} onChangeText={setLabel}
              placeholder={t('documents.fieldLabelPlaceholder')} lowConfidence={lowConfidence.has('label')}
              colors={colors} styles={styles} hint={t('documents.doubleCheck')}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <FieldRow
              label={t('documents.fieldNumber')} value={documentNumber} onChangeText={setDocumentNumber}
              placeholder={t('documents.fieldNumberPlaceholder')} autoCapitalize="characters" lowConfidence={lowConfidence.has('documentnumber')}
              colors={colors} styles={styles} hint={t('documents.doubleCheck')}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <FieldRow
              label={t('documents.fieldExpires')} value={expiresAt} onChangeText={setExpiresAt}
              placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" lowConfidence={lowConfidence.has('expiresat')}
              colors={colors} styles={styles} hint={t('documents.doubleCheck')}
            />
          </View>

          {formError ? (
            <View style={styles.errorRow}>
              <Icon name="alert-circle" size={14} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{formError}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function FieldRow({ label, value, onChangeText, placeholder, lowConfidence, hint, colors, styles, ...inputProps }) {
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldTop}>
        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
        {lowConfidence ? <Text style={[styles.fieldHint, { color: colors.caution }]}>{hint}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.fieldInput, { color: colors.textPrimary, borderColor: colors.border }]}
        {...inputProps}
      />
    </View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5], paddingVertical: space[3],
  },
  headerAction: { fontSize: 15, fontFamily: FONT.bold, minWidth: 44 },
  headerTitle: { fontSize: 16, fontFamily: FONT.bold, color: c.textPrimary },

  scroll: { paddingHorizontal: space[5], gap: space[4] },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    borderWidth: 1, borderRadius: radius.md, padding: space[3],
  },
  bannerText: { ...type.caption, flex: 1, lineHeight: 19 },

  sectionLabel: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: -space[1] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[3], height: 36, borderRadius: radius.pill, borderWidth: 1,
  },
  chipText: { fontSize: 12.5, fontFamily: FONT.bold },

  card: { borderRadius: radius.xl, borderWidth: 1, paddingHorizontal: space[4] },
  divider: { height: 1 },

  fieldRow: { paddingVertical: 12, gap: 6 },
  fieldTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 12.5, fontFamily: FONT.bold },
  fieldHint: { fontSize: 11, fontFamily: FONT.bold },
  fieldInput: {
    fontSize: 15, fontFamily: FONT.semibold, padding: 0,
    borderBottomWidth: 1, paddingBottom: 8,
  },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space[2] },
  errorText: { fontSize: 12, fontFamily: FONT.bold, flex: 1 },
});
