import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Switch, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import CountUp from '../../src/components/ui/CountUp';
import FadeInView from '../../src/components/ui/FadeInView';
import { hosState } from '../../src/components/driver/HOSPill';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT, useLanguage } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { useConfirmEveryStep, setConfirmEveryStep } from '../../src/lib/prefs';
import { fetchHos, fetchActiveLoad } from '../../src/api/main';
import { hos as mockHos, earnings } from '../../src/data/mock';
import { hm } from '../../src/lib/format';
import { space, type, radius, elevation, toneOf, FONT, shadow, ACCENT_PRESETS, BG_PRESETS_NIGHT } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';

// Demo "standing" metrics — the reputation numbers a real app would pull from
// the dispatch backend. Kept here (not in the shared fixtures) because they're
// presentation-only for this screen.
const STANDING = { score: 96, tierKey: 'more.eliteTier', percentile: 5, rating: 4.9, onTimePct: 98, streak: 12, acceptPct: 94 };

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, mode, setMode, accentKey, setAccent, bgKey, setBg, scheme } = useTheme();
  const t = useT();
  const { lang, setLang } = useLanguage();
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

  const THEME_OPTIONS = [
    { key: 'auto',  label: t('more.themeAuto'),  icon: 'zap'  },
    { key: 'day',   label: t('more.themeDay'),   icon: 'sun'  },
    { key: 'night', label: t('more.themeNight'), icon: 'moon' },
  ];

  const QUICK_ACTIONS = [
    { icon: 'zap',            label: t('more.eld'),      sub: t('more.eldSub'),      tone: 'teal',
      onPress: () => Alert.alert(t('more.eldAlertTitle'), t('more.eldAlertBody')) },
    { icon: 'message-circle', label: t('more.support'),  sub: t('more.supportSub'),  tone: 'blue',
      onPress: () => Alert.alert(t('more.support'), t('more.supportAlertBody')) },
    { icon: 'star',           label: t('more.feedback'), sub: t('more.feedbackSub'), tone: 'purple',
      onPress: () => Alert.alert(t('more.feedback'), t('more.feedbackAlertBody')) },
  ];

  const languageLabel = lang === 'ka' ? t('more.languageGeorgian') : t('more.languageEnglish');

  // ACCENT_PRESETS/BG_PRESETS_NIGHT live in theme/tokens.js (design tokens,
  // not text) with English preset.label values — translate at the render
  // site instead of threading i18n into the shared token file.
  const COLOR_LABELS = {
    teal: t('more.colorTeal'), blue: t('more.colorBlue'), purple: t('more.colorPurple'),
    green: t('more.colorGreen'), orange: t('more.colorOrange'), rose: t('more.colorRose'),
  };
  const BG_LABELS = {
    navy: t('more.bgNavy'), black: t('more.bgOled'), charcoal: t('more.bgCharcoal'), slate: t('more.bgSlate'),
  };

  // Settings grouped into labeled sections the way top-tier apps organize them.
  // `route` navigates; `key: 'language'` opens the language picker; otherwise a
  // row falls back to an informational alert.
  const SETTING_GROUPS = [
    {
      title: t('more.groupAccount'),
      rows: [
        { icon: 'user',        label: t('more.profile'),       tone: 'teal',   route: '/edit-profile' },
        { icon: 'truck',       label: t('more.truckInfo'),     tone: 'blue',   metaKey: 'truck' },
        { icon: 'file-text',   label: t('more.documents'),     tone: 'green',  meta: t('more.manage'), route: '/(tabs)/documents' },
        { icon: 'credit-card', label: t('more.payoutMethod'),  tone: 'purple', meta: t('more.directDeposit') },
      ],
    },
    {
      title: t('more.groupPreferences'),
      rows: [
        { icon: 'bell',        label: t('more.notifications'), tone: 'orange', meta: t('more.on') },
        { icon: 'globe',       label: t('more.language'),      tone: 'green',  meta: languageLabel, key: 'language' },
        { icon: 'map',         label: t('more.distanceUnits'), tone: 'teal',   meta: t('more.miles') },
        { icon: 'navigation',  label: t('more.navigationApp'), tone: 'blue',   meta: t('more.appleMaps') },
      ],
    },
    {
      title: t('more.groupSupport'),
      rows: [
        { icon: 'help-circle', label: t('more.helpCenter'),     tone: 'teal'   },
        { icon: 'phone',       label: t('more.contactSupport'), tone: 'green',  meta: '1-800-HITCH' },
        { icon: 'star',        label: t('more.rateApp'),        tone: 'orange' },
        { icon: 'shield',      label: t('more.termsPrivacy'),   tone: 'purple' },
      ],
    },
  ];
  const [hos,        setHos]        = useState(mockHos);
  const [activeLoad, setActiveLoad] = useState(null);
  const confirmEveryStep = useConfirmEveryStep();

  useEffect(() => {
    if (!userId) return;
    fetchHos(userId).then(d => { if (d) setHos(d); }).catch(() => {});
    fetchActiveLoad(userId).then(setActiveLoad).catch(() => {});
  }, [userId]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? t('more.greetingMorning') : h < 18 ? t('more.greetingAfternoon') : t('more.greetingEvening');
  }, [t]);

  const onRow = (row) => {
    if (row.key === 'language') {
      Alert.alert(t('more.language'), undefined, [
        { text: t('more.languageEnglish'), onPress: () => setLang('en') },
        { text: t('more.languageGeorgian'), onPress: () => setLang('ka') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    if (row.route) { router.push(row.route); return; }
    Alert.alert(row.label, row.meta ?? user?.[row.metaKey] ?? t('common.comingSoon'));
  };

  const confirmSignOut = () =>
    Alert.alert(t('more.signOutConfirmTitle'), t('more.signOutConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('more.signOut'), style: 'destructive', onPress: signOut },
    ]);

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE, gap: space[5] }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Profile hero ── */}
        <FadeInView delay={0}>
          <LinearGradient
            colors={colors.gradients.brand}
            start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.profileHero}
          >
            {/* Greeting + edit */}
            <View style={styles.heroTopRow}>
              <Text style={styles.heroGreeting}>{greeting}</Text>
              <Pressable
                onPress={() => router.push('/edit-profile')}
                hitSlop={10}
                style={styles.heroEditBtn}
                accessibilityRole="button"
                accessibilityLabel={t('more.editProfileA11y')}
              >
                <Icon name="edit-2" size={15} color="rgba(255,255,255,0.9)" />
              </Pressable>
            </View>

            {/* Identity */}
            <View style={styles.heroIdentity}>
              <View style={styles.avatarRing}>
                {user?.photoUrl ? (
                  <Image source={{ uri: user.photoUrl }} style={styles.avatarPhoto} />
                ) : (
                  <View style={styles.avatarInner}>
                    <Text style={styles.avatarText}>
                      {(user?.firstName || t('more.driver')).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.heroName} numberOfLines={1}>{user?.name ?? t('more.driver')}</Text>
                <Text style={styles.heroTruck} numberOfLines={1}>{user?.truck}</Text>
                <View style={styles.heroStatusRow}>
                  <View style={styles.onDutyDot} />
                  <Text style={styles.heroStatus}>{t('more.onDuty')}</Text>
                  {activeLoad ? <Text style={styles.heroLoadId}>· {activeLoad.id}</Text> : null}
                </View>
              </View>
            </View>

            {/* Glass stats strip */}
            <View style={styles.heroStats}>
              <HeroStat icon="star"       value={STANDING.rating.toFixed(1)} label={t('more.rating')}    styles={styles} />
              <View style={styles.heroStatDivider} />
              <HeroStat icon="check-circle" value={`${STANDING.onTimePct}%`}   label={t('more.onTime')}   styles={styles} />
              <View style={styles.heroStatDivider} />
              <HeroStat icon="navigation" value={`${(earnings.week.miles / 1000).toFixed(1)}k`} label={t('more.miPerWeek')} styles={styles} />
            </View>
          </LinearGradient>
        </FadeInView>

        {/* ── Driver standing ── */}
        <FadeInView delay={60} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.yourStanding')}</Text>
          <StandingCard colors={colors} styles={styles} t={t} />
        </FadeInView>

        {/* ── HOS ── */}
        <FadeInView delay={120} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.hoursOfService')}</Text>
          <HosCard hos={hos} colors={colors} styles={styles} t={t} />
        </FadeInView>

        {/* ── Quick actions ── */}
        <FadeInView delay={180} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.quickActions')}</Text>
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
                  elevation[1],
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

        {/* ── Settings groups ── */}
        {SETTING_GROUPS.map((group, gi) => (
          <FadeInView key={group.title} delay={220 + gi * 40} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{group.title}</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0, overflow: 'hidden' }, elevation[1]]}>
              {group.rows.map((row, i) => (
                <View key={row.label}>
                  <SettingRow
                    icon={row.icon}
                    label={row.label}
                    iconColor={hue[row.tone]}
                    iconBg={hue[row.tone] + '22'}
                    meta={row.metaKey ? user?.[row.metaKey] : row.meta}
                    colors={colors}
                    styles={styles}
                    onPress={() => onRow(row)}
                  />
                  {i < group.rows.length - 1 ? (
                    <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                  ) : null}
                </View>
              ))}
            </View>
          </FadeInView>
        ))}

        {/* ── Load updates (safety) ── */}
        <FadeInView delay={340} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.loadUpdates')}</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 0, overflow: 'hidden' }, elevation[1]]}>
            <View style={styles.toggleRow}>
              <View style={[styles.settingIconBox, { backgroundColor: hue.teal + '22' }]}>
                <Icon name="check-circle" size={17} color={hue.teal} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.toggleTitle, { color: colors.textPrimary }]}>{t('more.confirmEveryStatus')}</Text>
                <Text style={[styles.toggleSub, { color: colors.textMuted }]}>
                  {t('more.confirmEveryStatusSub')}
                </Text>
              </View>
              <Switch
                value={confirmEveryStep}
                onValueChange={setConfirmEveryStep}
                trackColor={{ false: colors.surfaceHi, true: colors.teal }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.surfaceHi}
              />
            </View>
          </View>
        </FadeInView>

        {/* ── Appearance ── */}
        <FadeInView delay={360} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.appearance')}</Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[1]]}>

            {/* Theme */}
            <View style={styles.settingBlock}>
              <Text style={[styles.blockLabel, { color: colors.textMuted }]}>{t('more.theme')}</Text>
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
                      accessibilityLabel={t('more.themeA11y', { label })}
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
              <Text style={[styles.blockLabel, { color: colors.textMuted }]}>{t('more.accentColor')}</Text>
              <View style={styles.accentRow}>
                {Object.entries(ACCENT_PRESETS).map(([key, preset]) => {
                  const active = accentKey === key;
                  const label = COLOR_LABELS[key] || preset.label;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setAccent(key)}
                      style={styles.accentItem}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t('more.accentA11y', { label })}
                    >
                      <View style={[
                        styles.accentDot,
                        { backgroundColor: preset.color },
                        active && [styles.accentDotActive, { borderColor: preset.color }, shadow.glow(preset.color)],
                      ]}>
                        {active ? <Icon name="check" size={11} color="#fff" /> : null}
                      </View>
                      <Text style={[styles.accentLabel, { color: active ? colors.textPrimary : colors.textMuted }]}>
                        {label}
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
                  <Text style={[styles.blockLabel, { color: colors.textMuted }]}>{t('more.background')}</Text>
                  <View style={styles.bgRow}>
                    {Object.entries(BG_PRESETS_NIGHT).map(([key, preset]) => {
                      const active = bgKey === key;
                      const label = BG_LABELS[key] || preset.label;
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
                          accessibilityLabel={t('more.backgroundA11y', { label })}
                        >
                          {active ? (
                            <View style={[styles.bgCheck, { backgroundColor: colors.teal }]}>
                              <Icon name="check" size={9} color={colors.onAccent} />
                            </View>
                          ) : null}
                          <Text style={[styles.bgLabel, { color: active ? colors.teal : colors.textMuted }]}>
                            {label}
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

        {/* ── Sign out ── */}
        <FadeInView delay={420} style={[styles.section, { paddingBottom: space[2] }]}>
          <Pressable
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.signOutBtn,
              { borderColor: colors.danger + '66',
                backgroundColor: pressed ? colors.dangerFill : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('more.signOutA11y')}
          >
            <Icon name="log-out" size={18} color={colors.danger} />
            <Text style={[styles.signOutText, { color: colors.danger }]}>{t('more.signOut')}</Text>
          </Pressable>
          <Text style={[styles.version, { color: colors.textMuted }]}>{t('more.version')}</Text>
        </FadeInView>

      </ScrollView>
    </ScreenFade>
  );
}

/* ─────────── Hero stat ─────────── */

function HeroStat({ icon, value, label, styles }) {
  return (
    <View style={styles.heroStat}>
      <View style={styles.heroStatTop}>
        <Icon name={icon} size={12} color="rgba(255,255,255,0.85)" />
        <Text style={styles.heroStatValue}>{value}</Text>
      </View>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

/* ─────────── Standing Card ─────────── */

function StandingCard({ colors, styles, t }) {
  const pct = Math.max(0, Math.min(1, STANDING.score / 100));
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[2]]}>
      <View style={styles.standingTop}>
        {/* Score medallion */}
        <LinearGradient
          colors={colors.gradients.go}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.scoreBadge, shadow.glow(colors.go)]}
        >
          <CountUp value={STANDING.score} duration={1200} style={styles.scoreValue} />
          <Text style={styles.scoreMax}>/100</Text>
        </LinearGradient>

        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.tierRow}>
            <Text style={[styles.tierName, { color: colors.textPrimary }]}>{t('more.tierDriver', { tier: t(STANDING.tierKey) })}</Text>
            <View style={[styles.tierBadge, { backgroundColor: colors.goFill, borderColor: colors.go + '55' }]}>
              <Icon name="award" size={11} color={colors.go} />
              <Text style={[styles.tierBadgeText, { color: colors.go }]}>{t('more.topPercentile', { pct: STANDING.percentile })}</Text>
            </View>
          </View>
          <Text style={[styles.tierSub, { color: colors.textMuted }]}>
            {t('more.standingSub')}
          </Text>
          <View style={[styles.scoreTrack, { backgroundColor: colors.surfaceHi }]}>
            <LinearGradient
              colors={colors.gradients.go}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.scoreFill, { width: `${pct * 100}%` }]}
            />
          </View>
        </View>
      </View>

      <View style={styles.standingGrid}>
        <StandingStat icon="check-circle" value={`${STANDING.onTimePct}%`} label={t('more.onTime')}    colors={colors} styles={styles} />
        <View style={[styles.standingVDivider, { backgroundColor: colors.border }]} />
        <StandingStat icon="zap"          value={`${STANDING.streak}`}     label={t('more.loadStreak')} colors={colors} styles={styles} />
        <View style={[styles.standingVDivider, { backgroundColor: colors.border }]} />
        <StandingStat icon="thumbs-up"    value={`${STANDING.acceptPct}%`} label={t('more.acceptance')}  colors={colors} styles={styles} />
      </View>
    </View>
  );
}

