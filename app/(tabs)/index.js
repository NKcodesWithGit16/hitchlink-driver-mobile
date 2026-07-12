import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Modal,
  RefreshControl, Image, Animated, ImageBackground, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import haptics from '../../src/lib/haptics';

import StatusBar from '../../src/components/driver/StatusBar';
import NextStopCard from '../../src/components/driver/NextStopCard';
import WeatherStrip from '../../src/components/driver/WeatherStrip';
import ActionGrid from '../../src/components/driver/ActionGrid';
import StageStepper from '../../src/components/driver/StageStepper';
import MissionStrip from '../../src/components/driver/MissionStrip';
import PrimaryAction from '../../src/components/ui/PrimaryAction';
import SectionLabel from '../../src/components/ui/SectionLabel';
import Card from '../../src/components/ui/Card';
import Icon from '../../src/components/ui/Icon';
import CountUp from '../../src/components/ui/CountUp';
import FadeInView from '../../src/components/ui/FadeInView';
import Confetti from '../../src/components/ui/Confetti';
import BrandLogo from '../../src/components/BrandLogo';
import OfflineBanner from '../../src/components/ui/OfflineBanner';
import ScreenFade from '../../src/components/ui/ScreenFade';
import GlassView from '../../src/components/ui/GlassView';
import UndoToast from '../../src/components/ui/UndoToast';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { enqueue, flush, queueCount } from '../../src/lib/offlineQueue';
import { TAB_BAR_CLEARANCE } from './_layout';

import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { useAlert } from '../../src/context/AlertContext';
import { fetchActiveLoad, updateLoadStatus, undoLoadStatus, sendPhotoMessage, uploadLoadPhoto } from '../../src/api/main';
import { useLoadStatusSocket } from '../../src/hooks/useLoadStatusSocket';
import { useConfirmEveryStep } from '../../src/lib/prefs';
import { hos, weatherNow } from '../../src/data/mock';
import { nextAction, statusChip, nextStop, isPrePickup } from '../../src/lib/load';
import { setActiveLoad, finalizeActiveLoad, computeLoadStats } from '../../src/lib/odometer';
import { money, num, rpm } from '../../src/lib/format';
import { space, type, radius, FONT, shadow, toneOf, tap } from '../../src/theme/tokens';
import { photos } from '../../src/theme/photos';

