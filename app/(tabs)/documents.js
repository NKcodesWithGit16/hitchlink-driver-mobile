import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Image,
  Modal, Animated, Alert, RefreshControl, Linking, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import Icon from '../../src/components/ui/Icon';
import FadeInView from '../../src/components/ui/FadeInView';
import Skeleton from '../../src/components/ui/Skeleton';
import DocumentReviewModal from '../../src/components/driver/DocumentReviewModal';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import {
  fetchDocuments, uploadDocument, deleteDocument, fetchDocumentContent,
  extractDocumentFields, readDocumentBase64,
} from '../../src/api/main';
import { expiryStatus, fmtDate, daysUntil } from '../../src/lib/format';
import { space, type, radius, toneOf, FONT, shadow } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = useT();
  const { userId } = useAuth();

  const FILTERS = [
    { key: 'all',      label: t('documents.filterAll')      },
    { key: 'valid',    label: t('documents.filterValid')    },
    { key: 'expiring', label: t('documents.filterExpiring') },
    { key: 'expired',  label: t('documents.filterExpired')  },
  ];
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [docs, setDocs]     = useState([]);
  const [open, setOpen]     = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding]   = useState(false);

  // Add-document review flow: pick → (maybe) AI-extract → editable review
  // modal → save. The actual POST /documents happens inside the modal.
  const [reviewVisible, setReviewVisible]   = useState(false);
  const [reviewAsset, setReviewAsset]       = useState(null);
  const [reviewExtraction, setReviewExtraction]           = useState(null);
  const [reviewExtractionError, setReviewExtractionError] = useState(null);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const d = await fetchDocuments(userId);
      setDocs(d || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [userId, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const counts = useMemo(() => {
    const c = { valid: 0, expiring: 0, expired: 0 };
    docs.forEach(d => { c[expiryStatus(d.expires).key]++; });
    return c;
  }, [docs]);

  const visible = useMemo(() =>
    filter === 'all' ? docs : docs.filter(d => expiryStatus(d.expires).key === filter),
    [docs, filter]);

  // Picks a file, tries an AI read of it (images only, size-capped — see
  // extractDocumentFields), then always opens the review modal so the driver
  // confirms/corrects before anything is saved. Extraction failing is
  // expected (no quota left, AI not configured, non-image file) — it just
  // means the review modal opens blank instead of pre-filled.
  const addDoc = async () => {
    if (adding) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, base64: true });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset) return;

      setAdding(true);
      const base64 = await readDocumentBase64(asset.uri, asset.base64);

      let extraction = null;
      let extractionError = null;
      const isImage = asset.mimeType?.startsWith('image/');
      const underSizeCap = !asset.size || asset.size <= 8 * 1024 * 1024;
      if (isImage && underSizeCap) {
        try {
          extraction = await extractDocumentFields({ base64, mediaType: asset.mimeType });
        } catch (e) {
          extractionError = e;
        }
      }

      setReviewAsset({ ...asset, base64 });
      setReviewExtraction(extraction);
      setReviewExtractionError(extractionError);
      setReviewVisible(true);
    } catch {
      Alert.alert(t('documents.couldNotAdd'), t('documents.pleaseTryAgain'));
    } finally {
      setAdding(false);
    }
  };

  const closeReview = () => {
    setReviewVisible(false);
    setReviewAsset(null);
    setReviewExtraction(null);
    setReviewExtractionError(null);
  };

  const handleReviewSaved = async () => {
    closeReview();
    await loadData();
  };

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.head}>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('documents.title')}</Text>
          <Text style={[styles.headSub, { color: colors.textMuted }]}>
            {t('documents.onFile', { count: docs.length })}
            {counts.expiring > 0 ? ` · ${t('documents.expiringSoonCount', { count: counts.expiring })}` : ''}
            {counts.expired  > 0 ? ` · ${t('documents.expiredCount', { count: counts.expired })}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={addDoc}
          disabled={adding}
          style={[styles.addBtn, { backgroundColor: colors.teal, opacity: adding ? 0.7 : 1 }, shadow.glow(colors.teal)]}
          accessibilityLabel={t('documents.addA11y')}
        >
          <Icon name={adding ? 'loader' : 'plus'} size={18} color={colors.onAccent} />
          <Text style={[styles.addBtnText, { color: colors.onAccent }]}>{adding ? t('documents.adding') : t('documents.add')}</Text>
        </Pressable>
      </View>

      {/* ── Filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={{ flexShrink: 0 }}
      >
        {FILTERS.map(f => {
          const active = filter === f.key;
          const count  = f.key === 'all' ? docs.length : counts[f.key];
          const tone   = f.key === 'expiring' ? colors.caution : f.key === 'expired' ? colors.danger : colors.teal;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.filterChip,
                { borderColor: active ? tone : colors.border,
                  backgroundColor: active ? tone + '22' : colors.surface },
              ]}
            >
              <Text style={[styles.filterText, { color: active ? tone : colors.textMuted }]}>
                {f.label}
              </Text>
              {count > 0 && (
                <View style={[styles.filterBadge, { backgroundColor: active ? tone : colors.surfaceHi }]}>
                  <Text style={[styles.filterBadgeText, { color: active ? colors.onAccent : colors.textMuted }]}>
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Alert banner (expiring docs only) ── */}
      {counts.expiring > 0 && (
        <View style={[styles.alertBanner, { backgroundColor: colors.cautionFill, borderColor: colors.caution + '66' }]}>
          <View style={[styles.alertIcon, { backgroundColor: colors.cautionFill }]}>
            <Icon name="alert-triangle" size={16} color={colors.caution} />
          </View>
          <Text style={[styles.alertText, { color: colors.textPrimary }]} numberOfLines={2}>
            {counts.expiring === 1
              ? t('documents.oneExpiresSoon', { label: docs.find(d => expiryStatus(d.expires).key === 'expiring')?.label })
              : t('documents.manyExpireSoon', { count: counts.expiring })}
          </Text>
        </View>
      )}

      {/* ── Doc list ── */}
      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + TAB_BAR_CLEARANCE, gap: space[3] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {loading ? (
          [0, 1, 2, 3].map((i) => <DocCardSkeleton key={i} colors={colors} styles={styles} />)
        ) : error ? (
          <View style={styles.errorBox}>
            <View style={[styles.errorIcon, { backgroundColor: colors.cautionFill }]}>
              <Icon name="wifi-off" size={26} color={colors.caution} />
            </View>
            <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>{t('documents.couldntLoad')}</Text>
            <Text style={[styles.errorSub, { color: colors.textSecondary }]}>{t('documents.couldntLoadSub')}</Text>
            <Pressable
              onPress={onRefresh}
              style={[styles.retryBtn, { borderColor: colors.teal }]}
              accessibilityRole="button"
              accessibilityLabel={t('documents.tryAgainA11y')}
            >
              <Icon name="refresh-cw" size={15} color={colors.teal} />
              <Text style={[styles.retryText, { color: colors.teal }]}>{t('load.tryAgain')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {visible.map((doc, i) => (
              <FadeInView key={doc.id} delay={i * 70}>
                <DocCard doc={doc} onPress={() => setOpen(doc)} colors={colors} styles={styles} />
              </FadeInView>
            ))}
            {visible.length === 0 && (
              <View style={styles.empty}>
                <Icon name="folder" size={40} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('documents.noFilteredDocs', { filter: FILTERS.find(f => f.key === filter)?.label.toLowerCase() })}
                </Text>
              </View>
            )}
            <Text style={[styles.hint, { color: colors.textMuted }]}>
              {t('documents.offlineHint')}
            </Text>
          </>
        )}
      </ScrollView>

      <DocViewer
        doc={open}
        onClose={() => setOpen(null)}
        colors={colors}
        styles={styles}
        insets={insets}
        userId={userId}
        onUploaded={loadData}
      />

      <DocumentReviewModal
        visible={reviewVisible}
        asset={reviewAsset}
        extraction={reviewExtraction}
        extractionError={reviewExtractionError}
        driverId={userId}
        onSaved={handleReviewSaved}
        onCancel={closeReview}
        colors={colors}
      />
    </ScreenFade>
  );
}

/* ─────────── Doc Card ─────────── */

function DocCard({ doc, onPress, colors, styles }) {
  const reduce  = useReduceMotion();
  const t       = useT();
  const status  = expiryStatus(doc.expires);
  const days    = daysUntil(doc.expires);
  const tone    = toneOf(colors, status.tone);
  const barFill = Math.max(0, Math.min(1, (days ?? 0) / 365));
  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) { barAnim.setValue(barFill); return; }
    Animated.timing(barAnim, {
      toValue: barFill,
      duration: 700,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, [barFill, reduce]);

  const daysLabel =
    days == null  ? '' :
    days <= 0     ? t('documents.daysLeftExpired') :
    days === 1    ? t('documents.daysLeftOne') :
    days < 30     ? t('documents.daysLeftN', { n: days }) :
    days < 365    ? t('documents.moLeft', { n: Math.round(days / 30) }) :
                    t('documents.yrLeft', { n: Math.round(days / 365 * 10) / 10 });

  const statusLabel = t(status.labelKey, status.labelParams);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.docCard,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('documents.docCardA11y', { label: doc.label, status: statusLabel })}
    >
      {/* Status stripe */}
      <View style={[styles.stripe, { backgroundColor: tone.solid }]} />

      <View style={styles.docBody}>
        {/* Top row: icon + label + badge */}
        <View style={styles.docTop}>
          <View style={[styles.docIcon, { backgroundColor: tone.fill }]}>
            <Icon name={doc.icon || 'file-text'} size={20} color={tone.solid} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.docLabel, { color: colors.textPrimary }]} numberOfLines={1}>
              {doc.label}
            </Text>
            <Text style={[styles.docSub, { color: colors.textMuted }]} numberOfLines={1}>
              {doc.sub}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: tone.solid }]} />
            <Text style={[styles.statusText, { color: tone.solid }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Doc number */}
        <View style={[styles.numberRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <Icon name="hash" size={12} color={colors.textMuted} />
          <Text style={[styles.docNumber, { color: colors.textSecondary }]}>{doc.number}</Text>
        </View>

        {/* Expiry bar + meta */}
        <View style={styles.expirySection}>
          <View style={[styles.barTrack, { backgroundColor: colors.surfaceHi }]}>
            <Animated.View
              style={[
                styles.barFill,
                {
                  width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  backgroundColor: tone.solid,
                },
              ]}
            />
          </View>
          <View style={styles.expiryMeta}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="calendar" size={11} color={colors.textMuted} />
              <Text style={[styles.expiryDate, { color: colors.textMuted }]}>
                {t('documents.expiresOn', { date: fmtDate(doc.expires, t('common.monthsShort')) })}
              </Text>
            </View>
            <Text style={[styles.daysLeft, { color: tone.solid }]}>{daysLabel}</Text>
          </View>
        </View>
      </View>

      <Icon name="chevron-right" size={16} color={colors.textMuted} style={{ alignSelf: 'center', marginRight: space[3] }} />
    </Pressable>
  );
}

/* ─────────── Loading skeleton ─────────── */

function DocCardSkeleton({ colors, styles }) {
  return (
    <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.stripe, { backgroundColor: colors.surfaceHi }]} />
      <View style={styles.docBody}>
        <View style={styles.docTop}>
          <Skeleton width={44} height={44} radius={radius.md} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={68} height={22} radius={radius.pill} />
        </View>
        <Skeleton width="100%" height={5} radius={999} style={{ marginTop: space[2] }} />
      </View>
    </View>
  );
}

/* ─────────── Doc Viewer ─────────── */

function DocViewer({ doc, onClose, colors, styles, insets, userId, onUploaded }) {
  const [uploading, setUploading]   = useState(false);
  const [viewing, setViewing]       = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [previewUri, setPreviewUri] = useState(null);
  const t = useT();
  if (!doc) return null;
  const status = expiryStatus(doc.expires);
  const days   = daysUntil(doc.expires);
  const tone   = toneOf(colors, status.tone);
  const hasFile = !!(doc.hasContent || doc.url);

  const viewFile = async () => {
    if (viewing || !hasFile) return;
    setViewing(true);
    try {
      if (doc.url && !doc.hasContent) {
        await Linking.openURL(doc.url);
        return;
      }
      const result = await fetchDocumentContent(doc.id, doc.fileName || doc.label);
      if (!result) {
        Alert.alert(t('documents.notAvailableTitle'), t('documents.notAvailableBody'));
        return;
      }
      if (Platform.OS === 'web') {
        window.open(result.blobUrl, '_blank');
      } else if (result.contentType?.startsWith('image/')) {
        setPreviewUri(result.uri);
      } else {
        const available = await Sharing.isAvailableAsync();
        if (!available) throw new Error('Sharing unavailable on this device');
        await Sharing.shareAsync(result.uri, { mimeType: result.contentType });
      }
    } catch {
      Alert.alert(t('documents.couldNotOpen'), t('documents.pleaseTryAgain'));
    } finally {
      setViewing(false);
    }
  };

  const doDelete = () => {
    Alert.alert(t('documents.deleteDocQ'), t('documents.deleteDocBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteDocument(doc.id);
            await onUploaded?.();
            onClose();
          } catch {
            Alert.alert(t('documents.couldNotDelete'), t('documents.pleaseTryAgain'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const uploadRenewal = async () => {
    if (uploading) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, base64: true });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      setUploading(true);
      await uploadDocument(userId, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        sizeBytes: asset.size,
        base64: asset.base64,
        type: doc.type,
        expiresAt: doc.expires,
      });
      await onUploaded?.();
      Alert.alert(t('documents.uploaded'), t('documents.renewalSaved'));
      onClose();
    } catch {
      Alert.alert(t('documents.couldNotUpload'), t('documents.pleaseTryAgain'));
    } finally {
      setUploading(false);
    }
  };

  const daysLabel =
    days == null ? '' :
    days <= 0    ? t('documents.expiredNote') :
    days === 1   ? t('documents.remainingOne') :
                   t('documents.remainingN', { n: days });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.viewer, { backgroundColor: colors.bg }]}>

        {/* Gradient header */}
        <LinearGradient
          colors={tone.grad}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.viewerHeader, { paddingTop: insets.top + space[3] }]}
        >
          <Pressable onPress={onClose} style={styles.backBtn} accessibilityLabel={t('documents.closeA11y')}>
            <Icon name="arrow-left" size={22} color="rgba(255,255,255,0.9)" />
          </Pressable>
          <View style={styles.viewerIconWrap}>
            <View style={styles.viewerIconCircle}>
              <Icon name={doc.icon || 'file-text'} size={40} color={tone.solid} />
            </View>
          </View>
          <Text style={styles.viewerDocName}>{doc.label}</Text>
          <Text style={styles.viewerDocSub}>{doc.sub}</Text>
        </LinearGradient>

        {/* Detail card */}
        <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: 40 }}>
          <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            <DetailRow icon="hash"     label={t('documents.documentNumber')} value={doc.number}          colors={colors} styles={styles} mono />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
            <DetailRow icon="calendar" label={t('documents.expiryDate')}     value={fmtDate(doc.expires, t('common.monthsShort'))} colors={colors} styles={styles} />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

            {/* Status row */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Icon name="shield" size={15} color={colors.textMuted} />
                <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{t('documents.status')}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
                <View style={[styles.statusDot, { backgroundColor: tone.solid }]} />
                <Text style={[styles.statusText, { color: tone.solid }]}>{t(status.labelKey, status.labelParams)}</Text>
              </View>
            </View>

            {/* Countdown */}
            {days != null && (
              <>
                <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                <View style={styles.countdownSection}>
                  <View style={[styles.barTrack, { backgroundColor: colors.surfaceHi, height: 8 }]}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(0, Math.min(100, (days / 365) * 100))}%`,
                          backgroundColor: tone.solid, borderRadius: 999 },
                      ]}
                    />
                  </View>
                  <Text style={[styles.countdownText, { color: tone.solid }]}>{daysLabel}</Text>
                </View>
              </>
            )}
          </View>

          {/* Action buttons */}
          <Pressable
            onPress={uploadRenewal}
            disabled={uploading}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: tone.solid, opacity: pressed || uploading ? 0.85 : 1 },
              shadow.glow(tone.solid),
            ]}
          >
            <Icon name={uploading ? 'loader' : 'upload'} size={18} color={colors.onAccent} />
            <Text style={[styles.actionBtnText, { color: colors.onAccent }]}>
              {uploading ? t('documents.uploading') : t('documents.uploadRenewal')}
            </Text>
          </Pressable>

          <Pressable
            onPress={viewFile}
            disabled={viewing || !hasFile}
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed || viewing ? 0.85 : hasFile ? 1 : 0.5 },
            ]}
          >
            <Icon name={viewing ? 'loader' : 'eye'} size={18} color={colors.textSecondary} />
            <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>
              {viewing ? t('documents.opening') : hasFile ? t('documents.viewDocument') : t('documents.noFileAttached')}
            </Text>
          </Pressable>

          <Pressable
            onPress={doDelete}
            disabled={deleting}
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: colors.danger + '55', backgroundColor: colors.dangerFill, opacity: pressed || deleting ? 0.85 : 1 },
            ]}
          >
            <Icon name={deleting ? 'loader' : 'trash-2'} size={18} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>
              {deleting ? t('documents.deleting') : t('documents.deleteDocument')}
            </Text>
          </Pressable>
        </ScrollView>

      </View>

      {previewUri ? (
        <Modal visible animationType="fade" transparent onRequestClose={() => setPreviewUri(null)}>
          <View style={styles.previewOverlay}>
            <Pressable
              onPress={() => setPreviewUri(null)}
              style={[styles.previewClose, { top: insets.top + space[3] }]}
              accessibilityRole="button"
              accessibilityLabel={t('documents.closePreviewA11y')}
            >
              <Icon name="x" size={22} color="#FFFFFF" />
            </Pressable>
            <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
}

function DetailRow({ icon, label, value, mono, colors, styles }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Icon name={icon} size={15} color={colors.textMuted} />
        <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, { color: colors.textPrimary }, mono && styles.mono]}>
        {value}
      </Text>
    </View>
  );
}

