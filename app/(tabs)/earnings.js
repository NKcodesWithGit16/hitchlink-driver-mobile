import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import CountUp from '../../src/components/ui/CountUp';
import FadeInView from '../../src/components/ui/FadeInView';
import Skeleton from '../../src/components/ui/Skeleton';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { fetchEarnings } from '../../src/api/main';
import { money, num, rpm } from '../../src/lib/format';
import { space, type, radius, FONT, shadow } from '../../src/theme/tokens';

const CHART_H = 108;

export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { userId } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData]   = useState(null);
  const [range, setRange] = useState('week');
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetchEarnings(userId);
      setData(res);
      setError(false);
    } catch {
      // Don't leave the skeleton spinning forever — surface a retry instead.
      setError(true);
    }
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const d = data?.[range];
  const delta = useMemo(() => (d ? Math.round(((d.net - d.prevNet) / d.prevNet) * 100) : 0), [d]);
  const wfTotal = d ? d.net + d.fuelCost + d.deductions : 1;
  const netPct  = d ? d.net        / wfTotal : 0;
  const fuelPct = d ? d.fuelCost   / wfTotal : 0;
  const dedPct  = d ? d.deductions / wfTotal : 0;
  const bestBar = d ? d.bars.reduce((a, b) => (b.v > a.v ? b : a), d.bars[0]) : null;
  const avgLoad = d ? Math.round(d.net / d.loads) : 0;
  const dpm     = d ? d.net / d.miles : 0;

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Gradient Hero ── */}
      <LinearGradient colors={colors.gradients.brand} start={{ x: 0.1, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.heroLabel}>{range === 'week' ? 'THIS WEEK' : 'THIS MONTH'}</Text>
            <Text style={styles.heroSub}>Take-home pay</Text>
          </View>
          <Segmented value={range} onChange={setRange} colors={colors} styles={styles} />
        </View>

        {d ? (
          <>
            <View style={styles.heroFigRow}>
              <CountUp value={d.net} duration={1100} format={money} style={styles.heroValue} />
              <View style={[styles.deltaBadge, { backgroundColor: delta >= 0 ? colors.goFill : colors.dangerFill, borderColor: delta >= 0 ? colors.go : colors.danger }]}>
                <Icon name={delta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={delta >= 0 ? colors.go : colors.danger} />
                <Text style={[styles.deltaText, { color: delta >= 0 ? colors.go : colors.danger }]}>
                  {delta >= 0 ? '+' : ''}{delta}%
                </Text>
              </View>
            </View>
            <Text style={styles.heroCompare}>vs {money(d.prevNet)} last {range}</Text>
            <AnimatedChart bars={d.bars} colors={colors} styles={styles} range={range} />
          </>
        ) : error ? (
          <View style={{ marginTop: space[3], gap: 4 }}>
            <Text style={styles.heroValue}>—</Text>
            <Text style={styles.heroCompare}>Pay data unavailable right now</Text>
          </View>
        ) : (
          <View style={{ marginTop: space[3], gap: space[3] }}>
            <Skeleton width={210} height={52} radius={radius.md} style={{ backgroundColor: 'rgba(255,255,255,0.20)' }} />
            <Skeleton width={150} height={14} radius={radius.sm} style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
            <Skeleton width="100%" height={CHART_H} radius={radius.md} style={{ marginTop: space[2], backgroundColor: 'rgba(255,255,255,0.10)' }} />
          </View>
        )}
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingBottom: 120, gap: space[4] }}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: colors.bg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {d ? (
          <>
            {/* ── Insights strip ── */}
            <FadeInView delay={80}>
              <View style={styles.insightRow}>
                <InsightChip icon="zap"       label="Best day"   value={bestBar ? money(bestBar.v) : '—'} sub={bestBar?.d} colors={colors} styles={styles} />
                <InsightChip icon="package"   label="Avg / load" value={money(avgLoad)}                   colors={colors} styles={styles} />
                <InsightChip icon="dollar-sign" label="Per mile"  value={`$${rpm(dpm)}`}                  colors={colors} styles={styles} />
              </View>
            </FadeInView>

            {/* ── Stats grid ── */}
            <FadeInView delay={140}>
              <View style={styles.grid}>
                <StatCard icon="navigation"  label="Miles driven"    value={num(d.miles)}    accent={colors.teal}    colors={colors} styles={styles} />
                <StatCard icon="repeat"      label="Loads completed" value={String(d.loads)} accent={colors.teal}    colors={colors} styles={styles} />
              </View>
            </FadeInView>
            <FadeInView delay={180}>
              <View style={styles.grid}>
                <StatCard icon="trending-up" label="Revenue / mile"  value={`$${rpm(d.net / d.miles)}`}   accent={colors.go}      colors={colors} styles={styles} />
                <StatCard icon="droplet"     label="Fuel used"       value={`${num(d.fuelGal)} gal`}  sub={money(d.fuelCost)} accent={colors.caution} colors={colors} styles={styles} />
              </View>
            </FadeInView>

            {/* ── Pay breakdown ── */}
            <FadeInView delay={220}>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Pay breakdown</Text>

                {/* Stacked waterfall bar */}
                <View style={styles.waterfallWrap}>
                  <View style={[styles.waterfallSegment, { flex: netPct,  backgroundColor: colors.go,      borderTopLeftRadius: radius.sm, borderBottomLeftRadius: radius.sm }]} />
                  <View style={[styles.waterfallSegment, { flex: fuelPct, backgroundColor: colors.caution }]} />
                  <View style={[styles.waterfallSegment, { flex: dedPct,  backgroundColor: colors.danger,  borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm }]} />
                </View>
                <View style={styles.waterfallLegend}>
                  <LegendDot color={colors.go}      label={`Net ${Math.round(netPct * 100)}%`}  colors={colors} styles={styles} />
                  <LegendDot color={colors.caution}  label={`Fuel ${Math.round(fuelPct * 100)}%`} colors={colors} styles={styles} />
                  <LegendDot color={colors.danger}   label={`Deduct ${Math.round(dedPct * 100)}%`} colors={colors} styles={styles} />
                </View>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                <BreakdownRow label="Gross earnings" value={money(d.gross)} colors={colors} styles={styles} />
                <BreakdownRow label="Fuel (estimated)" value={`− ${money(d.fuelCost)}`} tone="caution" colors={colors} styles={styles} />
                <BreakdownRow label="Deductions & fees" value={`− ${money(d.deductions)}`} tone="danger" colors={colors} styles={styles} />
                <View style={[styles.divider, { backgroundColor: colors.border, marginVertical: space[1] }]} />
                <BreakdownRow label="Take-home" value={money(d.net)} strong tone="go" colors={colors} styles={styles} />
              </View>
            </FadeInView>

            {/* ── Recent loads ── */}
            <FadeInView delay={280}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary, marginBottom: 2 }]}>Recent loads</Text>
            </FadeInView>
            {data.loads.map((l, i) => (
              <FadeInView key={l.id} delay={320 + i * 60}>
                <LoadCard
                  load={l}
                  expanded={expanded === l.id}
                  onToggle={() => setExpanded(p => p === l.id ? null : l.id)}
                  colors={colors}
                  styles={styles}
                />
              </FadeInView>
            ))}
          </>
        ) : error ? (
          <View style={styles.errorBox}>
            <View style={[styles.errorIcon, { backgroundColor: colors.cautionFill }]}>
              <Icon name="wifi-off" size={26} color={colors.caution} />
            </View>
            <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>Couldn't load your pay</Text>
            <Text style={[styles.errorSub, { color: colors.textSecondary }]}>Check your signal — your earnings are safe and will load the moment you reconnect.</Text>
            <Pressable
              onPress={onRefresh}
              style={[styles.retryBtn, { borderColor: colors.teal }]}
              accessibilityRole="button"
              accessibilityLabel="Try loading earnings again"
            >
              <Icon name="refresh-cw" size={15} color={colors.teal} />
              <Text style={[styles.retryText, { color: colors.teal }]}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <EarningsBodySkeleton colors={colors} styles={styles} />
        )}
      </ScrollView>
    </ScreenFade>
  );
}

