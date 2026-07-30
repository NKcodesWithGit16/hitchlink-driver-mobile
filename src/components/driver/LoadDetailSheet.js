// Load history → detail sheet. Opens when the driver taps a past load in the
// Pay tab and shows the full picture: planned (what the broker booked) vs actual
// (what he really drove, from the GPS odometer) — miles, deadhead, and booked
// vs effective $/mi. Degrades gracefully: a load with no recorded trail shows
// planned-only instead of zeros; a cancelled load shows why.
//
// Self-contained and theme-driven — it takes `colors` and builds its own styles,
// like the app's other overlays. `stats` comes from computeLoadStats (lib/loadStats).

import { useMemo, useRef } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Image, Animated, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import haptics from '../../lib/haptics';
import { money, num, signedNum, distNum, toDistance, distRpm, toRatePerDistance } from '../../lib/format';
import { space, radius, type, FONT, toneOf } from '../../theme/tokens';
import { useT } from '../../i18n/LanguageContext';

// Drag-to-dismiss, on RN's own Animated + PanResponder — same reasoning as
// PhotoViewer: gesture-handler/reanimated aren't in this project and adding a
// native module for one sheet isn't worth an extra EAS build.
//
// Two independent ways to let go and have it close, because they're different
// gestures: a slow deliberate pull past DISMISS_DISTANCE, or a quick flick
// that never travels far but is clearly downward (DISMISS_VELOCITY, px/ms).
// Distance alone makes a flick feel broken — the sheet snaps back under a
// thumb that has already left the glass.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.7;
// Upward drag is rubber-banded rather than free: the sheet is already at its
// full height, so there is nothing above it to pull into view.
const RUBBER_BAND = 0.18;

// Tolerant date label: handles both 'YYYY-MM-DD' (mock) and a full ISO
// timestamp (live /history), never renders a raw string.
function fmtDate(iso, months) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const brokerName = (load) => (typeof load?.broker === 'string' ? load.broker : load?.broker?.name || '');