/* ─────────── Styles ─────────── */

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },

  /* Header */
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[1],
  },
  title: { ...type.h1 },
  headSub: { ...type.caption, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[4], paddingVertical: 10,
    borderRadius: radius.pill,
  },
  addBtnText: { fontSize: 13, fontFamily: FONT.bold },

  /* Filter row */
  filterRow: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2], flexDirection: 'row' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[3], height: 36,
    borderRadius: radius.pill, borderWidth: 1,
  },
  filterText: { fontSize: 13, fontFamily: FONT.bold, lineHeight: 16 },
  filterBadge: { borderRadius: radius.pill, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 11, fontFamily: FONT.black, lineHeight: 14 },

  /* Alert banner */
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    marginHorizontal: space[4], marginBottom: space[3],
    borderWidth: 1, borderRadius: radius.md,
    padding: space[3],
  },
  alertIcon: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  alertText: { ...type.caption, fontFamily: FONT.bold, flex: 1, lineHeight: 19 },

  /* Doc card */
  docCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden',
  },
  stripe: { width: 5, alignSelf: 'stretch', flexShrink: 0 },
  docBody: { flex: 1, padding: space[4], gap: space[3] },
  docTop: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  docIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  docLabel: { ...type.bodyStrong, fontSize: 15 },
  docSub: { ...type.caption, marginTop: 1 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, flexShrink: 0,
  },
  statusDot: { width: 6, height: 6, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: FONT.black },

  numberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.surface2, borderRadius: radius.md,
    borderWidth: 1, paddingHorizontal: space[3], paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  docNumber: { fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.5 },

  expirySection: { gap: 7 },
  barTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  expiryMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expiryDate: { fontSize: 11, fontFamily: FONT.medium },
  daysLeft: { fontSize: 11, fontFamily: FONT.black },

  /* Empty state */
  empty: { alignItems: 'center', paddingVertical: space[10], gap: space[3] },
  emptyText: { ...type.body },

  hint: { ...type.caption, textAlign: 'center', marginTop: space[3], lineHeight: 19 },

  /* Viewer */
  viewer: { flex: 1 },
  viewerHeader: {
    paddingHorizontal: space[5], paddingBottom: space[6],
    alignItems: 'center', gap: 4,
  },
  backBtn: {
    alignSelf: 'flex-start', width: 42, height: 42,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999,
    marginBottom: space[4],
  },
  viewerIconWrap: { marginBottom: space[3] },
  viewerIconCircle: {
    width: 88, height: 88, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    ...shadow.float,
  },
  viewerDocName: { fontSize: 26, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.5 },
  viewerDocSub: { fontSize: 14, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.7)' },

  /* Detail card */
  detailCard: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4], gap: space[3] },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { ...type.caption, fontFamily: FONT.bold },
  detailValue: { ...type.bodyStrong, textAlign: 'right' },
  mono: { fontFamily: FONT.bold, letterSpacing: 0.8 },
  detailDivider: { height: 1, marginHorizontal: space[4] },
  countdownSection: { padding: space[4], gap: 8 },
  countdownText: { fontSize: 13, fontFamily: FONT.black, textAlign: 'center' },

  /* Action buttons */
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, paddingVertical: 16,
  },
  actionBtnOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, paddingVertical: 16, borderWidth: 1,
  },
  actionBtnText: { fontSize: 15, fontFamily: FONT.bold },

  /* Full-screen image preview */
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewClose: {
    position: 'absolute', right: space[4], width: 40, height: 40, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  previewImage: { width: '100%', height: '80%' },

  /* Error / retry */
  errorBox: { alignItems: 'center', justifyContent: 'center', gap: space[3], paddingVertical: space[10], paddingHorizontal: space[4] },
  errorIcon: { width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  errorTitle: { fontSize: 18, fontFamily: FONT.black, textAlign: 'center' },
  errorSub: { ...type.caption, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space[1], paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.pill, borderWidth: 1 },
  retryText: { ...type.bodyStrong, fontSize: 15 },
});