/* ─────────── Sub-components ─────────── */

function EarningsBodySkeleton({ colors, styles }) {
  const surf = { backgroundColor: colors.surface, borderColor: colors.border };
  return (
    <>
      <View style={styles.insightRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.chip, surf]}>
            <Skeleton width={30} height={30} radius={999} />
            <Skeleton width={46} height={9} style={{ marginTop: 6 }} />
            <Skeleton width={38} height={14} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>
      {[0, 1].map((row) => (
        <View key={row} style={styles.grid}>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.statCard, surf]}>
              <Skeleton width={34} height={34} radius={radius.md} />
              <Skeleton width={72} height={20} style={{ marginTop: 10 }} />
              <Skeleton width={92} height={11} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>
      ))}
      <View style={[styles.card, surf]}>
        <Skeleton width={120} height={15} />
        <Skeleton width="100%" height={12} radius={radius.sm} style={{ marginTop: 4 }} />
        <Skeleton width="100%" height={16} style={{ marginTop: 10 }} />
        <Skeleton width="100%" height={16} />
        <Skeleton width="100%" height={16} />
      </View>
    </>
  );
}

function Segmented({ value, onChange, colors, styles }) {
  return (
    <View style={styles.segment}>
      {['week', 'month'].map((k) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          style={[styles.segBtn, value === k && styles.segActive]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ selected: value === k }}
          accessibilityLabel={k === 'week' ? 'Show this week' : 'Show this month'}
        >
          <Text style={[styles.segText, value === k && styles.segTextActive]}>{k === 'week' ? 'Week' : 'Month'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AnimatedChart({ bars, colors, styles, range }) {
  const reduce = useReduceMotion();
  const anims = useRef(bars.map(() => new Animated.Value(0))).current;
  const max = Math.max(...bars.map(b => b.v), 1);
  const peakIdx = bars.findIndex(b => b.v === max);

  useEffect(() => {
    const finals = bars.map(b => (b.v > 0 ? b.v / max : 0));
    if (reduce) {
      // Respect OS reduce-motion: snap straight to final heights, no growth.
      anims.forEach((a, i) => a.setValue(finals[i]));
      return;
    }
    anims.forEach(a => a.setValue(0));
    const seq = bars.map((b, i) =>
      Animated.timing(anims[i], {
        toValue: finals[i],
        duration: 520,
        delay: i * 55,
        useNativeDriver: false,
      })
    );
    Animated.parallel(seq).start();
  }, [range, reduce]);

  return (
    <View style={styles.chart}>
      {bars.map((b, i) => {
        const heightAnim = anims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, CHART_H],
        });
        const isPeak = i === peakIdx && b.v > 0;
        return (
          <View key={b.d} style={styles.chartCol}>
            {isPeak ? (
              <Text style={[styles.peakLabel, { color: 'rgba(255,255,255,0.9)' }]}>{money(b.v)}</Text>
            ) : (
              <View style={{ height: 16 }} />
            )}
            <View style={styles.chartTrack}>
              <Animated.View style={[
                styles.chartBar,
                { height: heightAnim, opacity: b.v ? 1 : 0.18 },
              ]} />
            </View>
            <Text style={styles.chartLabel}>{b.d}</Text>
          </View>
        );
      })}
    </View>
  );
}

function InsightChip({ icon, label, value, sub, colors, styles }) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.chipIcon, { backgroundColor: colors.tealFill }]}>
        <Icon name={icon} size={13} color={colors.teal} />
      </View>
      <Text style={[styles.chipLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.chipValue, { color: colors.textPrimary }]}>{value}</Text>
      {sub ? <Text style={[styles.chipSub, { color: colors.textMuted }]}>{sub}</Text> : null}
    </View>
  );
}

