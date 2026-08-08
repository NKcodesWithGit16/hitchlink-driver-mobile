import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Switch, Image, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import CountUp from '../../src/components/ui/CountUp';
import FadeInView from '../../src/components/ui/FadeInView';
import Skeleton from '../../src/components/ui/Skeleton';
import { hosState } from '../../src/components/driver/HOSPill';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT, useLanguage } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { useConfirmEveryStep, setConfirmEveryStep, useDistanceUnit, setDistanceUnit, useNavApp, setNavApp } from '../../src/lib/prefs';
import { availableNavApps, resolveNavApp, NAV_APP_LABELS } from '../../src/lib/navApps';
import { fetchHos, fetchActiveLoad, fetchEarnings, fetchLoadHistory } from '../../src/api/main';
import { hos as mockHos, earnings as mockEarnings } from '../../src/data/mock';
import { hm, toDistance, money, distNum } from '../../src/lib/format';
import { computeStanding } from '../../src/lib/standing';
import { space, type, radius, elevation, toneOf, FONT, shadow, ACCENT_PRESETS, BG_PRESETS_NIGHT } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';
import { useCallBannerInset } from '../../src/components/call/CallOverlay';

// The support channels a driver can actually reach. The email is the same one
// published in the web app's Terms and Privacy (companyInfo.js) — one address
// everywhere, or the legal pages promise a mailbox the app never mentions.
const SUPPORT_EMAIL = 'support@gethitchlink.com';
// tel: wants no spaces. Country code included because a driver may be roaming.
const SUPPORT_PHONE = '+995599084098';
const SUPPORT_PHONE_DISPLAY = '+995 599 084 098';

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const callInset = useCallBannerInset();
  const router = useRouter();
  const { colors, mode, setMode, accentKey, setAccent, bgKey, setBg, scheme, autoNextChangeAt } = useTheme();
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

  // A setting that changes on its own has to say when, or the driver can't tell
  // it apart from the app deciding things at random. No time means we had no
  // position and fell back to mirroring the phone, which is worth saying too.
  const autoCaption = useMemo(() => {
    if (mode !== 'auto') return null;
    if (!autoNextChangeAt) return t('more.themeAutoSystem');
    const time = new Date(autoNextChangeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return t(scheme === 'day' ? 'more.themeAutoDayUntil' : 'more.themeAutoNightUntil', { time });
  }, [mode, autoNextChangeAt, scheme, t]);

  const QUICK_ACTIONS = [
    { icon: 'zap',            label: t('more.eld'),      sub: t('more.eldSub'),      tone: 'teal',
      onPress: () => Alert.alert(t('more.eldAlertTitle'), t('more.eldAlertBody')) },
    { icon: 'message-circle', label: t('more.support'),  sub: t('more.supportSub'),  tone: 'blue',
      onPress: () => contactSupport() },
    { icon: 'star',           label: t('more.feedback'), sub: t('more.feedbackSub'), tone: 'purple',
      onPress: () => Alert.alert(t('more.feedback'), t('more.feedbackAlertBody')) },
  ];

  const languageLabel = lang === 'ka' ? t('more.languageGeorgian') : t('more.languageEnglish');
  const distanceUnit = useDistanceUnit();
  const distanceUnitLabel = distanceUnit === 'km' ? t('more.kilometers') : t('more.miles');
  // Resolved, not raw: this row must name the app Navigate will actually open.
  // A driver who picked Trucker Path before it was withdrawn from the iOS
  // picker would otherwise read "Trucker Path" while getting Google Maps.
  const navApp = resolveNavApp(useNavApp(), Platform.OS);

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
  // `route` navigates; `key: 'language'`/`'distanceUnit'` open their pickers;
  // otherwise a row falls back to an informational alert.
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
        { icon: 'map',         label: t('more.distanceUnits'), tone: 'teal',   meta: distanceUnitLabel, key: 'distanceUnit' },
        { icon: 'navigation',  label: t('more.navigationApp'), tone: 'blue',   meta: NAV_APP_LABELS[navApp], key: 'navApp' },
        { icon: 'eye-off',     label: t('more.hiddenLoads'),   tone: 'purple', meta: t('more.manage'), route: '/hidden-loads' },
      ],
    },
    {
      title: t('more.groupSupport'),
      rows: [
        { icon: 'help-circle', label: t('more.helpCenter'),     tone: 'teal'   },
        { icon: 'mail',        label: t('more.contactSupport'), tone: 'green',  meta: t('more.supportMeta'), key: 'support' },
        { icon: 'star',        label: t('more.rateApp'),        tone: 'orange' },
        { icon: 'shield',      label: t('more.termsPrivacy'),   tone: 'purple' },
      ],
    },
  ];
  const [hos,        setHos]        = useState(mockHos);
  const [earnings,   setEarnings]   = useState(mockEarnings);
  const [activeLoad, setActiveLoad] = useState(null);
  const [history,    setHistory]    = useState(null); // null = still loading
  const confirmEveryStep = useConfirmEveryStep();

  useEffect(() => {
    if (!userId) return;
    fetchHos(userId).then(d => { if (d) setHos(d); }).catch(() => {});
    fetchEarnings(userId).then(d => { if (d) setEarnings(d); }).catch(() => {});
    fetchActiveLoad(userId).then(setActiveLoad).catch(() => {});
    // Drives the standing card below — every figure there is derived from this,
    // so a failed fetch leaves it in its loading state rather than showing
    // invented numbers.
    fetchLoadHistory(userId).then(setHistory).catch(() => {});
  }, [userId]);

  const standing = useMemo(() => computeStanding(history), [history]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? t('more.greetingMorning') : h < 18 ? t('more.greetingAfternoon') : t('more.greetingEvening');
  }, [t]);

  // Email first, call second — deliberately. Support is a Georgian number and
  // the drivers are not, so a tap on "Call" can be an international call at
  // their expense. Email is free from anywhere and arrives with the version and
  // account already filled in, which is most of what a support reply needs.
  const contactSupport = () => {
    const subject = `HitchLink Driver support`;
    const body = [
      '',
      '',
      '---',
      `App version: ${Constants.expoConfig?.version ?? 'unknown'}`,
      `Platform: ${Platform.OS}`,
      userId ? `Account: ${userId}` : null,
    ].filter(Boolean).join('\n');
    const mailto = `mailto:${SUPPORT_EMAIL}`
      + `?subject=${encodeURIComponent(subject)}`
      + `&body=${encodeURIComponent(body)}`;

    Alert.alert(
      t('more.contactSupport'),
      t('more.supportAlertBody', { email: SUPPORT_EMAIL, phone: SUPPORT_PHONE_DISPLAY }),
      [
        { text: t('more.supportEmailBtn'), onPress: () => Linking.openURL(mailto).catch(() => {}) },
        { text: t('more.supportCallBtn'), onPress: () => Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {}) },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const onRow = (row) => {
    if (row.key === 'support') { contactSupport(); return; }
    if (row.key === 'language') {
      Alert.alert(t('more.language'), undefined, [
        { text: t('more.languageEnglish'), onPress: () => setLang('en') },
        { text: t('more.languageGeorgian'), onPress: () => setLang('ka') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    if (row.key === 'distanceUnit') {
      Alert.alert(t('more.distanceUnits'), undefined, [
        { text: t('more.miles'), onPress: () => setDistanceUnit('mi') },
        { text: t('more.kilometers'), onPress: () => setDistanceUnit('km') },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
    if (row.key === 'navApp') {
      // Brand names, so no i18n here (see lib/navApps). availableNavApps drops
      // Apple Maps on Android — it doesn't exist there, and dropping it also
      // keeps this to three buttons, which is all an Android Alert can show.
      Alert.alert(t('more.navigationApp'), undefined, [
        ...availableNavApps(Platform.OS).map((app) => ({
          text: NAV_APP_LABELS[app],
          onPress: () => setNavApp(app),
        })),
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
    <ScreenFade style={[styles.screen, { paddingTop: insets.top + callInset }]}>
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

            {/* Identity — the avatar opens the editor, same as the pencil above
                it and the Profile row below. A driver reaches for their own face
                before they hunt for a 15px icon. */}
            <View style={styles.heroIdentity}>
              <Pressable
                onPress={() => router.push('/edit-profile')}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('more.editProfileA11y')}
                style={({ pressed }) => [styles.avatarRing, pressed && { opacity: 0.85 }]}
              >
                {user?.photoUrl ? (
                  <Image source={{ uri: user.photoUrl }} style={styles.avatarPhoto} />
                ) : (
                  <View style={styles.avatarInner}>
                    <Text style={styles.avatarText}>
                      {(user?.firstName || t('more.driver')).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
              </Pressable>

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

            {/* Glass stats strip — every figure here is real: two derived from
                the driver's completed-load history, one from their earnings. */}
            <View style={styles.heroStats}>
              <HeroStat icon="package"    value={String(standing.delivered)} label={t('earnings.loadsCompleted')} styles={styles} />
              <View style={styles.heroStatDivider} />
              <HeroStat icon="zap"        value={String(standing.streak)}    label={t('more.loadStreak')}         styles={styles} />
              <View style={styles.heroStatDivider} />
              <HeroStat icon="navigation" value={`${(toDistance(earnings.week.miles, distanceUnit) / 1000).toFixed(1)}k`} label={distanceUnit === 'km' ? t('more.kmPerWeek') : t('more.miPerWeek')} styles={styles} />
            </View>
          </LinearGradient>
        </FadeInView>

        {/* ── Driver record (real history) ── */}
        <FadeInView delay={60} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{t('more.yourRecord')}</Text>
          <StandingCard standing={standing} loading={history === null} unit={distanceUnit} colors={colors} styles={styles} t={t} />
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
              {!!autoCaption && (
                <Text style={[styles.themeHint, { color: colors.textMuted }]}>{autoCaption}</Text>
              )}
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

          {/* Deliberately a quiet text link rather than a second red button.
              Apple requires account deletion to be easy to FIND, not easy to
              trigger — and this sits directly under Sign out, where a tired
              thumb aiming for that could otherwise land on it. The screen it
              opens is where the real safeguards are. */}
          <Pressable
            onPress={() => router.push('/delete-account')}
            hitSlop={6}
            style={styles.deleteAccountBtn}
            accessibilityRole="button"
            accessibilityLabel={t('more.deleteAccountA11y')}
          >
            <Text style={[styles.deleteAccountText, { color: colors.textMuted }]}>
              {t('more.deleteAccount')}
            </Text>
          </Pressable>

          {/* Read from the app config, never typed into the translations. A
              hardcoded version is wrong the moment it ships and nobody notices
              — this said v1.0.0 while the app was on 1.2.3. It is also the
              first thing support asks a driver for, so it has to be true. */}
          <Text style={[styles.version, { color: colors.textMuted }]}>
            {t('more.version', { version: Constants.expoConfig?.version ?? '—' })}
          </Text>
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

/* ─────────── Record Card ─────────── */

// Every number here comes from the driver's real completed-load history (see
// lib/standing.js). This deliberately shows fewer figures than the invented
// version it replaced: on-time %, a star rating and an acceptance rate are all
// absent because the history endpoint carries no delivery deadline, no ratings
// and no declines — so there is no honest way to compute them client-side.
function StandingCard({ standing, loading, unit, colors, styles, t }) {
  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[2]]}>
        <View style={styles.recordSkeletonRow}>
          <Skeleton width={76} height={76} radius={radius.lg} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="85%" height={12} />
          </View>
        </View>
      </View>
    );
  }

  // A driver with no delivered loads yet gets an honest empty state rather
  // than a wall of confident zeros.
  if (!standing.hasData) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[1]]}>
        <View style={styles.recordEmpty}>
          <View style={[styles.recordEmptyIcon, { backgroundColor: colors.tealFill }]}>
            <Icon name="package" size={22} color={colors.teal} />
          </View>
          <Text style={[styles.tierName, { color: colors.textPrimary }]}>{t('more.recordEmptyTitle')}</Text>
          <Text style={[styles.tierSub, { color: colors.textMuted, textAlign: 'center' }]}>
            {t('more.recordEmptySub')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[2]]}>
      <View style={styles.standingTop}>
        {/* Delivered-loads medallion — a count, not a manufactured score. */}
        <LinearGradient
          colors={colors.gradients.go}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.scoreBadge, shadow.glow(colors.go)]}
        >
          <CountUp value={standing.delivered} duration={1200} style={styles.scoreValue} />
          <Text style={styles.scoreMax}>{t('more.deliveredShort')}</Text>
        </LinearGradient>

        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.tierName, { color: colors.textPrimary }]}>
            {t('more.recordHeadline', { miles: distNum(standing.miles, unit), unit })}
          </Text>
          <Text style={[styles.tierSub, { color: colors.textMuted }]}>
            {t('more.recordSub', { earned: money(standing.earned) })}
          </Text>
        </View>
      </View>

      <View style={styles.standingGrid}>
        <StandingStat icon="check-circle" value={String(standing.delivered)} label={t('earnings.loadsCompleted')} colors={colors} styles={styles} />
        <View style={[styles.standingVDivider, { backgroundColor: colors.border }]} />
        <StandingStat icon="zap"          value={String(standing.streak)}    label={t('more.loadStreak')}        colors={colors} styles={styles} />
        <View style={[styles.standingVDivider, { backgroundColor: colors.border }]} />
        <StandingStat
          icon="navigation"
          value={distNum(standing.miles, unit)}
          label={unit === 'km' ? t('earnings.kilometersDriven') : t('earnings.milesDriven')}
          colors={colors}
          styles={styles}
        />
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

  /* Record */
  standingTop: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  scoreBadge: {
    width: 76, height: 76, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  scoreValue: { fontSize: 30, fontFamily: FONT.black, color: '#06121A', letterSpacing: -1, ...type.num },
  scoreMax: { fontSize: 10, fontFamily: FONT.bold, color: 'rgba(6,18,26,0.6)', marginTop: -2 },
  tierName: { fontSize: 18, fontFamily: FONT.black, letterSpacing: -0.3 },
  tierSub: { fontSize: 12, fontFamily: FONT.medium, lineHeight: 18 },
  recordSkeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  recordEmpty: { alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  recordEmptyIcon: {
    width: 52, height: 52, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center', marginBottom: space[1],
  },
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
  // Spacing comes from settingBlock's gap; -4 pulls it back toward the buttons
  // it describes so it reads as their caption rather than a new row.
  themeHint: { fontSize: 11, fontFamily: FONT.medium, marginTop: -4 },
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
  /* Muted and unboxed — present, findable, and not competing with Sign out.
     Still 44pt tall so it stays tappable for anyone who does want it. */
  deleteAccountBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  deleteAccountText: { fontSize: 13, fontFamily: FONT.medium, textDecorationLine: 'underline' },
  version: { ...type.caption, textAlign: 'center', marginTop: space[1] },
});
