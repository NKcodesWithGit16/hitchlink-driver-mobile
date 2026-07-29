import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Image, Pressable, TextInput, PanResponder,
  StyleSheet, useWindowDimensions, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Line, Polygon, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import * as LegacyFS from 'expo-file-system/legacy';
import Icon from '../ui/Icon';
import { useT } from '../../i18n/LanguageContext';
import haptics from '../../lib/haptics';
import { space, type, radius, FONT } from '../../theme/tokens';

// Photo markup: draw on a delivery photo before sending it.
//
// This exists for damage claims. A driver circling the dented corner or
// arrowing an unreadable BOL number communicates more than a paragraph of text,
// and the dispatcher gets something that stands up in a claim.
//
// The photo is rendered INSIDE the <Svg> (as an SVG <Image>) rather than behind
// it, so `svg.toDataURL()` rasterizes the photo and the strokes together in one
// pass. This replaced react-native-view-shot, which is the obvious tool for the
// job but whose native module would not register under the New Architecture in
// this app ('RNViewShot' could not be found) — and going through SVG turns out
// to be better anyway: one fewer native dependency, and because toDataURL takes
// an output size, the export is rasterized at the photo's own resolution rather
// than at whatever size it happened to be displayed.
//
// Freehand uses a PanResponder collecting points into a path — the same gesture
// idiom as PhotoViewer, so there's one way of doing this in the app.

const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#FFFFFF'];
const WIDTHS = [3, 6, 10];
const ARROW_HEAD = 16;
// Matches normalizePhoto's own ceiling — exporting bigger just gets downscaled
// again on upload.
const MAX_EXPORT_EDGE = 2560;

const TOOLS = { PEN: 'pen', ARROW: 'arrow', TEXT: 'text' };

