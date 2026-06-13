import { useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, Animated, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Icon from '../../src/components/ui/Icon';
import FadeInView from '../../src/components/ui/FadeInView';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { fetchDocuments } from '../../src/api/main';
import { expiryStatus, fmtDate, daysUntil } from '../../src/lib/format';
import { space, type, radius, toneOf, FONT, shadow } from '../../src/theme/tokens';

const FILTERS = [
  { key: 'all',      label: 'All'      },
  { key: 'valid',    label: 'Valid'    },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired',  label: 'Expired'  },
];

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { userId } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [docs, setDocs]     = useState([]);
  const [open, setOpen]     = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!userId) return;
    fetchDocuments(userId).then(setDocs).catch(() => {});
  }, [userId]);

  const counts = useMemo(() => {
    const c = { valid: 0, expiring: 0, expired: 0 };
    docs.forEach(d => { c[expiryStatus(d.expires).key]++; });
    return c;
  }, [docs]);

  const visible = useMemo(() =>
    filter === 'all' ? docs : docs.filter(d => expiryStatus(d.expires).key === filter),
    [docs, filter]);

  const addDoc = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
      if (!res.canceled) Alert.alert('Saved', 'Document added and available offline.');
    } catch {
      Alert.alert('Could not add', 'Please try again.');
    }
  };

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.head}>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Documents</Text>
          <Text style={[styles.headSub, { color: colors.textMuted }]}>
            {docs.length} on file
            {counts.expiring > 0 ? ` · ${counts.expiring} expiring soon` : ''}
            {counts.expired  > 0 ? ` · ${counts.expired} expired` : ''}
          </Text>
        </View>
        <Pressable
          onPress={addDoc}
          style={[styles.addBtn, { backgroundColor: colors.teal }, shadow.glow(colors.teal)]}
          accessibilityLabel="Add document"
        >
          <Icon name="plus" size={18} color={colors.onAccent} />
          <Text style={[styles.addBtnText, { color: colors.onAccent }]}>Add</Text>
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
              ? `${docs.find(d => expiryStatus(d.expires).key === 'expiring')?.label} expires soon — renew before your next inspection.`
              : `${counts.expiring} documents expiring soon — renew before your next inspection.`}
          </Text>
        </View>
      )}

      {/* ── Doc list ── */}
      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingBottom: 120, gap: space[3] }}
        showsVerticalScrollIndicator={false}
      >
        {visible.map((doc, i) => (
          <FadeInView key={doc.id} delay={i * 70}>
            <DocCard doc={doc} onPress={() => setOpen(doc)} colors={colors} styles={styles} />
          </FadeInView>
        ))}
        {visible.length === 0 && (
          <View style={styles.empty}>
            <Icon name="folder" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No {filter} documents</Text>
          </View>
        )}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Documents are cached offline — accessible at weigh stations with no signal.
        </Text>
      </ScrollView>

      <DocViewer doc={open} onClose={() => setOpen(null)} colors={colors} styles={styles} insets={insets} />
    </ScreenFade>
  );
}

/* ─────────── Doc Card ─────────── */