export default function LoadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { unreadCount, activeAlert, openModal: openAlert } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const online = useNetworkStatus();
  const confirmEveryStep = useConfirmEveryStep();
  const [pending, setPending] = useState(0);

  const [load, setLoad] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [podUri, setPodUri] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(false);
  const [undo, setUndo] = useState(null); // { prevStatus, message }
  const [deliveredStats, setDeliveredStats] = useState(null); // frozen actual miles/rpm

  // Point the actual-miles odometer at the running load so it accrues GPS
  // distance to the right bucket (deadhead vs loaded) as the status advances.
  // Terminal states don't accrue — delivery is handled by the effect below.
  useEffect(() => {
    if (!load?.id || !status || status === 'Delivered') return;
    setActiveLoad({ loadId: load.id, status, plannedMiles: load.miles, rate: load.rate });
  }, [load?.id, load?.miles, load?.rate, status]);

  // On delivery (driver tap OR a dispatcher/geofence auto-advance over the
  // socket), freeze the odometer into a stored record and show it. Guarded so
  // it finalizes once per delivered load, not on every re-render.
  useEffect(() => {
    if (status !== 'Delivered' || !load?.id || deliveredStats) return;
    finalizeActiveLoad({ loadId: load.id, plannedMiles: load.miles, rate: load.rate })
      .then(setDeliveredStats)
      .catch(() => {});
  }, [status, load?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback(async () => {
    try {
      const d = await fetchActiveLoad(user?.id);
      setLoad(d);
      setStatus(d?.status ?? null);
      setError(false);
    } catch {
      // A failed fetch must NOT look like a happy "no load" — flag it.
      setError(true);
    }
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => { queueCount().then(setPending); }, []);

  useEffect(() => {
    if (!online) return;
    flush(async (item) => {
      try {
        await updateLoadStatus(item.loadId, item.status);
      } catch (e) {
        // A 4xx means the queued step no longer applies (the load moved on) —
        // drop it. Only transient errors (offline/5xx) are worth replaying.
        if (e?.status >= 400 && e?.status < 500) return;
        throw e;
      }
    }).then((done) => {
      if (done > 0) queueCount().then(setPending);
    });
  }, [online]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Keep the load in a ref so the SignalR callback always sees the current one
  // without re-subscribing on every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  // Live inbound sync: a dispatcher correction, a GPS geofence auto-advance, or
  // our own tap echoed back all land here within ~1s and move the screen to
  // match the backend — so driver and dispatcher never drift apart.
  useLoadStatusSocket(user?.id, useCallback((loadId, newStatus) => {
    const cur = loadRef.current;
    if (!cur || String(loadId) !== String(cur.id)) return;
    if (newStatus === 'Cancelled' || newStatus === 'Closed') {
      // The load left active service — reconcile to the real "no load / next
      // load" state instead of leaving a half-rendered terminal status.
      loadData();
      return;
    }
    setStatus((prev) => {
      // "AtDelivery" is screen-only (the backend stays EnRouteToDropoff until
      // Delivered) — don't let the server's equivalent state pull the screen
      // back off the "arrived" view the driver already advanced to.
      if (prev === 'AtDelivery' && newStatus === 'EnRouteToDropoff') return prev;
      return newStatus;
    });
  }, [loadData]));

  const advance = async (next) => {
    const prev = status;
    setBusy(true);
    setStatus(next);
    // Screen-only stage — the backend has no "AtDelivery"; it stays
    // EnRouteToDropoff until "Delivered", so there's nothing to send.
    if (next === 'AtDelivery') { setBusy(false); return; }
    if (!online) {
      setPending(await enqueue({ loadId: load.id, status: next }));
      setBusy(false);
      return;
    }
    try {
      await updateLoadStatus(load.id, next);
    } catch (e) {
      if (e?.status >= 400 && e?.status < 500) {
        // The server rejected it — snap the screen back so it matches the
        // backend instead of silently diverging, and drop any offered Undo.
        setStatus(prev);
        setUndo(null);
        Alert.alert(
          "That didn't go through",
          "Your load may have already moved on. We've set it back to match dispatch — pull to refresh if it still looks off.",
        );
      } else {
        // Offline / server blip — queue to replay when the connection returns.
        setPending(await enqueue({ loadId: load.id, status: next }));
      }
    } finally {
      setBusy(false);
    }
  };

  const capturePod = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      const launch = perm.granted ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const res = await launch({ quality: 0.6 });
      if (res.canceled) return null;
      return res.assets?.[0]?.uri ?? null;
    } catch {
      return null;
    }
  };

  // Perform a status step: capture POD if the step calls for it, advance, then
  // offer a short-lived Undo (every step except the final Delivered, and only
  // when online — Undo needs the server).
  const runAction = async (action) => {
    haptics.success();
    const prevStatus = status;
    if (action.pod) {
      const uri = await capturePod();
      if (uri) {
        setPodUri(uri);
        // Store the paperwork two ways: against the load itself (the permanent
        // record the dispatcher's Completed Loads history reads) and as a chat
        // photo (a live heads-up in the dispatch thread). The delivery still
        // counts if either upload fails — tell the driver so they can resend it
        // from Messages instead of silently losing the paperwork.
        Promise.allSettled([
          uploadLoadPhoto(load?.id, { uri, caption: 'Delivery paperwork' }),
          sendPhotoMessage(user?.id, { uri, text: `📄 Delivery paperwork — ${load?.id ?? 'load'}` }),
        ]).then((results) => {
          if (results.some((r) => r.status === 'rejected')) {
            Alert.alert(
              'Photo not sent',
              "Your delivery was recorded, but the paperwork photo couldn't upload. Please resend it from Messages.",
            );
          }
        });
      }
    }
    advance(action.next);
    if (action.next !== 'Delivered' && online) {
      setUndo({ prevStatus, message: 'Update sent to dispatcher' });
    }
  };

  const handlePrimary = () => {
    const action = nextAction(status);
    if (!action) return;
    // Milestones (cargo on board, delivered) always confirm. Arrivals advance on
    // a single tap unless the driver opted into confirm-every-step in Settings.
    if (action.milestone || confirmEveryStep) {
      setPendingAction(action);
    } else {
      runAction(action);
    }
  };

  const confirmAndAdvance = () => {
    const action = pendingAction;
    setPendingAction(null);
    runAction(action);
  };

  const handleUndo = async () => {
    if (!undo) return;
    haptics.tap();
    const target = undo.prevStatus;
    const current = status;
    setUndo(null);
    setStatus(target); // optimistic — the server echo confirms it
    try {
      await undoLoadStatus(load.id, user?.id, target);
    } catch {
      // Too late to take back (window passed, or it already moved on). Restore
      // and point the driver at dispatch, who can still correct it.
      setStatus(current);
      Alert.alert(
        "Couldn't undo",
        "That update was already saved. Ask your dispatcher to correct the status if it's wrong.",
      );
    }
  };

  if (loading) {
    return (
      <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <Icon name="loader" size={26} color={colors.textMuted} />
          <Text style={styles.muted}>Getting your day ready…</Text>
        </View>
      </ScreenFade>
    );
  }

  if (error && !load) {
    return (
      <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
        <Header colors={colors} styles={styles} name={user?.firstName} unreadCount={unreadCount} onBell={() => router.push('/alerts')} />
        <View style={[styles.center, { flex: 1, paddingHorizontal: space[6] }]}>
          <View style={[styles.errorIcon, { backgroundColor: colors.cautionFill, borderColor: colors.bg }]}>
            <Icon name="wifi-off" size={34} color={colors.caution} />
          </View>
          <Text style={styles.emptyTitle}>Can't reach HitchLink</Text>
          <Text style={styles.emptySub}>We couldn't load your trip just now. Check your signal — your last update is safe and nothing was lost.</Text>
          <Pressable
            onPress={onRefresh}
            style={[styles.refreshBtn, { borderColor: colors.caution }]}
            accessibilityRole="button"
            accessibilityLabel="Try loading your trip again"
          >
            <Icon name="refresh-cw" size={16} color={colors.caution} />
            <Text style={[styles.refreshText, { color: colors.caution }]}>Try again</Text>
          </Pressable>
        </View>
      </ScreenFade>
    );
  }

  if (!load) {
    return (
      <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
        <Header colors={colors} styles={styles} name={user?.firstName} unreadCount={unreadCount} onBell={() => router.push('/alerts')} />
        <ImageBackground source={photos.road} style={styles.emptyHero}>
          <LinearGradient colors={['transparent', colors.bg]} style={StyleSheet.absoluteFill} />
        </ImageBackground>
        <View style={[styles.center, { flex: 1, paddingHorizontal: space[6], marginTop: -48 }]}>
          <View style={styles.emptyIcon}>
            <Icon name="coffee" size={34} color={colors.go} />
          </View>
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySub}>No load right now — enjoy the quiet. Your dispatcher will send your next one straight here.</Text>
          <Pressable
            onPress={onRefresh}
            style={styles.refreshBtn}
            accessibilityRole="button"
            accessibilityLabel="Check for new loads"
          >
            <Icon name="refresh-cw" size={16} color={colors.teal} />
            <Text style={styles.refreshText}>Check again</Text>
          </Pressable>
        </View>
      </ScreenFade>
    );
  }

  const chip = statusChip(status);
  const stop = nextStop(load, status);
  const action = nextAction(status);
  const delivered = status === 'Delivered';

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>
      <Header colors={colors} styles={styles} name={user?.firstName} unreadCount={unreadCount} onBell={() => router.push('/alerts')} />
      <StatusBar chip={chip} driveMinutesLeft={hos.driveMinutesLeft} online={online} onHosPress={() => router.push('/(tabs)/more')} />
      {!online ? <OfflineBanner pending={pending} /> : null}

      <ScrollView
        contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + TAB_BAR_CLEARANCE, gap: space[4] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {delivered ? (
          <DeliveredCard
            colors={colors}
            styles={styles}
            load={load}
            podUri={podUri}
            stats={deliveredStats ?? computeLoadStats(load, null)}
          />
        ) : (
          <>
            {/* ── MISSION: full trip at a glance ── */}
            <FadeInView>
              <MissionStrip load={load} />
            </FadeInView>

            {/* ── JOURNEY + ACTION: progress → what to do right now ── */}
            <FadeInView delay={50}>
              <Card style={styles.journeyCard} elevated>
                <StageStepper status={status} />
                {action ? (
                  <>
                    <View style={[styles.journeyDivider, { backgroundColor: colors.border }]} />
                    <PrimaryAction
                      label={action.label}
                      icon={action.icon}
                      tone={action.tone}
                      loading={busy}
                      onPress={handlePrimary}
                    />
                  </>
                ) : null}
              </Card>
            </FadeInView>

            {/* ── CURRENT STOP ── */}
            <FadeInView delay={100}>
              <NextStopCard stop={stop} />
            </FadeInView>

            {/* ── WEATHER AHEAD: calm when clear, loud when dangerous ── */}
            <FadeInView delay={150}>
              <WeatherStrip now={weatherNow} alert={activeAlert} onPress={openAlert} />
            </FadeInView>
          </>
        )}

        <ActionGrid
          address={isPrePickup(status) ? load.originAddress : load.destAddress}
          phone={load.broker?.phone}
          onChat={() => router.push('/(tabs)/messages')}
        />

        {/* ── PAY ── */}
        <Card style={styles.payCard}>
          <View style={styles.payRow}>
            <PayStat colors={colors} styles={styles} label="Gross pay" big animateValue={load.rate} format={(n) => money(n)} />
            <View style={styles.payDivider} />
            <PayStat colors={colors} styles={styles} label="Rate / mi" value={`$${rpm(load.rpm)}`} />
            <View style={styles.payDivider} />
            <PayStat colors={colors} styles={styles} label="Distance" value={`${num(load.miles)} mi`} />
          </View>
        </Card>

        {/* ── LOAD DETAILS (collapsible) ── */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.expandHead}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`Load details for ${load.id}. ${expanded ? 'Tap to hide' : 'Tap to show'}`}
        >
          <SectionLabel style={{ margin: 0 }}>Load details · {load.id}</SectionLabel>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </Pressable>
        {expanded ? (
          <Card style={{ gap: space[3] }}>
            <DetailRow colors={colors} styles={styles} icon="package" label="Commodity" value={load.commodity} />
            <DetailRow colors={colors} styles={styles} icon="bar-chart-2" label="Weight" value={`${num(load.weight)} lb · ${load.equipment}`} />
            <DetailRow colors={colors} styles={styles} icon="clock" label="Pickup" value={`${load.pickupDate} · ${load.pickupWindowText}`} />
            <DetailRow colors={colors} styles={styles} icon="clock" label="Delivery" value={`${load.deliveryDate} · ${load.deliveryWindowText}`} />
            <DetailRow colors={colors} styles={styles} icon="briefcase" label="Broker" value={`${load.broker?.name} · ${load.broker?.ref}`} />
            {load.notes ? <DetailRow colors={colors} styles={styles} icon="alert-circle" label="Notes" value={load.notes} /> : null}
          </Card>
        ) : null}
      </ScrollView>

      <ConfirmActionModal
        visible={!!pendingAction}
        action={pendingAction}
        load={load}
        colors={colors}
        styles={styles}
        onConfirm={confirmAndAdvance}
        onCancel={() => setPendingAction(null)}
      />

      <UndoToast
        visible={!!undo}
        message={undo?.message}
        onUndo={handleUndo}
        onHide={() => setUndo(null)}
      />
    </ScreenFade>
  );
}