export default function PhotoMarkup({ uri, onCancel, onDone }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [shapes, setShapes] = useState([]);       // committed marks
  const [draft, setDraft] = useState(null);       // the mark being drawn
  const [textDraft, setTextDraft] = useState(null); // { x, y, value }
  const [saving, setSaving] = useState(false);

  const svgRef = useRef(null);
  // Mirrors `tool`/`color`/`strokeWidth` for the PanResponder, which is built
  // once and would otherwise capture the values from its first render.
  const opts = useRef({ tool, color, strokeWidth });
  opts.current = { tool, color, strokeWidth };

  const canvasHeight = height - insets.top - insets.bottom - TOOLBAR_H - ACTIONS_H;

  // The photo's natural size, so the export can be rasterized at full quality
  // instead of at the size it happens to be shown. Capped to match the upload
  // path's own ceiling (normalizePhoto downscales past 2560 anyway).
  const [natural, setNatural] = useState(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    Image.getSize(uri, (w, h) => { if (alive && w > 0 && h > 0) setNatural({ width: w, height: h }); }, () => {});
    return () => { alive = false; };
  }, [uri]);

  const exportSize = useMemo(() => {
    const ratio = canvasHeight > 0 ? width / canvasHeight : 1;
    const longEdge = Math.min(MAX_EXPORT_EDGE, Math.max(natural?.width || 0, natural?.height || 0) || 0);
    if (!longEdge) return { width: Math.round(width), height: Math.round(canvasHeight) };
    // The canvas aspect drives the output, not the photo's — the SVG viewBox is
    // the canvas, and `contain` letterboxing is part of what gets exported.
    return ratio >= 1
      ? { width: Math.round(longEdge), height: Math.round(longEdge / ratio) }
      : { width: Math.round(longEdge * ratio), height: Math.round(longEdge) };
  }, [natural, width, canvasHeight]);

  const commit = useCallback((shape) => {
    if (shape) setShapes((prev) => [...prev, shape]);
    setDraft(null);
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      const { tool: tl, color: c, strokeWidth: w } = opts.current;
      if (tl === TOOLS.TEXT) { setTextDraft({ x, y, value: '' }); return; }
      setDraft(tl === TOOLS.PEN
        ? { kind: TOOLS.PEN, color: c, width: w, d: `M${x.toFixed(1)},${y.toFixed(1)}` }
        : { kind: TOOLS.ARROW, color: c, width: w, x1: x, y1: y, x2: x, y2: y });
    },

    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      setDraft((d) => {
        if (!d) return d;
        if (d.kind === TOOLS.PEN) return { ...d, d: `${d.d} L${x.toFixed(1)},${y.toFixed(1)}` };
        return { ...d, x2: x, y2: y };
      });
    },

    onPanResponderRelease: () => {
      setDraft((d) => {
        // A tap with no drag leaves a dot or a zero-length arrow — drop it
        // rather than littering the photo with accidental marks.
        if (d?.kind === TOOLS.ARROW && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 12) return null;
        if (d) commit(d);
        return null;
      });
      haptics.tap();
    },

    onPanResponderTerminationRequest: () => false,
  }), [commit]);

  const undo = useCallback(() => {
    setShapes((prev) => prev.slice(0, -1));
    haptics.tap();
  }, []);

  const clear = useCallback(() => {
    setShapes([]);
    setTextDraft(null);
  }, []);

  const commitText = useCallback(() => {
    setTextDraft((d) => {
      const value = (d?.value || '').trim();
      if (value) {
        setShapes((prev) => [...prev, {
          kind: TOOLS.TEXT, color: opts.current.color, x: d.x, y: d.y, value,
          size: Math.max(18, opts.current.strokeWidth * 3.5),
        }]);
      }
      return null;
    });
  }, []);

  const done = useCallback(async () => {
    if (saving) return;
    if (shapes.length === 0) { onCancel?.(); return; }
    setSaving(true);
    try {
      // toDataURL is callback-based and can hand back an empty result if the
      // layer isn't ready; promisify it so a miss becomes a real rejection
      // rather than a send that silently never happens.
      const base64 = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('toDataURL timed out')), 10000);
        svgRef.current?.toDataURL((data) => {
          clearTimeout(timer);
          if (data) resolve(data); else reject(new Error('toDataURL returned nothing'));
        }, exportSize);
      });

      // PNG, because that's what react-native-svg rasterizes to. The upload
      // path transcodes and downscales it (normalizePhoto), so it doesn't need
      // to be JPEG here.
      const dest = `${LegacyFS.cacheDirectory}markup-${Date.now()}.png`;
      await LegacyFS.writeAsStringAsync(dest, base64, { encoding: LegacyFS.EncodingType.Base64 });
      haptics.success();
      onDone?.(dest);
    } catch (err) {
      console.error('[Markup] Export failed:', err);
      haptics.error();
      Alert.alert(t('messages.markupFailedTitle'), t('messages.markupFailedBody'));
      setSaving(false);
    }
  }, [saving, shapes.length, exportSize, onDone, onCancel, t]);

  const all = draft ? [...shapes, draft] : shapes;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* The photo lives INSIDE the Svg, not behind it, so toDataURL exports
            the picture and the marks together. Only this subtree is exported —
            the toolbars are outside it and can never end up in the image. */}
        <View style={[styles.canvas, { height: canvasHeight }]}>
          <Svg
            ref={svgRef}
            style={StyleSheet.absoluteFill}
            width={width}
            height={canvasHeight}
            viewBox={`0 0 ${width} ${canvasHeight}`}
          >
            <SvgImage
              href={{ uri }}
              x="0"
              y="0"
              width={width}
              height={canvasHeight}
              preserveAspectRatio="xMidYMid meet"
            />
            {all.map((s, i) => <Mark key={i} shape={s} />)}
          </Svg>
          <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />

          {textDraft ? (
            <View style={[styles.textEntry, { top: Math.max(0, textDraft.y - 20), left: space[3], right: space[3] }]}>
              <TextInput
                value={textDraft.value}
                onChangeText={(v) => setTextDraft((d) => (d ? { ...d, value: v } : d))}
                placeholder={t('messages.markupTextPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.5)"
                style={[styles.textInput, { color }]}
                autoFocus
                onSubmitEditing={commitText}
                onBlur={commitText}
                returnKeyType="done"
              />
            </View>
          ) : null}
        </View>

        {/* Tools */}
        <View style={styles.toolbar}>
          <ToolButton icon="edit-2" active={tool === TOOLS.PEN} onPress={() => setTool(TOOLS.PEN)} label={t('messages.markupPen')} />
          <ToolButton icon="arrow-up-right" active={tool === TOOLS.ARROW} onPress={() => setTool(TOOLS.ARROW)} label={t('messages.markupArrow')} />
          <ToolButton icon="type" active={tool === TOOLS.TEXT} onPress={() => setTool(TOOLS.TEXT)} label={t('messages.markupText')} />
          <View style={styles.divider} />
          {COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
              accessibilityRole="button"
              accessibilityLabel={t('messages.markupColorA11y')}
            />
          ))}
          <View style={styles.divider} />
          {WIDTHS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setStrokeWidth(w)}
              style={styles.widthBtn}
              accessibilityRole="button"
              accessibilityLabel={t('messages.markupWidthA11y')}
            >
              <View style={{ width: w * 2.2, height: w, borderRadius: w, backgroundColor: strokeWidth === w ? '#FFFFFF' : 'rgba(255,255,255,0.45)' }} />
            </Pressable>
          ))}
        </View>

        {/* Actions */}
        <View style={[styles.actions, { paddingBottom: insets.bottom + space[2] }]}>
          <Pressable onPress={onCancel} hitSlop={8} style={styles.actionBtn} accessibilityRole="button">
            <Text style={styles.actionText}>{t('common.cancel')}</Text>
          </Pressable>
          <View style={styles.actionSpacer}>
            <Pressable onPress={undo} disabled={shapes.length === 0} hitSlop={8} style={[styles.iconAction, shapes.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel={t('messages.markupUndo')}>
              <Icon name="corner-up-left" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={clear} disabled={shapes.length === 0} hitSlop={8} style={[styles.iconAction, shapes.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel={t('messages.markupClear')}>
              <Icon name="trash-2" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <Pressable onPress={done} disabled={saving} style={[styles.sendBtn, saving && styles.disabled]} accessibilityRole="button">
            {saving
              ? <ActivityIndicator size="small" color="#0A0E14" />
              : <Text style={styles.sendText}>{t('common.send')}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Mark({ shape }) {
  if (shape.kind === TOOLS.PEN) {
    return (
      <Path
        d={shape.d}
        stroke={shape.color}
        strokeWidth={shape.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  }

  if (shape.kind === TOOLS.ARROW) {
    const { x1, y1, x2, y2, color, width } = shape;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = ARROW_HEAD + width * 1.2;
    // Two barbs rotated off the shaft angle, as a filled triangle.
    const left = [x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7)];
    const right = [x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7)];
    return (
      <>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeLinecap="round" />
        <Polygon points={`${x2},${y2} ${left[0]},${left[1]} ${right[0]},${right[1]}`} fill={color} />
      </>
    );
  }

  return (
    <SvgText
      x={shape.x}
      y={shape.y}
      fill={shape.color}
      fontSize={shape.size}
      fontWeight="bold"
      stroke="rgba(0,0,0,0.55)"
      strokeWidth={1}
    >
      {shape.value}
    </SvgText>
  );
}

function ToolButton({ icon, active, onPress, label }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.toolBtn, active && styles.toolBtnActive]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Icon name={icon} size={19} color="#FFFFFF" />
    </Pressable>
  );
}

const TOOLBAR_H = 56;
const ACTIONS_H = 64;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  canvas: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },

  toolbar: {
    height: TOOLBAR_H,
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingHorizontal: space[3],
    backgroundColor: '#0A0E14',
  },
  toolBtn: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  toolBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  divider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.18)', marginHorizontal: 2 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: '#FFFFFF' },
  widthBtn: { width: 26, height: 30, alignItems: 'center', justifyContent: 'center' },

  actions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingTop: space[2],
    backgroundColor: '#0A0E14',
  },
  actionSpacer: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actionBtn: { paddingVertical: 8 },
  actionText: { color: '#FFFFFF', ...type.body },
  iconAction: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  sendBtn: {
    paddingHorizontal: space[4], paddingVertical: 10, borderRadius: radius.xl,
    backgroundColor: '#FFFFFF', minWidth: 84, alignItems: 'center',
  },
  sendText: { color: '#0A0E14', fontFamily: FONT.semibold, fontSize: 15 },

  textEntry: { position: 'absolute' },
  textInput: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.md,
    paddingHorizontal: space[3], paddingVertical: 8,
    fontSize: 20, fontFamily: FONT.bold,
  },
});