function StatCard({ icon, label, value, sub, accent, colors, styles }) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: accent + '22' }]}>
        <Icon name={icon} size={16} color={accent} />
      </View>
      <Text style={[styles.statValue, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      {sub ? <Text style={[styles.statSub, { color: colors.textMuted }]}>{sub}</Text> : null}
    </View>
  );
}

function LegendDot({ color, label, colors, styles }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
      <Text style={[styles.legendText, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function BreakdownRow({ label, value, tone, strong, colors, styles }) {
  const toneColor = tone === 'go' ? colors.go : tone === 'caution' ? colors.caution : tone === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <View style={styles.brRow}>
      <Text style={[styles.brLabel, strong && { color: colors.textPrimary, fontFamily: FONT.black }]}>{label}</Text>
      <Text style={[styles.brValue, { color: strong ? toneColor : tone ? toneColor : colors.textSecondary }, strong && { fontSize: 18, fontFamily: FONT.black }]}>
        {value}
      </Text>
    </View>
  );
}

function LoadCard({ load, expanded, onToggle, colors, styles }) {
  const dpm = load.net / load.miles;
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.loadCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${load.from} to ${load.to}, took home ${money(load.net)}. ${expanded ? 'Tap to hide' : 'Tap to show'} breakdown`}
    >
      {/* green left accent stripe */}
      <View style={[styles.loadStripe, { backgroundColor: colors.go }]} />

      <View style={{ flex: 1 }}>
        <View style={styles.loadTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.loadRoute, { color: colors.textPrimary }]} numberOfLines={1}>
              {load.from} → {load.to}
            </Text>
            <Text style={[styles.loadMeta, { color: colors.textMuted }]}>
              {load.date} · {num(load.miles)} mi · {load.id}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.loadNet, { color: colors.textPrimary }]}>{money(load.net)}</Text>
            <View style={[styles.dpmBadge, { backgroundColor: colors.goFill, borderColor: colors.go + '55' }]}>
              <Text style={[styles.dpmText, { color: colors.go }]}>${rpm(dpm)}/mi</Text>
            </View>
          </View>
        </View>

        {expanded ? (
          <View style={styles.loadExpanded}>
            <View style={[styles.loadDivider, { backgroundColor: colors.border }]} />
            <BreakdownRow label="Gross" value={money(load.gross)} colors={colors} styles={styles} />
            <BreakdownRow label="Deductions" value={`− ${money(load.deductions)}`} tone="danger" colors={colors} styles={styles} />
            <BreakdownRow label="Net pay" value={money(load.net)} tone="go" strong colors={colors} styles={styles} />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 6 }}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },

  /* Hero */
  hero: { paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[5] },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: space[3] },
  heroLabel: { fontSize: 11, fontFamily: FONT.black, color: 'rgba(255,255,255,0.55)', letterSpacing: 1.2 },
  heroSub: { fontSize: 13, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  heroFigRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  heroValue: { fontSize: 52, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -2 },
  heroCompare: { fontSize: 13, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.5)', marginTop: 2, marginBottom: 4 },
  deltaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  deltaText: { fontSize: 13, fontFamily: FONT.black },

  /* Segment (on hero) */
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill, padding: 3 },
  segBtn: { paddingHorizontal: space[3], paddingVertical: 6, borderRadius: radius.pill },
  segActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  segText: { fontSize: 12, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.6)' },
  segTextActive: { color: '#FFFFFF' },

  /* Chart */
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: space[4], paddingBottom: 2 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartTrack: { width: '100%', height: CHART_H, justifyContent: 'flex-end' },
  chartBar: { width: '100%', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 5 },
  chartLabel: { fontSize: 10, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.55)', marginTop: 5 },
  peakLabel: { fontSize: 10, fontFamily: FONT.black, marginBottom: 3, textAlign: 'center' },

  /* Insight strip */
  insightRow: { flexDirection: 'row', gap: space[3] },
  chip: { flex: 1, borderRadius: radius.lg, borderWidth: 1, padding: space[3], alignItems: 'center', gap: 4 },
  chipIcon: { width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  chipLabel: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.3 },
  chipValue: { fontSize: 15, fontFamily: FONT.black, letterSpacing: -0.3 },
  chipSub: { fontSize: 10, fontFamily: FONT.medium },

  /* Stats grid */
  grid: { flexDirection: 'row', gap: space[3] },
  statCard: { flex: 1, borderRadius: radius.lg, borderWidth: 1, padding: space[4], gap: 4 },
  statIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { fontSize: 22, fontFamily: FONT.black, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontFamily: FONT.bold },
  statSub: { fontSize: 11, fontFamily: FONT.medium },

  /* Breakdown card */
  card: { borderRadius: radius.xl, borderWidth: 1, padding: space[5], gap: space[3] },
  sectionTitle: { fontSize: 15, fontFamily: FONT.black, letterSpacing: -0.2 },
  waterfallWrap: { flexDirection: 'row', height: 12, borderRadius: radius.sm, overflow: 'hidden', gap: 2 },
  waterfallSegment: { minWidth: 4 },
  waterfallLegend: { flexDirection: 'row', gap: space[4], flexWrap: 'wrap' },
  legendText: { fontSize: 11, fontFamily: FONT.bold },
  divider: { height: 1, marginVertical: space[1] },
  brRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  brLabel: { ...type.body, color: c.textSecondary },
  brValue: { ...type.bodyStrong },

  /* Load cards */
  loadCard: { flexDirection: 'row', borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', marginBottom: space[2] },
  loadStripe: { width: 4, flexShrink: 0 },
  loadTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], padding: space[4] },
  loadExpanded: { paddingHorizontal: space[4], paddingBottom: space[2], gap: space[2] },
  loadDivider: { height: 1, marginBottom: space[2] },
  loadRoute: { ...type.bodyStrong },
  loadMeta: { ...type.caption, marginTop: 2 },
  loadNet: { fontSize: 18, fontFamily: FONT.black, letterSpacing: -0.3 },
  dpmBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 3 },
  dpmText: { fontSize: 10, fontFamily: FONT.black },

  /* Error / retry */
  errorBox: { alignItems: 'center', justifyContent: 'center', gap: space[3], paddingVertical: space[10], paddingHorizontal: space[4] },
  errorIcon: { width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  errorTitle: { fontSize: 18, fontFamily: FONT.black, textAlign: 'center' },
  errorSub: { ...type.caption, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space[1], paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.pill, borderWidth: 1 },
  retryText: { ...type.bodyStrong, fontSize: 15 },
});