/* ───────── Local pieces ───────── */
function Header({ colors, styles, name, unreadCount = 0, onBell }) {
  const initials = (name || 'Driver').slice(0, 1).toUpperCase();
  const hasUnread = unreadCount > 0;
  return (
    <View style={styles.header}>
      <BrandLogo size={26} layout="horizontal" />
      <View style={styles.headerRight}>
        {/* Bell with unread count badge */}
        <Pressable
          onPress={onBell}
          style={styles.iconBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hasUnread ? `${unreadCount} unread alerts — open` : 'Alerts'}
        >
          <Icon name="bell" size={20} color={hasUnread ? colors.teal : colors.textSecondary} />
          {hasUnread ? (
            <View style={[styles.badge, { backgroundColor: colors.danger }]}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={[styles.avatar, { backgroundColor: colors.surfaceHi, borderColor: colors.border }]}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      </View>
    </View>
  );
}

function PayStat({ colors, styles, label, value, big, animateValue, format }) {
  const valStyle = [big ? styles.payValueBig : styles.payValue, type.num];
  return (
    <View style={styles.payStat}>
      <Text style={styles.payLabel}>{label}</Text>
      {animateValue != null
        ? <CountUp value={animateValue} format={format} style={valStyle} numberOfLines={1} adjustsFontSizeToFit />
        : <Text style={valStyle} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
    </View>
  );
}

function DetailRow({ colors, styles, icon, label, value }) {
  return (
    <View style={styles.detailRow}>
      <Icon name={icon} size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function DeliveredCard({ colors, styles, load, podUri, stats }) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(reduce ? 1 : 0.9)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.spring(scale, { toValue: 1, damping: 11, stiffness: 150, useNativeDriver: true }).start();
  }, []);
  const s = stats || {};
  const ink = colors.onAccent;
  // Real numbers only — how far he actually drove, what it paid, per mile.
  const showSplit = s.hasActual && (s.loaded != null || s.deadhead != null);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <LinearGradient colors={colors.gradients.go} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.delivered}>
        <Confetti />
        <View style={styles.deliveredIcon}>
          <Icon name="check" size={30} color={colors.go} />
        </View>
        <Text style={[styles.deliveredTitle, { color: ink }]}>Nice work.</Text>
        <Text style={[styles.deliveredSub, { color: ink }]}>That's delivered — {load.origin} → {load.destination}</Text>

        <View style={styles.deliveredStats}>
          <View style={styles.deliveredStatCell}>
            <Text style={[styles.deliveredStatVal, { color: ink }]}>{num(s.driven ?? load.miles)}</Text>
            <Text style={[styles.deliveredStatUnit, { color: ink }]}>Mi driven</Text>
          </View>
          <View style={[styles.deliveredStatCell, styles.deliveredStatDivider]}>
            <Text style={[styles.deliveredStatVal, { color: ink }]}>{money(s.rate ?? load.rate)}</Text>
            <Text style={[styles.deliveredStatUnit, { color: ink }]}>Paid</Text>
          </View>
          <View style={[styles.deliveredStatCell, styles.deliveredStatDivider]}>
            <Text style={[styles.deliveredStatVal, { color: ink }]}>${rpm(s.effectiveRpm ?? load.rpm)}</Text>
            <Text style={[styles.deliveredStatUnit, { color: ink }]}>Per mile</Text>
          </View>
        </View>

        {showSplit ? (
          <View style={styles.deliveredSplit}>
            <Text style={[styles.deliveredSplitText, { color: ink }]}>{num(s.loaded)} mi loaded</Text>
            <View style={[styles.deliveredSplitPip, { backgroundColor: ink }]} />
            <Text style={[styles.deliveredSplitText, { color: ink }]}>{num(s.deadhead)} mi deadhead</Text>
          </View>
        ) : null}

        {podUri ? <Image source={{ uri: podUri }} style={styles.podThumb} /> : null}
      </LinearGradient>
    </Animated.View>
  );
}

