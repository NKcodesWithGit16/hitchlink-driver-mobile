import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import CountUp from '../../src/components/ui/CountUp';
import FadeInView from '../../src/components/ui/FadeInView';
import { hosState } from '../../src/components/driver/HOSPill';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { fetchHos, fetchActiveLoad } from '../../src/api/main';
import { hos as mockHos } from '../../src/data/mock';
import { hm, money } from '../../src/lib/format';
import { space, type, radius, toneOf, FONT, shadow, ACCENT_PRESETS, BG_PRESETS_NIGHT } from '../../src/theme/tokens';

const THEME_OPTIONS = [
  { key: 'auto',  label: 'Auto',  icon: 'zap'  },
  { key: 'day',   label: 'Day',   icon: 'sun'  },
  { key: 'night', label: 'Night', icon: 'moon' },
];

// Icon hues carry a `tone` resolved against the live theme at render — the
// brand tone follows the driver's chosen accent; the rest are fixed category
// colors from the design system (never raw inline hex).
const QUICK_ACTIONS = [
  { icon: 'zap',            label: 'ELD',      sub: 'Connect device', tone: 'teal',   onPress: () => Alert.alert('ELD', 'ELD integration coming soon.') },
  { icon: 'message-circle', label: 'Support',  sub: 'Chat with us',   tone: 'blue',   onPress: () => Alert.alert('Support', "We're a tap away. Call 1-800-HITCH.") },
  { icon: 'star',           label: 'Feedback', sub: 'Rate the app',   tone: 'purple', onPress: () => Alert.alert('Feedback', 'Thank you! Rating coming soon.') },
];

