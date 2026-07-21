// Load history → detail sheet. Opens when the driver taps a past load in the
// Pay tab and shows the full picture: planned (what the broker booked) vs actual
// (what he really drove, from the GPS odometer) — miles, deadhead, and booked
// vs effective $/mi. Degrades gracefully: a load with no recorded trail shows
// planned-only instead of zeros; a cancelled load shows why.
//
// Self-contained and theme-driven — it takes `colors` and builds its own styles,
// like the app's other overlays. `stats` comes from computeLoadStats (lib/loadStats).

import { useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../ui/Icon';
import { money, num, rpm, signedNum } from '../../lib/format';
import { space, radius, type, FONT, toneOf } from '../../theme/tokens';
import { useT } from '../../i18n/LanguageContext';

// Tolerant date label: handles both 'YYYY-MM-DD' (mock) and a full ISO
// timestamp (live /history), never renders a raw string.
function fmtDate(iso, months) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const brokerName = (load) => (typeof load?.broker === 'string' ? load.broker : load?.broker?.name || '');

// Signed rate-per-mile delta, e.g. "−$0.24" — real minus glyph to match figures.
const signedRpm = (n) => (n == null || isNaN(n) ? '' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`);

export default function LoadDetailSheet({ load, stats, colors, onClose, onOpenPhoto }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('loadDetail.closeA11y')} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[5] }]}>
          <View style={styles.grabber} />

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
                          {signedNum(drivenDelta)} mi{drivenPctDelta != null ? ` · ${drivenPctDelta >= 0 ? '+' : ''}${drivenPctDelta}%` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.seg, { width: pct(s.loaded), backgroundColor: colors.teal }]} />
                    <View style={[styles.seg, { width: pct(s.deadhead), backgroundColor: colors.caution }]} />
                    <View style={[styles.marker, { left: pct(s.planned), backgroundColor: colors.textPrimary }]} />
                  </View>
                  <View style={styles.legend}>
                    <Legend styles={styles} color={colors.teal} label={t('loadDetail.loadedMi', { n: num(s.loaded) })} />
                    <Legend styles={styles} color={colors.caution} label={t('loadDetail.deadheadMi', { n: num(s.deadhead) })} />
                    <Legend styles={styles} dashed label={t('loadDetail.plannedMi', { n: num(s.planned) })} colors={colors} />
                  </View>
                </View>

                {/* ── Stat grid ── */}
                <View style={styles.grid}>
                  <Tile styles={styles} label={t('loadDetail.planned')} value={num(s.planned)} unit="mi" sub={t('loadDetail.brokerBooked')} />
                  <Tile styles={styles} label={t('loadDetail.loaded')} value={num(s.loaded)} unit="mi" valueColor={colors.tealBright}
                    sub={s.loadedDelta != null ? t('loadDetail.vsPlanned', { delta: signedNum(s.loadedDelta) }) : t('loadDetail.underFreight')}
                    subColor={s.loadedDelta > 0 ? colors.caution : colors.textSecondary} />
                  <Tile styles={styles} label={t('loadDetail.deadhead')} value={num(s.deadhead)} unit="mi" valueColor={colors.caution} sub={t('loadDetail.emptyToPickup')} />
                  <Tile styles={styles} label={t('loadDetail.totalDriven')} value={num(s.driven)} unit="mi" sub={t('loadDetail.gpsOdometer')} />
                </View>
              </>
            ) : (
              <View style={[styles.note, { borderColor: colors.border }]}>
                <Icon name="navigation" size={16} color={colors.textMuted} />
                <Text style={styles.noteText}>
                  {t('loadDetail.noGpsYet', { planned: num(s.planned) })}
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
                      <Text style={styles.rpmLabel}>{t('loadDetail.bookedPerMi')}</Text>
                      <Text style={styles.rpmVal}>${rpm(s.bookedRpm)}</Text>
                      <Text style={styles.rpmSub}>{t('loadDetail.rateDivPlanned')}</Text>
                    </View>
                    {s.hasActual ? (
                      <View style={[styles.rpm, styles.rpmEff]}>
                        <Text style={styles.rpmLabel}>{t('loadDetail.effectivePerMi')}</Text>
                        <Text style={[styles.rpmVal, { color: colors.tealBright }]}>${rpm(s.effectiveRpm)}</Text>
                        <Text style={styles.rpmSub}>{s.rpmDelta != null ? t('loadDetail.deltaDivDriven', { delta: signedRpm(s.rpmDelta) }) : t('loadDetail.divDriven')}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {s.hasActual && s.effectiveRpm != null ? (
                  <Text style={styles.earned}>
                    {t('loadDetail.earnedSentence', {
                      rpm: `$${rpm(s.effectiveRpm)}`,
                      deadhead: num(s.deadhead),
                      booked: `$${rpm(s.bookedRpm)}`,
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

            {/* ── Proof of delivery ── */}
            {photos.length > 0 ? (
              <View>
                <Text style={styles.secLabel}>{t('loadDetail.proofOfDelivery')}</Text>
                <View style={styles.pods}>
                  {photos.slice(0, 4).map((p, i) => (
                    <Pressable
                      key={p.id ?? i}
                      onPress={() => onOpenPhoto?.(i)}
                      style={({ pressed }) => [styles.pod, { opacity: pressed ? 0.8 : 1 }]}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={p.caption || t('earnings.loadPhotoA11y')}
                    >
                      <Image source={{ uri: p.thumbnailUrl || p.url }} style={styles.podImg} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
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
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.surface, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
    paddingHorizontal: space[5], paddingTop: space[2], maxHeight: '92%',
    borderTopWidth: 1, borderColor: c.border,
  },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, alignSelf: 'center', marginBottom: space[3] },

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
  pods: { flexDirection: 'row', gap: space[2] },
  pod: { flex: 1, height: 58, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  podImg: { width: '100%', height: '100%' },
});