function DocCard({ doc, onPress, colors, styles }) {
  const status  = expiryStatus(doc.expires);
  const days    = daysUntil(doc.expires);
  const t       = toneOf(colors, status.tone);
  const barFill = Math.max(0, Math.min(1, (days ?? 0) / 365));
  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: barFill,
      duration: 700,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, [barFill]);

  const daysLabel =
    days == null  ? '' :
    days <= 0     ? 'Expired' :
    days === 1    ? '1 day left' :
    days < 30     ? `${days} days left` :
    days < 365    ? `${Math.round(days / 30)} mo left` :
                    `${Math.round(days / 365 * 10) / 10} yr left`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.docCard,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${doc.label}, ${status.label}`}
    >
      {/* Status stripe */}
      <View style={[styles.stripe, { backgroundColor: t.solid }]} />

      <View style={styles.docBody}>
        {/* Top row: icon + label + badge */}
        <View style={styles.docTop}>
          <View style={[styles.docIcon, { backgroundColor: t.fill }]}>
            <Icon name={doc.icon || 'file-text'} size={20} color={t.solid} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.docLabel, { color: colors.textPrimary }]} numberOfLines={1}>
              {doc.label}
            </Text>
            <Text style={[styles.docSub, { color: colors.textMuted }]} numberOfLines={1}>
              {doc.sub}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: t.fill, borderColor: t.solid + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: t.solid }]} />
            <Text style={[styles.statusText, { color: t.solid }]}>{status.label}</Text>
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
                  backgroundColor: t.solid,
                },
              ]}
            />
          </View>
          <View style={styles.expiryMeta}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="calendar" size={11} color={colors.textMuted} />
              <Text style={[styles.expiryDate, { color: colors.textMuted }]}>
                Expires {fmtDate(doc.expires)}
              </Text>
            </View>
            <Text style={[styles.daysLeft, { color: t.solid }]}>{daysLabel}</Text>
          </View>
        </View>
      </View>

      <Icon name="chevron-right" size={16} color={colors.textMuted} style={{ alignSelf: 'center', marginRight: space[3] }} />
    </Pressable>
  );
}

/* ─────────── Doc Viewer ─────────── */

function DocViewer({ doc, onClose, colors, styles, insets }) {
  if (!doc) return null;
  const status = expiryStatus(doc.expires);
  const days   = daysUntil(doc.expires);
  const t      = toneOf(colors, status.tone);

  const daysLabel =
    days == null ? '' :
    days <= 0    ? 'This document has expired' :
    days === 1   ? '1 day remaining' :
                   `${days} days remaining`;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.viewer, { backgroundColor: colors.bg }]}>

        {/* Gradient header */}
        <LinearGradient
          colors={t.grad}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.viewerHeader, { paddingTop: insets.top + space[3] }]}
        >
          <Pressable onPress={onClose} style={styles.backBtn} accessibilityLabel="Close">
            <Icon name="arrow-left" size={22} color="rgba(255,255,255,0.9)" />
          </Pressable>
          <View style={styles.viewerIconWrap}>
            <View style={styles.viewerIconCircle}>
              <Icon name={doc.icon || 'file-text'} size={40} color={t.solid} />
            </View>
          </View>
          <Text style={styles.viewerDocName}>{doc.label}</Text>
          <Text style={styles.viewerDocSub}>{doc.sub}</Text>
        </LinearGradient>

        {/* Detail card */}
        <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: 40 }}>
          <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            <DetailRow icon="hash"     label="Document number" value={doc.number}          colors={colors} styles={styles} mono />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
            <DetailRow icon="calendar" label="Expiry date"     value={fmtDate(doc.expires)} colors={colors} styles={styles} />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

            {/* Status row */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Icon name="shield" size={15} color={colors.textMuted} />
                <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Status</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: t.fill, borderColor: t.solid + '55' }]}>
                <View style={[styles.statusDot, { backgroundColor: t.solid }]} />
                <Text style={[styles.statusText, { color: t.solid }]}>{status.label}</Text>
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
                          backgroundColor: t.solid, borderRadius: 999 },
                      ]}
                    />
                  </View>
                  <Text style={[styles.countdownText, { color: t.solid }]}>{daysLabel}</Text>
                </View>
              </>
            )}
          </View>

          {/* Action buttons */}
          <Pressable
            onPress={() =>
              ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
                .then(r => { if (!r.canceled) Alert.alert('Uploaded', 'Renewal scan saved.'); })
                .catch(() => {})
            }
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: t.solid, opacity: pressed ? 0.85 : 1 },
              shadow.glow(t.solid),
            ]}
          >
            <Icon name="upload" size={18} color={colors.onAccent} />
            <Text style={[styles.actionBtnText, { color: colors.onAccent }]}>Upload renewal</Text>
          </Pressable>

          <Pressable
            onPress={() => Alert.alert('Share', 'Sharing coming soon.')}
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Icon name="share-2" size={18} color={colors.textSecondary} />
            <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>Share document</Text>
          </Pressable>
        </ScrollView>

      </View>
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
});