const SETTING_ROWS = [
  { icon: 'truck',       label: 'Truck info',     tone: 'teal',   metaKey: 'truck' },
  { icon: 'bell',        label: 'Notifications',  tone: 'orange', meta: 'On'       },
  { icon: 'globe',       label: 'Language',       tone: 'green',  meta: 'English'  },
  { icon: 'help-circle', label: 'Help & Support', tone: 'purple'                   },
];

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, isDay, accentKey, setAccent, bgKey, setBg, scheme } = useTheme();
  const { user, userId, signOut } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Resolve icon tones: `teal` tracks the chosen accent; others are design-system hues.
  const hue = useMemo(() => ({
    teal: colors.teal,
    blue: ACCENT_PRESETS.blue.color,
    purple: ACCENT_PRESETS.purple.color,
    orange: ACCENT_PRESETS.orange.color,
    green: ACCENT_PRESETS.green.color,
  }), [colors]);
  const [hos,        setHos]        = useState(mockHos);
  const [activeLoad, setActiveLoad] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetchHos(userId).then(d => { if (d) setHos(d); }).catch(() => {});
    fetchActiveLoad(userId).then(setActiveLoad).catch(() => {});
  }, [userId]);

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'Sign out of HitchLink?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, gap: space[4] }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Profile hero ── */}
        <FadeInView delay={0}>
          <LinearGradient
            colors={colors.gradients.brand}
            start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.profileHero}
          >
            {/* Avatar */}
            <View style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <Text style={styles.avatarText}>
                  {(user?.firstName || 'D').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroName} numberOfLines={1}>{user?.name ?? 'Driver'}</Text>
              <Text style={styles.heroTruck} numberOfLines={1}>{user?.truck}</Text>
              <View style={styles.heroStatusRow}>
                <View style={styles.onDutyDot} />
                <Text style={styles.heroStatus}>On Duty</Text>
                {activeLoad ? (
                  <Text style={styles.heroLoadId}>· {activeLoad.id}</Text>
                ) : null}
              </View>
            </View>

            {/* Quick pay badge */}
            {activeLoad ? (
              <View style={styles.heroPay}>
                <Text style={styles.heroPayLabel}>This load</Text>
                <Text style={styles.heroPayValue}>{money(activeLoad.rate)}</Text>
              </View>
            ) : null}
          </LinearGradient>
        </FadeInView>

        {/* ── HOS ── */}
        <FadeInView delay={60} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Hours of Service</Text>
          <HosCard hos={hos} colors={colors} styles={styles} />
        </FadeInView>

        {/* ── Quick actions ── */}
        <FadeInView delay={120} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Quick actions</Text>
          <View style={styles.quickRow}>
            {QUICK_ACTIONS.map(({ icon, label, sub, tone, onPress }) => {
              const color = hue[tone];
              return (
              <Pressable
                key={label}
                onPress={onPress}
                style={({ pressed }) => [
                  styles.quickCard,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${label}. ${sub}`}
              >
                <View style={[styles.quickIcon, { backgroundColor: color + '22' }]}>
                  <Icon name={icon} size={20} color={color} />
                </View>
                <Text style={[styles.quickLabel, { color: colors.textPrimary }]}>{label}</Text>
                <Text style={[styles.quickSub, { color: colors.textMuted }]}>{sub}</Text>
              </Pressable>
              );
            })}
          </View>
        </FadeInView>

        {/* ── Appearance ── */}
        <FadeInView delay={180} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Appearance</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            {/* Theme */}
            <View style={styles.settingBlock}>
              <Text style={[styles.blockLabel, { color: colors.textMuted }]}>Theme</Text>
              <View style={styles.themeRow}>
                {THEME_OPTIONS.map(({ key, label, icon }) => {
                  const active = mode === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setMode(key)}
                      style={[
                        styles.themeBtn,
                        { borderColor: active ? colors.teal : colors.border,
                          backgroundColor: active ? colors.tealFill : colors.surface2 },
                      ]}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${label} theme`}
                    >
                      <Icon name={icon} size={15} color={active ? colors.teal : colors.textMuted} />
                      <Text style={[styles.themeBtnText, { color: active ? colors.teal : colors.textMuted }]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.blockDivider, { backgroundColor: colors.border }]} />

            {/* Accent color */}
            <View style={styles.settingBlock}>
              <Text style={[styles.blockLabel, { color: colors.textMuted }]}>Accent color</Text>
              <View style={styles.accentRow}>
                {Object.entries(ACCENT_PRESETS).map(([key, preset]) => {
                  const active = accentKey === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setAccent(key)}
                      style={styles.accentItem}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${preset.label} accent color`}
                    >
                      <View style={[
                        styles.accentDot,
                        { backgroundColor: preset.color },
                        active && [styles.accentDotActive, { borderColor: preset.color }, shadow.glow(preset.color)],
                      ]}>
                        {active ? <Icon name="check" size={11} color="#fff" /> : null}
                      </View>
                      <Text style={[styles.accentLabel, { color: active ? colors.textPrimary : colors.textMuted }]}>
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Background (night only) */}
            {scheme === 'night' ? (
              <>
                <View style={[styles.blockDivider, { backgroundColor: colors.border }]} />
                <View style={styles.settingBlock}>
                  <Text style={[styles.blockLabel, { color: colors.textMuted }]}>Background</Text>
                  <View style={styles.bgRow}>
                    {Object.entries(BG_PRESETS_NIGHT).map(([key, preset]) => {
                      const active = bgKey === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => setBg(key)}
                          style={[
                            styles.bgSwatch,
                            { backgroundColor: preset.bg,
                              borderColor: active ? colors.teal : colors.borderStrong },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${preset.label} background`}
                        >
                          {active ? (
                            <View style={[styles.bgCheck, { backgroundColor: colors.teal }]}>
                              <Icon name="check" size={9} color={colors.onAccent} />
                            </View>
                          ) : null}
                          <Text style={[styles.bgLabel, { color: active ? colors.teal : colors.textMuted }]}>
                            {preset.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}
          </View>
        </FadeInView>

        {/* ── Settings ── */}
        <FadeInView delay={220} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Settings</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0, overflow: 'hidden' }]}>
            {SETTING_ROWS.map((row, i) => (
              <View key={row.label}>
                <SettingRow
                  icon={row.icon}
                  label={row.label}
                  iconColor={hue[row.tone]}
                  iconBg={hue[row.tone] + '22'}
                  meta={row.metaKey ? user?.[row.metaKey] : row.meta}
                  colors={colors}
                  styles={styles}
                  onPress={() => Alert.alert(row.label, row.meta ?? user?.[row.metaKey] ?? '')}
                />
                {i < SETTING_ROWS.length - 1 ? (
                  <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                ) : null}
              </View>
            ))}
          </View>
        </FadeInView>

        {/* ── Sign out ── */}
        <FadeInView delay={260} style={[styles.section, { paddingBottom: space[2] }]}>
          <Pressable
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.signOutBtn,
              { borderColor: colors.danger + '66',
                backgroundColor: pressed ? colors.dangerFill : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out of HitchLink"
          >
            <Icon name="log-out" size={18} color={colors.danger} />
            <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
          <Text style={[styles.version, { color: colors.textMuted }]}>HitchLink Driver · v1.0.0</Text>
        </FadeInView>

      </ScrollView>
    </ScreenFade>
  );
}

/* ─────────── HOS Card ─────────── */

function HosCard({ hos, colors, styles }) {
  const t     = toneOf(colors, hosState(hos.driveMinutesLeft));
  const pct   = Math.max(0, Math.min(1, hos.driveMinutesLeft / (11 * 60)));
  const state = hosState(hos.driveMinutesLeft);

  const stateLabel =
    state === 'go'      ? 'Plenty of road left' :
    state === 'caution' ? 'Plan a stop soon'     : 'Time to stop';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>

      {/* Top row */}
      <View style={styles.hosTop}>
        <View style={{ gap: 2 }}>
          <Text style={[styles.hosSmallLabel, { color: colors.textMuted }]}>DRIVE TIME LEFT</Text>
          <CountUp
            value={hos.driveMinutesLeft}
            duration={1200}
            format={hm}
            style={[styles.hosValue, { color: t.solid }]}
          />
        </View>
        <View style={[styles.hosBadge, { backgroundColor: t.fill, borderColor: t.solid + '55' }]}>
          <View style={[styles.hosDot, { backgroundColor: t.solid }]} />
          <Text style={[styles.hosBadgeText, { color: t.solid }]}>{stateLabel}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={[styles.hosTrack, { backgroundColor: colors.surfaceHi }]}>
        <LinearGradient
          colors={t.grad}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[styles.hosFill, { width: `${pct * 100}%` }]}
        />
      </View>
      <View style={styles.hosTickRow}>
        <Text style={[styles.hosTick, { color: colors.textMuted }]}>0h</Text>
        <Text style={[styles.hosTick, { color: colors.textMuted }]}>11h max</Text>
      </View>

      {/* Stats 2×2 */}
      <View style={styles.hosGrid}>
        <HosStat icon="navigation" label="Driven today"  value={hm(hos.drivenTodayMinutes)}  colors={colors} styles={styles} />
        <HosStat icon="coffee"     label="Break in"       value={hm(hos.breakInMinutes)}       colors={colors} styles={styles} />
        <HosStat icon="clock"      label="On-duty left"  value={hm(hos.onDutyMinutesLeft)}    colors={colors} styles={styles} />
        <HosStat icon="repeat"     label="Cycle left"    value={`${hos.cycleHoursLeft}h`}     colors={colors} styles={styles} />
      </View>

      <View style={[styles.hosNote, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Icon name="zap" size={12} color={colors.textMuted} />
        <Text style={[styles.hosNoteText, { color: colors.textMuted }]}>
          Connect an ELD for certified hours logs.
        </Text>
      </View>
    </View>
  );
}

function HosStat({ icon, label, value, colors, styles }) {
  return (
    <View style={styles.hosStat}>
      <View style={styles.hosStatTop}>
        <Icon name={icon} size={12} color={colors.textMuted} />
        <Text style={[styles.hosStatLabel, { color: colors.textMuted }]}>{label}</Text>
      </View>
      <Text style={[styles.hosStatValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

/* ─────────── Setting Row ─────────── */

function SettingRow({ icon, label, meta, iconBg, iconColor, colors, styles, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, { backgroundColor: pressed ? colors.surfaceHi : 'transparent' }]}
      accessibilityRole="button"
      accessibilityLabel={meta ? `${label}, ${meta}` : label}
    >
      <View style={[styles.settingIconBox, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={17} color={iconColor} />
      </View>
      <Text style={[styles.settingLabel, { color: colors.textPrimary }]}>{label}</Text>
      {meta ? <Text style={[styles.settingMeta, { color: colors.textMuted }]} numberOfLines={1}>{meta}</Text> : null}
      <Icon name="chevron-right" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

/* ─────────── Styles ─────────── */

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  section: { paddingHorizontal: space[4], gap: space[3] },
  sectionLabel: { fontSize: 11, fontFamily: FONT.black, letterSpacing: 1, textTransform: 'uppercase' },

  /* Profile hero */
  profileHero: {
    flexDirection: 'row', alignItems: 'center', gap: space[4],
    paddingHorizontal: space[5], paddingVertical: space[5],
    marginBottom: space[1],
  },
  avatarRing: {
    width: 68, height: 68, borderRadius: 999,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.5)',
    padding: 3, flexShrink: 0,
  },
  avatarInner: {
    flex: 1, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 26, fontFamily: FONT.black, color: '#FFFFFF' },
  heroName:   { fontSize: 20, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.4 },
  heroTruck:  { fontSize: 13, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  onDutyDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#1BD68C' },
  heroStatus: { fontSize: 12, fontFamily: FONT.bold, color: '#1BD68C' },
  heroLoadId: { fontSize: 12, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.5)' },
  heroPay: {
    alignItems: 'flex-end', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2],
    flexShrink: 0,
  },
  heroPayLabel: { fontSize: 10, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.55)' },
  heroPayValue: { fontSize: 20, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.5 },

  /* Generic card */
  card: { borderRadius: radius.xl, borderWidth: 1, padding: space[4], gap: space[4] },

  /* HOS */
  hosTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  hosSmallLabel: { fontSize: 10, fontFamily: FONT.black, letterSpacing: 1 },
  hosValue: { fontSize: 42, fontFamily: FONT.black, letterSpacing: -1.5, lineHeight: 46 },
  hosBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[3], paddingVertical: 7,
    borderRadius: radius.pill, borderWidth: 1, flexShrink: 1,
  },
  hosDot: { width: 7, height: 7, borderRadius: 999, flexShrink: 0 },
  hosBadgeText: { fontSize: 12, fontFamily: FONT.bold, flexShrink: 1 },
  hosTrack: { height: 10, borderRadius: 999, overflow: 'hidden' },
  hosFill: { height: '100%', borderRadius: 999 },
  hosTickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space[2] },
  hosTick: { fontSize: 10, fontFamily: FONT.bold },
  hosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  hosStat: { width: '50%', paddingVertical: space[3], paddingRight: space[3], gap: 3 },
  hosStatTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hosStatLabel: { fontSize: 11, fontFamily: FONT.bold },
  hosStatValue: { fontSize: 20, fontFamily: FONT.black, letterSpacing: -0.3 },
  hosNote: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: radius.md, borderWidth: 1, padding: space[3],
  },
  hosNoteText: { ...type.caption, flex: 1 },

  /* Quick actions */
  quickRow: { flexDirection: 'row', gap: space[3] },
  quickCard: {
    flex: 1, borderRadius: radius.xl, borderWidth: 1,
    padding: space[4], gap: 6, alignItems: 'flex-start',
  },
  quickIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  quickLabel: { fontSize: 13, fontFamily: FONT.black },
  quickSub: { fontSize: 11, fontFamily: FONT.medium },

  /* Appearance */
  settingBlock: { gap: space[3] },
  blockLabel: { fontSize: 11, fontFamily: FONT.black, letterSpacing: 0.5 },
  blockDivider: { height: 1 },
  themeRow: { flexDirection: 'row', gap: space[2] },
  themeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 44, borderRadius: radius.md, borderWidth: 1.5,
  },
  themeBtnText: { fontSize: 13, fontFamily: FONT.bold },
  accentRow: { flexDirection: 'row', justifyContent: 'space-between' },
  accentItem: { alignItems: 'center', gap: 6, flex: 1 },
  accentDot: { width: 32, height: 32, borderRadius: 999, borderWidth: 3, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  accentDotActive: { borderWidth: 3 },
  accentLabel: { fontSize: 10, fontFamily: FONT.bold },
  bgRow: { flexDirection: 'row', gap: space[3] },
  bgSwatch: { flex: 1, height: 56, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'flex-end', padding: 6 },
  bgCheck: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  bgLabel: { fontSize: 11, fontFamily: FONT.bold },

  /* Settings rows */
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingHorizontal: space[4], paddingVertical: 14,
  },
  settingIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  settingLabel: { ...type.body, fontFamily: FONT.semibold, flex: 1 },
  settingMeta: { ...type.caption, maxWidth: 130 },
  rowDivider: { height: 1, marginLeft: space[4] + 36 + space[3] },

  /* Sign out */
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, borderWidth: 1.5, paddingVertical: 16,
  },
  signOutText: { fontSize: 15, fontFamily: FONT.bold },
  version: { ...type.caption, textAlign: 'center', marginTop: space[1] },
});