function ConfirmActionModal({ visible, action, load, colors, styles, onConfirm, onCancel }) {
  if (!action) return null;
  const t = toneOf(colors, action.tone);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmOverlay}>
        <GlassView radius={radius['2xl']} style={styles.confirmCard}>
          <View style={[styles.confirmBadge, { backgroundColor: t.fill, borderColor: t.solid }]}>
            <Icon name={action.icon} size={28} color={t.solid} />
          </View>
          <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>{action.label}</Text>
          {load ? (
            <Text style={[styles.confirmSub, { color: colors.textSecondary }]}>
              {load.origin} → {load.destination} · {load.id}
            </Text>
          ) : null}
          {action.pod ? (
            <View style={[styles.confirmNote, { backgroundColor: colors.tealFill, borderColor: colors.teal }]}>
              <Icon name="camera" size={14} color={colors.teal} />
              <Text style={[styles.confirmNoteText, { color: colors.teal }]}>You'll be asked to photograph the signed paperwork</Text>
            </View>
          ) : (
            <View style={[styles.confirmNote, { backgroundColor: colors.cautionFill, borderColor: colors.caution }]}>
              <Icon name="alert-triangle" size={14} color={colors.caution} />
              <Text style={[styles.confirmNoteText, { color: colors.caution }]}>This update will be sent to your dispatcher</Text>
            </View>
          )}
          <Pressable
            onPress={onConfirm}
            style={({ pressed }) => [styles.confirmBtn, { backgroundColor: t.solid, opacity: pressed ? 0.88 : 1 }, shadow.glow(t.solid)]}
            accessibilityRole="button"
            accessibilityLabel={`Confirm: ${action.label}`}
          >
            <Icon name="check" size={20} color={t.ink} />
            <Text style={[styles.confirmBtnText, { color: t.ink }]}>Yes, confirm</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel and go back"
          >
            <Text style={[styles.cancelBtnText, { color: colors.textMuted }]}>Cancel — go back</Text>
          </Pressable>
        </GlassView>
      </View>
    </Modal>
  );
}

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
  muted: { ...type.body, color: c.textMuted },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[3],
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  iconBtn: { width: tap.icon, height: tap.icon, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 3, right: 3, minWidth: 18, height: 18, borderRadius: 999,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: c.bg,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: FONT.extrabold, lineHeight: 12, ...type.num },
  avatar: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarText: { ...type.bodyStrong, color: c.textPrimary },

  journeyCard: { gap: space[5], padding: space[6] },
  journeyDivider: { height: 1, marginHorizontal: -space[6] },

  emptyHero: { height: 200, width: '100%' },
  emptyIcon: { width: 84, height: 84, borderRadius: 999, backgroundColor: c.goFill, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: c.bg },
  errorIcon: { width: 84, height: 84, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 3, marginBottom: space[2] },
  emptyTitle: { ...type.h1, color: c.textPrimary, textAlign: 'center' },
  emptySub: { ...type.body, color: c.textSecondary, textAlign: 'center', lineHeight: 24 },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space[3],
    paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  refreshText: { ...type.bodyStrong, color: c.teal },

  payCard: { paddingVertical: space[4] },
  payRow: { flexDirection: 'row', alignItems: 'center' },
  payStat: { flex: 1, alignItems: 'center', gap: 3 },
  payDivider: { width: 1, height: 34, backgroundColor: c.border },
  payLabel: { ...type.label, fontSize: 10, color: c.textMuted },
  payValue: { fontSize: 23, fontFamily: FONT.extrabold, color: c.textPrimary },
  payValueBig: { fontSize: 30, fontFamily: FONT.black, color: c.go, letterSpacing: -0.8 },

  expandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[1] },
  detailRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  detailLabel: { ...type.label, fontSize: 10.5, color: c.textMuted, marginBottom: 2 },
  detailValue: { ...type.body, color: c.textPrimary, lineHeight: 22 },

  delivered: { borderRadius: radius['2xl'], padding: space[6], alignItems: 'center', gap: 6, overflow: 'hidden' },
  deliveredIcon: { width: 70, height: 70, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  deliveredTitle: { fontSize: 32, fontFamily: FONT.black, letterSpacing: -0.8 },
  deliveredSub: { ...type.bodyStrong, textAlign: 'center' },
  deliveredStats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: space[4], borderRadius: radius.md, backgroundColor: 'rgba(6,18,26,0.12)' },
  deliveredStatCell: { flex: 1, paddingVertical: space[3], paddingHorizontal: space[2], alignItems: 'center' },
  deliveredStatDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(6,18,26,0.16)' },
  deliveredStatVal: { fontSize: 24, fontFamily: FONT.black, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  deliveredStatUnit: { fontSize: 10.5, fontFamily: FONT.bold, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6, opacity: 0.72 },
  deliveredSplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: space[2] },
  deliveredSplitText: { fontSize: 12.5, fontFamily: FONT.bold, opacity: 0.72, fontVariant: ['tabular-nums'] },
  deliveredSplitPip: { width: 5, height: 5, borderRadius: 3, opacity: 0.55 },
  podThumb: { width: 120, height: 120, borderRadius: radius.md, marginTop: space[4], borderWidth: 2, borderColor: '#fff' },

  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 40, paddingHorizontal: space[5] },
  confirmCard: { width: '100%', borderRadius: radius['2xl'], borderWidth: 1, padding: space[6], alignItems: 'center', gap: space[3] },
  confirmBadge: { width: 72, height: 72, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: space[2] },
  confirmTitle: { fontSize: 22, fontFamily: FONT.black, textAlign: 'center', letterSpacing: -0.3 },
  confirmSub: { ...type.caption, textAlign: 'center', lineHeight: 20 },
  confirmNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[4], paddingVertical: space[3], marginTop: space[2], width: '100%' },
  confirmNoteText: { ...type.caption, flex: 1, lineHeight: 19 },
  confirmBtn: { width: '100%', height: 60, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: space[3] },
  confirmBtnText: { fontSize: 18, fontFamily: FONT.extrabold },
  cancelBtn: { width: '100%', height: 52, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { ...type.bodyStrong },
});