// Signed rate delta (caller converts to the display unit first), e.g. "−$0.24" — real minus glyph to match figures.
const signedRpm = (n) => (n == null || isNaN(n) ? '' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`);

export default function LoadDetailSheet({ load, stats, colors, unit = 'mi', onClose, onOpenPhoto }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const dragY = useRef(new Animated.Value(0)).current;
  // Whether the drag has already crossed the close threshold, so the "you can
  // let go now" tick fires once per crossing instead of on every frame past it.
  const armed = useRef(false);

  // The scrim thins out as the sheet is pulled down, so the drag reads as
  // dismissing rather than as the sheet sliding around behind a fixed dim.
  const scrim = dragY.interpolate({ inputRange: [0, 320], outputRange: [1, 0.25], extrapolate: 'clamp' });

  const pan = useMemo(() => {
    const settle = () => {
      armed.current = false;
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    };

    return PanResponder.create({
      // Claimed on contact, in both phases — see the band's comment in the JSX.
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { armed.current = false; },

      onPanResponderMove: (_e, g) => {
        const y = g.dy < 0 ? g.dy * RUBBER_BAND : g.dy;
        dragY.setValue(y);
        const past = y > DISMISS_DISTANCE;
        if (past !== armed.current) {
          armed.current = past;
          if (past) haptics.tap();
        }
      },

      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DISTANCE || (g.dy > 0 && g.vy > DISMISS_VELOCITY)) {
          // Let the Modal's own slide-out finish the exit from wherever the
          // drag left the sheet — animating it away first and then dismissing
          // plays the same movement twice.
          onClose?.();
          return;
        }
        settle();
      },

      // Once the pull starts it stays ours; nothing above should be able to
      // yank it away mid-drag and strand the sheet half-way down.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: settle,
    });
  }, [dragY, onClose]);

  if (!load) return null;

  const s = stats || {};
  const cancelled = load.status === 'Cancelled';
  const badge = toneOf(colors, cancelled ? 'danger' : 'go');
  const photos = load.photos || [];

  // Bar geometry: segments are drawn against the larger of driven/planned so the
  // planned marker always stays on the track, and driving less than booked reads
  // as empty track before the marker.
  const denom = Math.max(s.driven || 0, s.planned || 0, 1);
  const pct = (v) => `${Math.max(0, Math.min(100, ((v || 0) / denom) * 100))}%`;

  const drivenDelta = s.driven != null && s.planned != null ? s.driven - s.planned : null;
  const drivenPctDelta = drivenDelta != null && s.planned ? Math.round((drivenDelta / s.planned) * 100) : null;
  const droveMore = (drivenDelta ?? 0) > 0;

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('loadDetail.closeA11y')} />

        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space[5], transform: [{ translateY: dragY }] }]}>
          {/* Grab band. It takes the touch on contact rather than waiting to
              see a drag, because the move-phase negotiation never reaches a
              view that let the touch-down pass — the sheet sat dead until this
              claimed on start. That's also why the band stops here instead of
              wrapping the header: anything inside it can no longer be tapped,
              and the close button has to stay tappable.
              collapsable={false}: a View carrying nothing but responder props
              is what Android's view flattening removes, leaving no native
              target to receive the touch at all. */}
          <View {...pan.panHandlers} collapsable={false} style={styles.handle}>
            <View style={styles.grabber} />
          </View>

          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.route} numberOfLines={2}>{load.origin} → {load.destination}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[fmtDate(load.completedAt, t('common.monthsShort')), brokerName(load), load.id].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: badge.fill, borderColor: badge.solid + '55' }]}>
              <Text style={[styles.pillText, { color: badge.solid }]}>{cancelled ? t('common.cancelled') : t('earnings.delivered')}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('loadDetail.close')}>
              <Icon name="x" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space[3], paddingTop: space[2] }}>

            {cancelled ? (
              <View style={[styles.note, { borderColor: colors.dangerFill }]}>
                <Icon name="x-circle" size={16} color={colors.danger} />
                <Text style={styles.noteText}>{load.cancellationReason || t('loadDetail.cancelledNote')}</Text>
              </View>
            ) : s.hasActual ? (
              <>
                {/* ── Planned vs Driven ── */}
                <View style={styles.panel}>
                  <View style={styles.panelHead}>
                    <Text style={styles.panelLabel}>{t('loadDetail.plannedVsDriven')}</Text>
                    {drivenDelta != null ? (
                      <View style={[styles.delta, { backgroundColor: droveMore ? colors.cautionFill : 'rgba(167,180,200,0.12)' }]}>
                        <Text style={[styles.deltaText, { color: droveMore ? colors.caution : colors.textSecondary }]}>
                          {signedNum(toDistance(drivenDelta, unit))} {unit}{drivenPctDelta != null ? ` · ${drivenPctDelta >= 0 ? '+' : ''}${drivenPctDelta}%` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.seg, { width: pct(s.loaded), backgroundColor: colors.teal }]} />
                    <View style={[styles.seg, { width: pct(s.deadhead), backgroundColor: colors.caution }]} />
                    {/* No quote, no marker — a bar at 0% would read as "planned zero". */}
                    {s.planned != null ? (
                      <View style={[styles.marker, { left: pct(s.planned), backgroundColor: colors.textPrimary }]} />
                    ) : null}
                  </View>
                  <View style={styles.legend}>
                    <Legend styles={styles} color={colors.teal} label={t(unit === 'km' ? 'loadDetail.loadedKm' : 'loadDetail.loadedMi', { n: distNum(s.loaded, unit) })} />
                    <Legend styles={styles} color={colors.caution} label={t(unit === 'km' ? 'loadDetail.deadheadKm' : 'loadDetail.deadheadMi', { n: distNum(s.deadhead, unit) })} />
                    {s.planned != null ? (
                      <Legend styles={styles} dashed label={t(unit === 'km' ? 'loadDetail.plannedKm' : 'loadDetail.plannedMi', { n: distNum(s.planned, unit) })} colors={colors} />
                    ) : null}
                  </View>
                </View>

                {/* ── Stat grid ── */}
                <View style={styles.grid}>
                  <Tile styles={styles} label={t('loadDetail.planned')}
                    value={s.planned == null ? '—' : distNum(s.planned, unit)}
                    unit={s.planned == null ? '' : unit}
                    sub={s.planned == null ? t('loadDetail.noQuote') : t('loadDetail.brokerBooked')} />
                  <Tile styles={styles} label={t('loadDetail.loaded')} value={distNum(s.loaded, unit)} unit={unit} valueColor={colors.tealBright}
                    sub={s.loadedDelta != null ? t('loadDetail.vsPlanned', { delta: signedNum(toDistance(s.loadedDelta, unit)) }) : t('loadDetail.underFreight')}
                    subColor={s.loadedDelta > 0 ? colors.caution : colors.textSecondary} />
                  <Tile styles={styles} label={t('loadDetail.deadhead')} value={distNum(s.deadhead, unit)} unit={unit} valueColor={colors.caution} sub={t('loadDetail.emptyToPickup')} />
                  <Tile styles={styles} label={t('loadDetail.totalDriven')} value={distNum(s.driven, unit)} unit={unit} sub={t('loadDetail.gpsOdometer')} />
                </View>
              </>
            ) : (
              <View style={[styles.note, { borderColor: colors.border }]}>
                <Icon name="navigation" size={16} color={colors.textMuted} />
                <Text style={styles.noteText}>
                  {/* A null planned figure means nobody quoted a mileage, which
                      is not the same as quoting zero — and distNum(null) prints
                      "0", so this must not go through the {planned} string. */}
                  {s.planned == null
                    ? t('loadDetail.noQuoteNoGps')
                    : t(unit === 'km' ? 'loadDetail.noGpsYetKm' : 'loadDetail.noGpsYetMi', { planned: distNum(s.planned, unit) })}
                </Text>
              </View>
            )}

            {/* ── Pay ── */}
            {!cancelled ? (
              <View style={styles.panel}>
                <View style={styles.payRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tileLabel}>{t('loadDetail.loadRate')}</Text>
                    <Text style={[styles.payMain, { color: colors.go }]}>{money(s.rate)}</Text>
                  </View>
                  <View style={styles.rpmPair}>
                    <View style={styles.rpm}>
                      <Text style={styles.rpmLabel}>{t(unit === 'km' ? 'loadDetail.bookedPerKm' : 'loadDetail.bookedPerMi')}</Text>
                      <Text style={styles.rpmVal}>${distRpm(s.bookedRpm, unit)}</Text>
                      <Text style={styles.rpmSub}>{t('loadDetail.rateDivPlanned')}</Text>
                    </View>
                    {s.hasActual ? (
                      <View style={[styles.rpm, styles.rpmEff]}>
                        <Text style={styles.rpmLabel}>{t(unit === 'km' ? 'loadDetail.effectivePerKm' : 'loadDetail.effectivePerMi')}</Text>
                        <Text style={[styles.rpmVal, { color: colors.tealBright }]}>${distRpm(s.effectiveRpm, unit)}</Text>
                        <Text style={styles.rpmSub}>{s.rpmDelta != null ? t('loadDetail.deltaDivDriven', { delta: signedRpm(toRatePerDistance(s.rpmDelta, unit)) }) : t('loadDetail.divDriven')}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {s.hasActual && s.effectiveRpm != null ? (
                  <Text style={styles.earned}>
                    {t(unit === 'km' ? 'loadDetail.earnedSentenceKm' : 'loadDetail.earnedSentenceMi', {
                      rpm: `$${distRpm(s.effectiveRpm, unit)}`,
                      deadhead: distNum(s.deadhead, unit),
                      booked: `$${distRpm(s.bookedRpm, unit)}`,
                    })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* ── Load facts ── */}
            <View style={styles.facts}>
              {load.equipment ? <Chip styles={styles} label={load.equipment} /> : null}
              {load.commodity ? <Chip styles={styles} label={load.commodity} /> : null}
              {load.weight ? <Chip styles={styles} label={`${num(load.weight)} lb`} /> : null}
            </View>

            {/* ── Proof of delivery ──
                A horizontal strip of PORTRAIT tiles, not a row of four squat
                landscape ones. Paperwork is photographed portrait, and the old
                58px-tall full-width-flex tile cropped a bill of lading down to a
                horizontal band through its middle — unrecognisable as a
                document. 3:4 tiles crop almost nothing.

                It also scrolls instead of slicing to 4: the previous version
                dropped any extra photos silently, with no "+N" to say so. */}
            {photos.length > 0 ? (
              <View>
                <Text style={styles.secLabel}>{t('loadDetail.proofOfDelivery')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pods}
                >
                  {photos.map((p, i) => (
                    <Pressable
                      key={p.id ?? i}
                      onPress={() => onOpenPhoto?.(i)}
                      style={({ pressed }) => [styles.pod, { opacity: pressed ? 0.8 : 1 }]}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={p.caption || t('earnings.loadPhotoA11y')}
                    >
                      <Image
                        source={{ uri: p.thumbnailUrl || p.url }}
                        style={styles.podImg}
                        resizeMode="cover"
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Legend({ styles, color, label, dashed, colors }) {
  return (
    <View style={styles.legendItem}>
      {dashed ? (
        <View style={[styles.legendDash, { borderColor: colors.textSecondary }]} />
      ) : (
        <View style={[styles.legendSw, { backgroundColor: color }]} />
      )}
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Tile({ styles, label, value, unit, sub, valueColor, subColor }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileVal, valueColor ? { color: valueColor } : null]}>
        {value}{unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
      {sub ? <Text style={[styles.tileSub, subColor ? { color: subColor } : null]}>{sub}</Text> : null}
    </View>
  );
}

function Chip({ styles, label }) {
  return <Text style={styles.chip}>{label}</Text>;
}

const makeStyles = (c) => StyleSheet.create({
  // The dim is its own layer, not the overlay's background, so it can fade
  // with the drag while the overlay stays the (transparent) flex container.
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.surface, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
    paddingHorizontal: space[5], paddingTop: space[2], maxHeight: '92%',
    borderTopWidth: 1, borderColor: c.border,
  },
  // The band is what the thumb actually has to hit, so it's padded out to a
  // real target rather than the 5px the grabber itself occupies, and pulled up
  // into the sheet's top padding so there's no dead strip above it to miss into.
  handle: { marginTop: -space[2], paddingTop: space[3], paddingBottom: space[2] },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, alignSelf: 'center' },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  route: { ...type.title, color: c.textPrimary },
  meta: { ...type.caption, color: c.textMuted, marginTop: 5, fontVariant: ['tabular-nums'] },
  pill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  close: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: -4, marginRight: -6 },

  note: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', backgroundColor: c.surface2, borderWidth: 1, borderRadius: radius.lg, padding: space[4] },
  noteText: { ...type.caption, color: c.textSecondary, flex: 1, lineHeight: 20 },

  panel: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, padding: space[4] },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[4] },
  panelLabel: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted },
  delta: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  deltaText: { fontSize: 11, fontFamily: FONT.bold, fontVariant: ['tabular-nums'] },

  track: { height: 16, borderRadius: 999, backgroundColor: c.surfaceHi, flexDirection: 'row', overflow: 'hidden', position: 'relative' },
  seg: { height: '100%' },
  marker: { position: 'absolute', top: -4, bottom: -4, width: 2, opacity: 0.85, borderRadius: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[5] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendSw: { width: 11, height: 11, borderRadius: 3 },
  legendDash: { width: 0, height: 13, borderLeftWidth: 2, borderStyle: 'dashed' },
  legendText: { ...type.caption, color: c.textSecondary, fontFamily: FONT.semibold },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tile: { width: '48.5%', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space[3] },
  tileLabel: { fontSize: 10.5, fontFamily: FONT.bold, letterSpacing: 0.6, textTransform: 'uppercase', color: c.textMuted },
  tileVal: { fontSize: 24, fontFamily: FONT.black, letterSpacing: -0.5, color: c.textPrimary, marginTop: space[2], fontVariant: ['tabular-nums'] },
  tileUnit: { fontSize: 13, fontFamily: FONT.bold, color: c.textSecondary },
  tileSub: { fontSize: 11.5, fontFamily: FONT.semibold, color: c.textSecondary, marginTop: 3 },

  payRow: { flexDirection: 'row', gap: space[3], alignItems: 'stretch' },
  payMain: { fontSize: 30, fontFamily: FONT.black, letterSpacing: -0.6, marginTop: space[1], fontVariant: ['tabular-nums'] },
  rpmPair: { flexDirection: 'row', gap: space[2], flex: 1.7 },
  rpm: { flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: space[3] },
  rpmEff: { borderColor: 'rgba(31,182,206,0.35)', backgroundColor: c.tealFill },
  rpmLabel: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.5, textTransform: 'uppercase', color: c.textMuted },
  rpmVal: { fontSize: 21, fontFamily: FONT.black, letterSpacing: -0.4, color: c.textPrimary, marginTop: 6, fontVariant: ['tabular-nums'] },
  rpmSub: { fontSize: 11, fontFamily: FONT.bold, color: c.textSecondary, marginTop: 2, fontVariant: ['tabular-nums'] },
  earned: { ...type.caption, color: c.textSecondary, lineHeight: 20, marginTop: space[3] },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { fontSize: 11.5, fontFamily: FONT.semibold, color: c.textSecondary, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, overflow: 'hidden' },

  secLabel: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.9, textTransform: 'uppercase', color: c.textMuted, marginBottom: space[2] },
  pods: { flexDirection: 'row', gap: space[2], paddingRight: space[2] },
  // Portrait, because paperwork is. Fixed width + aspectRatio rather than a
  // fixed height, so the tile shape is the same on every screen size.
  pod: {
    width: 84, aspectRatio: 3 / 4, borderRadius: 12,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
    backgroundColor: c.surface2,
  },
  podImg: { width: '100%', height: '100%' },
});