function StandingStat({ icon, value, label, colors, styles }) {
  return (
    <View style={styles.standingStat}>
      <Icon name={icon} size={14} color={colors.textSecondary} />
      <Text style={[styles.standingStatValue, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.standingStatLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

/* ─────────── HOS Card ─────────── */

function HosCard({ hos, colors, styles, t }) {
  const tone  = toneOf(colors, hosState(hos.driveMinutesLeft));
  const pct   = Math.max(0, Math.min(1, hos.driveMinutesLeft / (11 * 60)));
  const state = hosState(hos.driveMinutesLeft);

  const stateLabel =
    state === 'go'      ? t('more.roadLeftPlenty') :
    state === 'caution' ? t('more.planStopSoon')   : t('more.timeToStop');

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[1]]}>

      {/* Top row */}
      <View style={styles.hosTop}>
        <View style={{ gap: 2 }}>
          <Text style={[styles.hosSmallLabel, { color: colors.textMuted }]}>{t('more.driveTimeLeft')}</Text>
          <CountUp
            value={hos.driveMinutesLeft}
            duration={1200}
            format={hm}
            style={[styles.hosValue, { color: tone.solid }]}
          />
        </View>
        <View style={[styles.hosBadge, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
          <View style={[styles.hosDot, { backgroundColor: tone.solid }]} />
          <Text style={[styles.hosBadgeText, { color: tone.solid }]}>{stateLabel}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={[styles.hosTrack, { backgroundColor: colors.surfaceHi }]}>
        <LinearGradient
          colors={tone.grad}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[styles.hosFill, { width: `${pct * 100}%` }]}
        />
      </View>
      <View style={styles.hosTickRow}>
        <Text style={[styles.hosTick, { color: colors.textMuted }]}>0h</Text>
        <Text style={[styles.hosTick, { color: colors.textMuted }]}>{t('more.hosMax')}</Text>
      </View>

      {/* Stats 2×2 */}
      <View style={styles.hosGrid}>
        <HosStat icon="navigation" label={t('more.drivenToday')}  value={hm(hos.drivenTodayMinutes)}  colors={colors} styles={styles} />
        <HosStat icon="coffee"     label={t('more.breakIn')}       value={hm(hos.breakInMinutes)}       colors={colors} styles={styles} />
        <HosStat icon="clock"      label={t('more.onDutyLeft')}  value={hm(hos.onDutyMinutesLeft)}    colors={colors} styles={styles} />
        <HosStat icon="repeat"     label={t('more.cycleLeft')}    value={`${hos.cycleHoursLeft}h`}     colors={colors} styles={styles} />
      </View>

      <View style={[styles.hosNote, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
        <Icon name="zap" size={12} color={colors.textMuted} />
        <Text style={[styles.hosNoteText, { color: colors.textMuted }]}>
          {t('more.eldNote')}
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
    paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[5],
    gap: space[4],
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroGreeting: { fontSize: 13, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.2 },
  heroEditBtn: {
    width: 34, height: 34, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  avatarRing: {
    width: 64, height: 64, borderRadius: 999,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.5)',
    padding: 3, flexShrink: 0,
  },
  avatarInner: {
    flex: 1, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPhoto: { flex: 1, borderRadius: 999 },
  avatarText: { fontSize: 24, fontFamily: FONT.black, color: '#FFFFFF' },
  heroName:   { fontSize: 20, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.4 },
  heroTruck:  { fontSize: 13, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  onDutyDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#1BD68C' },
  heroStatus: { fontSize: 12, fontFamily: FONT.bold, color: '#1BD68C' },
  heroLoadId: { fontSize: 12, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.5)' },

  heroStats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[2],
  },
  heroStat: { flex: 1, alignItems: 'center', gap: 3 },
  heroStatTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroStatValue: { fontSize: 17, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.3, ...type.num },
  heroStatLabel: { fontSize: 10, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.4 },
  heroStatDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.18)' },

  /* Generic card */
  card: { borderRadius: radius.xl, borderWidth: 1, padding: space[4], gap: space[4] },

  /* Standing */
  standingTop: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  scoreBadge: {
    width: 76, height: 76, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  scoreValue: { fontSize: 30, fontFamily: FONT.black, color: '#06121A', letterSpacing: -1, ...type.num },
  scoreMax: { fontSize: 10, fontFamily: FONT.bold, color: 'rgba(6,18,26,0.6)', marginTop: -2 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  tierName: { fontSize: 18, fontFamily: FONT.black, letterSpacing: -0.3 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.pill, borderWidth: 1,
  },
  tierBadgeText: { fontSize: 11, fontFamily: FONT.bold },
  tierSub: { fontSize: 12, fontFamily: FONT.medium },
  scoreTrack: { height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 2 },
  scoreFill: { height: '100%', borderRadius: 999 },
  standingGrid: { flexDirection: 'row', alignItems: 'center' },
  standingStat: { flex: 1, alignItems: 'center', gap: 4 },
  standingStatValue: { fontSize: 20, fontFamily: FONT.black, letterSpacing: -0.3, ...type.num },
  standingStatLabel: { fontSize: 11, fontFamily: FONT.bold },
  standingVDivider: { width: 1, height: 36 },

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

  /* Toggle row (settings switch) */
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingHorizontal: space[4], paddingVertical: 14,
  },
  toggleTitle: { ...type.body, fontFamily: FONT.semibold },
  toggleSub: { ...type.caption, lineHeight: 17 },

  /* Sign out */
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, borderWidth: 1.5, paddingVertical: 16,
  },
  signOutText: { fontSize: 15, fontFamily: FONT.bold },
  version: { ...type.caption, textAlign: 'center', marginTop: space[1] },
});
