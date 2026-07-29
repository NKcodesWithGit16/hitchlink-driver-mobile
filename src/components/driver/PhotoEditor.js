import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Image, Pressable, TextInput, PanResponder, Animated,
  StyleSheet, useWindowDimensions, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Line, Polygon, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import * as LegacyFS from 'expo-file-system/legacy';
import CropOverlay from './editor/CropOverlay';
import SizeSlider from './editor/SizeSlider';
import ColorRow, { EDITOR_COLORS } from './editor/ColorRow';
import Icon from '../ui/Icon';
import { useT } from '../../i18n/LanguageContext';
import haptics from '../../lib/haptics';
import {
  fitRect, cropRectToPixels, clampPan, applyAspect, hitTestShape,
} from '../../lib/editorGeom';
import { space, type, radius, FONT } from '../../theme/tokens';

// Photo editor: crop, draw, arrow and text on a photo before sending it.
//
// This exists for damage claims. A driver cropping to the dented corner and
// circling it communicates more than a paragraph, and the dispatcher gets
// something that stands up in a claim.
//
// Mode-first: nothing but four symbols until the driver picks one, then that
// mode's controls appear. With no mode selected the photo is inspectable —
// pinch and pan — so you can look before deciding what to do.
//
// Two decisions shape everything here:
//
// 1. Shapes are stored in the SVG's own viewBox coordinates, never in screen
//    coordinates, because drawing is allowed while zoomed. The gesture layer
//    sits INSIDE the transformed container, so RN reports touches already in
//    that space and no inversion is needed. (editorGeom.screenToBase exists for
//    the case where that stops holding — see its note.)
//
// 2. Crop and rotate BAKE the current marks into the photo: the canvas is
//    flattened with toDataURL, the result is cropped/rotated by
//    expo-image-manipulator, and that becomes the new base image with the shape
//    list emptied. Remapping every stroke through a new letterbox is the
//    alternative and it is all downside. Undo still crosses those steps because
//    editor state is a history stack of { baseUri, shapes }.
//
// The photo is rendered INSIDE the <Svg> as an SVG <Image> so toDataURL
// rasterizes picture and marks in one pass — see the note in CLAUDE.md about
// why this doesn't use react-native-view-shot.
//
// Export resolution is the canvas's, not the photo's. toDataURL takes a
// {width,height} but it sets the output BOUNDS and renders at 1:1 into the
// corner of them — it pads rather than scales — so it cannot be used to
// upscale. Fine for marking damage; an edited copy is lower-resolution than
// its source, and raising that needs an off-screen canvas at the photo's
// natural size with every coordinate scaled to match.

const ARROW_HEAD = 16;
const MAX_ZOOM = 4;
const ERASE_TOLERANCE = 20;

const MODE = { CROP: 'crop', DRAW: 'draw', ARROW: 'arrow', TEXT: 'text' };

// Free first: a damage photo wants whatever shape the damage is.
const ASPECTS = [
  { ratio: null, label: 'messages.editAspectFree' },
  { ratio: 1, label: 'messages.editAspectSquare' },
  { ratio: 4 / 3, label: 'messages.editAspect43' },
  { ratio: 16 / 9, label: 'messages.editAspect169' },
];

const TOPBAR_H = 56;
const BOTTOM_H = 76;

const touchDistance = (touches) => {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

export default function PhotoEditor({ uri, onCancel, onDone }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [mode, setMode] = useState(null);
  const [color, setColor] = useState(EDITOR_COLORS[5]);   // red — the damage-marking colour
  const [strokeWidth, setStrokeWidth] = useState(6);
  const [textSize, setTextSize] = useState(28);
  const [erasing, setErasing] = useState(false);
  const [aspect, setAspect] = useState(0);
  const [baseUri, setBaseUri] = useState(uri);
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);      // [{ baseUri, shapes }]
  const [draft, setDraft] = useState(null);
  const [textDraft, setTextDraft] = useState(null);
  const [cropRect, setCropRect] = useState(null);
  const [natural, setNatural] = useState(null);
  const [busy, setBusy] = useState(null);          // 'crop' | 'rotate' | 'send'

  const svgRef = useRef(null);

  // The contextual row's space is reserved even when empty. Letting the canvas
  // resize as modes change would change the viewBox, and every stored shape is
  // in viewBox units — they'd all shift the moment a tool was picked.
  const canvasHeight = height - insets.top - insets.bottom - TOPBAR_H - BOTTOM_H;

  // ── View transform (idle pinch/pan) ──────────────────────────────────────
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const view = useRef({ scale: 1, translateX: 0, translateY: 0 }).current;

  const resetView = useCallback(() => {
    view.scale = 1; view.translateX = 0; view.translateY = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
    ]).start();
  }, [view, scale, translateX, translateY]);

  // ── Base image dimensions ────────────────────────────────────────────────
  useEffect(() => {
    if (!baseUri) return;
    let alive = true;
    Image.getSize(baseUri, (w, h) => { if (alive && w > 0 && h > 0) setNatural({ width: w, height: h }); }, () => {});
    return () => { alive = false; };
  }, [baseUri]);

  // Where the photo actually sits inside the canvas, so crop handles stay on
  // the picture rather than on the letterbox beside it.
  const imageRect = useMemo(
    () => fitRect(natural?.width, natural?.height, width, canvasHeight),
    [natural, width, canvasHeight],
  );

  // ── History ──────────────────────────────────────────────────────────────
  const pushHistory = useCallback(() => {
    setHistory((h) => [...h, { baseUri, shapes }]);
  }, [baseUri, shapes]);

  const undo = useCallback(() => {
    // A stroke is the common case and is cheaper to undo than a whole state.
    if (shapes.length > 0) { setShapes((s) => s.slice(0, -1)); haptics.tap(); return; }
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setBaseUri(prev.baseUri);
      setShapes(prev.shapes);
      resetView();
      haptics.tap();
      return h.slice(0, -1);
    });
  }, [shapes.length, resetView]);

  const clearAll = useCallback(() => {
    if (shapes.length === 0 && history.length === 0) return;
    if (shapes.length > 0) pushHistory();
    setShapes([]);
    setTextDraft(null);
    haptics.tap();
  }, [shapes.length, history.length, pushHistory]);

  const canUndo = shapes.length > 0 || history.length > 0;

  // ── Drawing / zoom gestures ──────────────────────────────────────────────
  const opts = useRef({ mode, color, strokeWidth, textSize, erasing });
  opts.current = { mode, color, strokeWidth, textSize, erasing };
  const gesture = useRef({ kind: null, startDist: 0, startScale: 1, startX: 0, startY: 0 }).current;

  const commitShape = useCallback((shape) => {
    if (shape) setShapes((prev) => [...prev, shape]);
    setDraft(null);
  }, []);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!opts.current.mode && opts.current.mode !== MODE.CROP,
    onMoveShouldSetPanResponder: (e) => {
      // Two fingers always pinch, whatever the mode — zooming in to draw
      // precisely shouldn't mean leaving the tool.
      if (e.nativeEvent.touches.length === 2) return true;
      const m = opts.current.mode;
      if (m === MODE.CROP) return false;          // the overlay owns the gesture
      if (!m) return true;                        // idle: pan
      return m === MODE.DRAW || m === MODE.ARROW; // tools draw
    },

    onPanResponderGrant: (e) => {
      const touches = e.nativeEvent.touches;
      const { locationX: x, locationY: y } = e.nativeEvent;
      const m = opts.current.mode;

      if (touches.length === 2) {
        gesture.kind = 'pinch';
        gesture.startDist = touchDistance(touches);
        gesture.startScale = view.scale;
        return;
      }
      if (!m) {
        gesture.kind = 'pan';
        gesture.startX = view.translateX;
        gesture.startY = view.translateY;
        return;
      }
      if (m === MODE.TEXT) { gesture.kind = 'text'; setTextDraft({ x, y, value: '' }); return; }

      // Erase is a tap, not a drag: drop the topmost mark under the finger so
      // overlapping strokes come off in the order they were laid down.
      if (opts.current.erasing) {
        gesture.kind = 'erase';
        setShapes((prev) => {
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            if (hitTestShape(prev[i], { x, y }, ERASE_TOLERANCE)) {
              haptics.tap();
              return [...prev.slice(0, i), ...prev.slice(i + 1)];
            }
          }
          return prev;
        });
        return;
      }

      gesture.kind = 'draw';
      const { color: c, strokeWidth: w } = opts.current;
      setDraft(m === MODE.DRAW
        ? { kind: MODE.DRAW, color: c, width: w, d: `M${x.toFixed(1)},${y.toFixed(1)}` }
        : { kind: MODE.ARROW, color: c, width: w, x1: x, y1: y, x2: x, y2: y });
    },

    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;

      if (touches.length === 2) {
        if (gesture.kind !== 'pinch') {
          gesture.kind = 'pinch';
          gesture.startDist = touchDistance(touches);
          gesture.startScale = view.scale;
          setDraft(null);
        }
        const next = Math.min(MAX_ZOOM, Math.max(1, gesture.startScale * (touchDistance(touches) / (gesture.startDist || 1))));
        view.scale = next;
        scale.setValue(next);
        return;
      }

      if (gesture.kind === 'pan') {
        const clamped = clampPan(
          { translateX: gesture.startX + g.dx, translateY: gesture.startY + g.dy },
          view.scale, width, canvasHeight,
        );
        view.translateX = clamped.translateX;
        view.translateY = clamped.translateY;
        translateX.setValue(clamped.translateX);
        translateY.setValue(clamped.translateY);
        return;
      }

      if (gesture.kind === 'draw') {
        const { locationX: x, locationY: y } = e.nativeEvent;
        setDraft((d) => {
          if (!d) return d;
          if (d.kind === MODE.DRAW) return { ...d, d: `${d.d} L${x.toFixed(1)},${y.toFixed(1)}` };
          return { ...d, x2: x, y2: y };
        });
      }
    },

    onPanResponderRelease: () => {
      if (gesture.kind === 'draw') {
        setDraft((d) => {
          // A tap with no drag leaves a dot or a zero-length arrow — drop it
          // rather than littering the photo with accidental marks.
          if (d?.kind === MODE.ARROW && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 12) return null;
          if (d) commitShape(d);
          return null;
        });
        haptics.tap();
      }
      if (gesture.kind === 'pinch' && view.scale <= 1.02) resetView();
      gesture.kind = null;
    },

    onPanResponderTerminationRequest: () => false,
  }), [gesture, view, scale, translateX, translateY, width, canvasHeight, commitShape, resetView]);

  // ── Text ─────────────────────────────────────────────────────────────────
  const commitText = useCallback(() => {
    setTextDraft((d) => {
      const value = (d?.value || '').trim();
      if (value) {
        setShapes((prev) => [...prev, {
          kind: MODE.TEXT, color: opts.current.color, x: d.x, y: d.y, value,
          size: opts.current.textSize,
        }]);
      }
      return null;
    });
  }, []);

  // ── Flatten ──────────────────────────────────────────────────────────────
  /**
   * Rasterizes photo + marks and trims the result to `rect`, defaulting to the
   * photo itself. Shared by crop, rotate and send.
   *
   * The trim is not optional. The SVG canvas is screen-shaped and the photo is
   * `meet`-fitted inside it, so a raw toDataURL comes back in the CANVAS's
   * aspect ratio with transparent letterbox bars around the picture — sending
   * that put a screen-shaped image with bars into the thread. Everything that
   * leaves this screen goes through here.
   *
   * Returns the real output dimensions so the caller can size a bubble without
   * waiting on Image.getSize.
   */
  const flatten = useCallback(async (rect) => {
    // No size argument. toDataURL's {width,height} sets the bitmap's BOUNDS and
    // renders the canvas into the corner of it at 1:1 — it pads, it does not
    // scale. Asking for a bigger image produced exactly that: the photo in the
    // top-left of a mostly blank one. Let it use its own bounds instead.
    const base64 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('toDataURL timed out')), 10000);
      svgRef.current?.toDataURL((data) => {
        clearTimeout(timer);
        if (data) resolve(data); else reject(new Error('toDataURL returned nothing'));
      });
    });
    const raw = `${LegacyFS.cacheDirectory}edit-raw-${Date.now()}.png`;
    await LegacyFS.writeAsStringAsync(raw, base64, { encoding: LegacyFS.EncodingType.Base64 });

    // Measure what actually came back rather than assuming: the rasterizer may
    // work at the device pixel scale, and the crop rect has to be mapped in the
    // same units or it lands somewhere else entirely.
    const measured = await new Promise((resolve) => {
      Image.getSize(raw, (w, h) => resolve({ width: w, height: h }), () => resolve(null));
    });
    const outW = measured?.width || width;
    const outH = measured?.height || canvasHeight;

    const trim = rect || imageRect;
    // Nothing sane to trim to if the image hasn't been measured yet — better a
    // letterboxed export than a failed one.
    if (!(trim?.width > 0 && trim?.height > 0)) {
      return { uri: raw, width: outW, height: outH };
    }

    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
    const px = cropRectToPixels(trim, width, outW, outH);
    const rendered = await ImageManipulator.manipulate(raw).crop(px).renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
    return { uri: out.uri, width: rendered.width, height: rendered.height };
  }, [imageRect, width, canvasHeight]);

  const enterCrop = useCallback(() => {
    resetView();
    // Seed through applyAspect, not clampCropRect: a ratio left locked from a
    // previous crop has to be honoured on the way in, or the first drag would
    // visibly snap the rect.
    setCropRect(applyAspect(imageRect, ASPECTS[aspect].ratio, imageRect, 'br'));
    setMode(MODE.CROP);
  }, [imageRect, aspect, resetView]);

  const applyCrop = useCallback(async () => {
    if (busy || !cropRect) return;
    setBusy('crop');
    try {
      // flatten already crops — pass the user's rect instead of the photo's.
      const out = await flatten(cropRect);

      pushHistory();
      setBaseUri(out.uri);
      setShapes([]);
      setCropRect(null);
      setMode(null);
      resetView();
      haptics.success();
    } catch (err) {
      console.error('[Editor] Crop failed:', err);
      haptics.error();
      Alert.alert(t('messages.editCropFailedTitle'), t('messages.editCropFailedBody'));
    } finally {
      setBusy(null);
    }
  }, [busy, cropRect, flatten, pushHistory, resetView, t]);

  const rotate = useCallback(async () => {
    if (busy) return;
    setBusy('rotate');
    try {
      // Trim to the photo first, or the rotation would spin the letterbox too.
      const flat = await flatten();
      const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
      const rendered = await ImageManipulator.manipulate(flat.uri).rotate(90).renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });

      pushHistory();
      setBaseUri(out.uri);
      setShapes([]);
      setCropRect(null);
      resetView();
      haptics.tap();
    } catch (err) {
      console.error('[Editor] Rotate failed:', err);
      haptics.error();
      Alert.alert(t('messages.editRotateFailedTitle'), t('messages.editCropFailedBody'));
    } finally {
      setBusy(null);
    }
  }, [busy, flatten, pushHistory, resetView, t]);

  // Crop needs the rect re-seeded once the rotated/cropped image is measured.
  useEffect(() => {
    if (mode !== MODE.CROP || !(imageRect.width > 0)) return;
    const { ratio } = ASPECTS[aspect];
    setCropRect((r) => applyAspect(r || imageRect, ratio, imageRect, 'br'));
  }, [mode, imageRect, aspect]);

  const cycleAspect = useCallback(() => {
    setAspect((a) => {
      const next = (a + 1) % ASPECTS.length;
      const { ratio } = ASPECTS[next];
      setCropRect((r) => (r ? applyAspect(r, ratio, imageRect, 'br') : r));
      return next;
    });
    haptics.tap();
  }, [imageRect]);

  // Done commits the mode and returns to idle. Crop is the exception: its work
  // isn't in `shapes`, it's a pending rect, so Done has to apply it.
  const doneMode = useCallback(() => {
    if (textDraft) commitText();
    setErasing(false);
    if (mode === MODE.CROP) { applyCrop(); return; }
    setMode(null);
  }, [mode, textDraft, commitText, applyCrop]);

  // Cancel backs out of the mode without committing anything it left pending.
  // It does not undo marks already committed by an earlier Done — that's undo's
  // job, and losing five good strokes to one stray tap would be worse.
  const cancelMode = useCallback(() => {
    setTextDraft(null);
    setDraft(null);
    setErasing(false);
    setCropRect(null);
    setMode(null);
    resetView();
  }, [resetView]);

  const send = useCallback(async () => {
    if (busy) return;
    const untouched = shapes.length === 0 && history.length === 0 && baseUri === uri;
    if (untouched) { onCancel?.(); return; }
    setBusy('send');
    try {
      // Dimensions travel with it so the chat bubble takes the right shape
      // immediately instead of waiting on Image.getSize.
      const out = await flatten();
      haptics.success();
      onDone?.(out);
    } catch (err) {
      console.error('[Editor] Export failed:', err);
      haptics.error();
      Alert.alert(t('messages.markupFailedTitle'), t('messages.markupFailedBody'));
      setBusy(null);
    }
  }, [busy, shapes.length, history.length, baseUri, uri, flatten, onDone, onCancel, t]);

  const all = draft ? [...shapes, draft] : shapes;
  const inMode = !!mode;
  const drawing = mode === MODE.DRAW || mode === MODE.ARROW;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* Top chrome swaps entirely with the mode: idle offers the tools,
            everything else offers Cancel/Done for that mode only. */}
        <View style={styles.topBar}>
          {inMode ? (
            <>
              <Pressable onPress={cancelMode} hitSlop={10} style={styles.topAction} accessibilityRole="button">
                <Text style={styles.plainAction}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={doneMode} disabled={!!busy} hitSlop={10} style={[styles.topAction, busy && styles.disabled]} accessibilityRole="button">
                <Text style={[styles.plainAction, styles.plainActionStrong]}>{t('common.done')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={onCancel} hitSlop={12} style={styles.topAction} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <Icon name="x" size={26} color="#FFFFFF" />
              </Pressable>
              <View style={styles.toolRow}>
                <ToolIcon icon="edit-2" label={t('messages.markupPen')} onPress={() => setMode(MODE.DRAW)} />
                <ToolIcon icon="arrow-up-right" label={t('messages.markupArrow')} onPress={() => setMode(MODE.ARROW)} />
                <ToolIcon icon="type" label={t('messages.markupText')} onPress={() => setMode(MODE.TEXT)} />
                <ToolIcon icon="crop" label={t('messages.editCrop')} onPress={enterCrop} />
                <ToolIcon icon="corner-up-left" label={t('messages.markupUndo')} onPress={undo} disabled={!canUndo} />
              </View>
            </>
          )}
        </View>

        {/* Canvas */}
        <View style={[styles.canvas, { height: canvasHeight }]}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateX }, { translateY }, { scale }] },
            ]}
          >
            <Svg
              ref={svgRef}
              style={StyleSheet.absoluteFill}
              width={width}
              height={canvasHeight}
              viewBox={`0 0 ${width} ${canvasHeight}`}
            >
              <SvgImage
                href={{ uri: baseUri }}
                x="0"
                y="0"
                width={width}
                height={canvasHeight}
                preserveAspectRatio="xMidYMid meet"
              />
              {all.map((s, i) => <Mark key={i} shape={s} />)}
            </Svg>
            {/* Inside the transform on purpose: RN reports locationX/Y against
                this view's own untransformed bounds, which is exactly the
                viewBox space shapes are stored in. */}
            <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />
          </Animated.View>

          {mode === MODE.CROP && cropRect ? (
            <CropOverlay rect={cropRect} bounds={imageRect} ratio={ASPECTS[aspect].ratio} onChange={setCropRect} />
          ) : null}

          {/* Size control rides on the left edge of the photo, over it. */}
          {drawing || mode === MODE.TEXT ? (
            <SizeSlider
              value={mode === MODE.TEXT ? textSize : strokeWidth}
              min={mode === MODE.TEXT ? 14 : 2}
              max={mode === MODE.TEXT ? 64 : 26}
              height={Math.min(240, canvasHeight - 80)}
              onChange={mode === MODE.TEXT ? setTextSize : setStrokeWidth}
              style={[styles.slider, { top: 40 }]}
            />
          ) : null}

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

          {busy && busy !== 'send' ? (
            <View style={styles.canvasBusy}>
              <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
          ) : null}
        </View>

        {/* Bottom chrome, likewise per-mode. */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space[2] }]}>
          {mode === MODE.CROP ? (
            <View style={styles.cropBar}>
              <Pressable onPress={cycleAspect} hitSlop={10} style={styles.cropAction} accessibilityRole="button" accessibilityLabel={t('messages.editAspect')}>
                <Icon name="crop" size={20} color="#FFFFFF" />
                <Text style={styles.cropActionLabel}>{t(ASPECTS[aspect].label)}</Text>
              </Pressable>
              <Pressable onPress={rotate} disabled={!!busy} hitSlop={10} style={[styles.cropAction, busy && styles.disabled]} accessibilityRole="button" accessibilityLabel={t('messages.editRotate')}>
                <Icon name="rotate-cw" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : drawing || mode === MODE.TEXT ? (
            <ColorRow
              color={color}
              onPick={(c) => { setColor(c); setErasing(false); }}
              erasing={erasing}
              onToggleErase={drawing ? () => setErasing((e) => !e) : undefined}
            />
          ) : (
            <View style={styles.idleBar}>
              <Pressable
                onPress={send}
                disabled={!!busy}
                style={[styles.sendBtn, busy && styles.disabled]}
                accessibilityRole="button"
              >
                {busy === 'send'
                  ? <ActivityIndicator size="small" color="#0A0E14" />
                  : (
                    <>
                      <Text style={styles.sendText}>{t('common.send')}</Text>
                      <Icon name="send" size={17} color="#0A0E14" />
                    </>
                  )}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Mark({ shape }) {
  if (shape.kind === MODE.DRAW) {
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

  if (shape.kind === MODE.ARROW) {
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

function ToolIcon({ icon, label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[styles.toolIcon, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={23} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  canvas: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  canvasBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  topBar: {
    height: TOPBAR_H,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4],
    backgroundColor: '#0A0E14',
  },
  topAction: { paddingVertical: 8, paddingHorizontal: space[1], minWidth: 44, justifyContent: 'center' },
  // Plain text, not a button — matches the reference and keeps the photo the
  // only thing on screen with weight.
  plainAction: { color: '#FFFFFF', fontSize: 17, fontFamily: FONT.medium },
  plainActionStrong: { fontFamily: FONT.semibold },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  toolIcon: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },

  slider: { position: 'absolute', left: space[2] },

  bottom: { minHeight: BOTTOM_H, justifyContent: 'center', backgroundColor: '#0A0E14' },
  idleBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space[4] },
  cropBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5],
  },
  cropAction: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 8 },
  cropActionLabel: { color: '#FFFFFF', ...type.caption },

  disabled: { opacity: 0.4 },

  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingHorizontal: space[5], paddingVertical: 13, borderRadius: radius.pill,
    backgroundColor: '#FFFFFF', minWidth: 108, justifyContent: 'center',
  },
  sendText: { color: '#0A0E14', fontFamily: FONT.semibold, fontSize: 16 },

  textEntry: { position: 'absolute' },
  textInput: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.md,
    paddingHorizontal: space[3], paddingVertical: 8,
    fontSize: 20, fontFamily: FONT.bold,
  },
});
