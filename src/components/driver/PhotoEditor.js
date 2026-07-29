import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Image, Pressable, TextInput, PanResponder, Animated,
  StyleSheet, useWindowDimensions, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Image as SvgImage, Text as SvgText } from 'react-native-svg';
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

// Photo editor: crop, draw and text on a photo before sending it.
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

const MAX_ZOOM = 4;
const ERASE_TOLERANCE = 20;
const TEXT_MIN = 14;
const TEXT_MAX = 96;

// No arrow tool: freehand covers it, and it never earned its place in the bar.
const MODE = { CROP: 'crop', DRAW: 'draw', TEXT: 'text' };

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
  // Mirrored for the PanResponder, which is built once and would otherwise drag
  // from whatever position the draft had on its first render.
  const textDraftRef = useRef(null);
  textDraftRef.current = textDraft;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  // The draft's live position. Animated rather than state so a drag doesn't
  // re-render the editor on every frame — that's what made moving text feel
  // heavy. State catches up on release, which is the only time it matters.
  const textPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Plain mirror of the same position. An Animated.Value can't be read back
  // without a private API, and commit has to know where the text ended up even
  // if the drag was terminated rather than released.
  const textPosRef = useRef({ x: 0, y: 0 });
  const moveText = useCallback((x, y) => {
    textPosRef.current = { x, y };
    textPos.setValue({ x, y });
  }, [textPos]);
  const placeText = useCallback((p) => {
    moveText(p.x, p.y);
    setTextDraft(p);
  }, [moveText]);
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
  const gesture = useRef({
    kind: null, startDist: 0, startScale: 1, startSize: 0, startX: 0, startY: 0,
  }).current;

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
      // TEXT belongs here as much as DRAW: it drags the label. Leaving it out
      // meant a text drag was never claimed, so text could not be moved at all.
      return m === MODE.DRAW || m === MODE.TEXT;
    },

    onPanResponderGrant: (e) => {
      const touches = e.nativeEvent.touches;
      const { locationX: x, locationY: y } = e.nativeEvent;
      const m = opts.current.mode;

      if (touches.length === 2) {
        // In text mode two fingers resize the type, not the photo — that's the
        // whole size control, which is why text has no slider.
        gesture.kind = m === MODE.TEXT ? 'text-size' : 'pinch';
        gesture.startDist = touchDistance(touches);
        gesture.startScale = view.scale;
        gesture.startSize = opts.current.textSize;
        return;
      }
      if (!m) {
        gesture.kind = 'pan';
        gesture.startX = view.translateX;
        gesture.startY = view.translateY;
        return;
      }
      // Text is already placed and focused by the time the mode opens, so a
      // touch moves it rather than creating it — unless it lands on a label
      // committed earlier, in which case that one is picked back up. Without
      // this, Done was one-way: a label could never be moved again.
      if (m === MODE.TEXT) {
        gesture.kind = 'text-move';
        const list = shapesRef.current;
        let picked = null;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i].kind === MODE.TEXT && hitTestShape(list[i], { x, y }, ERASE_TOLERANCE)) {
            picked = list[i];
            break;
          }
        }

        if (picked) {
          const cur = textDraftRef.current;
          const curValue = (cur?.value || '').trim();
          setShapes((prev) => {
            const next = prev.filter((s) => s !== picked);
            // Whatever was being typed isn't lost by grabbing another label.
            if (curValue) {
              const { x: cx, y: cy } = textPosRef.current;
              next.push({
                kind: MODE.TEXT, color: opts.current.color, x: cx, y: cy,
                value: curValue, size: opts.current.textSize,
              });
            }
            return next;
          });
          setColor(picked.color);
          setTextSize(picked.size);
          placeText({ x: picked.x, y: picked.y, value: picked.value });
          gesture.startX = picked.x;
          gesture.startY = picked.y;
          haptics.tap();
          return;
        }

        // From the live mirror, not the state draft: state only catches up on
        // release, so a second drag started quickly would otherwise jump back
        // to where the first one began.
        gesture.startX = textPosRef.current.x;
        gesture.startY = textPosRef.current.y;
        return;
      }

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
      setDraft({ kind: MODE.DRAW, color: c, width: w, d: `M${x.toFixed(1)},${y.toFixed(1)}` });
    },

    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;

      if (touches.length === 2) {
        const textMode = opts.current.mode === MODE.TEXT;
        if (gesture.kind !== 'pinch' && gesture.kind !== 'text-size') {
          gesture.kind = textMode ? 'text-size' : 'pinch';
          gesture.startDist = touchDistance(touches);
          gesture.startScale = view.scale;
          gesture.startSize = opts.current.textSize;
          setDraft(null);
        }
        const ratio = touchDistance(touches) / (gesture.startDist || 1);
        if (gesture.kind === 'text-size') {
          setTextSize(Math.round(Math.min(TEXT_MAX, Math.max(TEXT_MIN, gesture.startSize * ratio))));
          return;
        }
        const next = Math.min(MAX_ZOOM, Math.max(1, gesture.startScale * ratio));
        view.scale = next;
        scale.setValue(next);
        return;
      }

      if (gesture.kind === 'text-move') {
        // Animated only — no setState per frame. That per-frame re-render is
        // what made dragging text feel heavy.
        moveText(gesture.startX + g.dx, gesture.startY + g.dy);
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
        setDraft((d) => (d ? { ...d, d: `${d.d} L${x.toFixed(1)},${y.toFixed(1)}` } : d));
      }
    },

    onPanResponderRelease: () => {
      if (gesture.kind === 'draw') {
        setDraft((d) => {
          if (d) commitShape(d);
          return null;
        });
        haptics.tap();
      }
      if (gesture.kind === 'text-move') {
        const { x, y } = textPosRef.current;
        setTextDraft((d) => (d ? { ...d, x, y } : d));
      }
      if (gesture.kind === 'pinch' && view.scale <= 1.02) resetView();
      gesture.kind = null;
    },

    onPanResponderTerminationRequest: () => false,
  }), [gesture, view, scale, translateX, translateY, moveText, placeText, width, canvasHeight, commitShape, resetView]);

  // ── Text ─────────────────────────────────────────────────────────────────
  // Entering text mode places the caret in the middle of the photo and raises
  // the keyboard straight away — the driver picked "text", so asking them to
  // tap again before they can type is a step for nothing.
  // Keyed on `textDraft` rather than its ref so it also re-arms after a commit:
  // pressing return finishes one label and offers a fresh caret for the next,
  // instead of leaving text mode with the keyboard up and nothing to type into.
  // Leaving the mode sets `mode` in the same batch, so this doesn't fight Done.
  useEffect(() => {
    if (mode !== MODE.TEXT) return;
    if (textDraft) return;
    if (!(imageRect.width > 0)) return;
    placeText({
      x: imageRect.x + imageRect.width / 2,
      y: imageRect.y + imageRect.height / 2,
      value: '',
    });
  }, [mode, textDraft, imageRect, placeText]);

  // (x, y) is the CENTRE of the text, not an SVG baseline origin. Centring is
  // what the on-photo editor shows, so storing anything else would mean
  // converting in two places and getting it wrong in one.
  const commitText = useCallback(() => {
    setTextDraft((d) => {
      const value = (d?.value || '').trim();
      if (value) {
        // Position comes from the live mirror, not the draft: a drag only
        // writes back to state on release, and this can run before that.
        const { x, y } = textPosRef.current;
        setShapes((prev) => [...prev, {
          kind: MODE.TEXT, color: opts.current.color, x, y, value,
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
  const drawing = mode === MODE.DRAW;

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
          {/* Draw only. Text sizes by pinch instead — a slider and a two-finger
              gesture doing the same job is one control too many. */}
          {drawing ? (
            <SizeSlider
              value={strokeWidth}
              min={2}
              max={26}
              height={Math.min(240, canvasHeight - 80)}
              onChange={setStrokeWidth}
              style={[styles.slider, { top: 40 }]}
            />
          ) : null}

          {/* No frame: the type sits straight on the photo, exactly as it will
              in the exported image. pointerEvents="none" hands every touch to
              the gesture layer beneath, so a drag moves the text and a pinch
              resizes it while the field quietly keeps focus and the keyboard. */}
          {textDraft ? (
            <Animated.View
              // Driven by transform, not `top`/`left`. The previous version
              // pinned left/right to 0 so only `top` ever moved — horizontal
              // drags changed the stored x but nothing on screen, and the text
              // jumped sideways the moment it was committed.
              style={[styles.textEntry, {
                transform: [
                  { translateX: Animated.subtract(textPos.x, width / 2) },
                  { translateY: Animated.subtract(textPos.y, textSize * 0.6) },
                ],
              }]}
              pointerEvents="none"
            >
              <TextInput
                value={textDraft.value}
                onChangeText={(v) => setTextDraft((d) => (d ? { ...d, value: v } : d))}
                placeholder={t('messages.markupTextPlaceholder')}
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={[styles.textInput, { color, fontSize: textSize, lineHeight: textSize * 1.2 }]}
                autoFocus
                multiline
                textAlign="center"
                onSubmitEditing={commitText}
                returnKeyType="done"
              />
            </Animated.View>
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

  // (x, y) is the text's centre. SVG positions from the baseline, so nudge down
  // by roughly a third of the cap height to sit it on that centre.
  return (
    <SvgText
      x={shape.x}
      y={shape.y + shape.size * 0.34}
      textAnchor="middle"
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

  // Anchored at the canvas origin and moved purely by transform, so the drag
  // can run on Animated values without a re-render per frame.
  textEntry: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  textInput: {
    width: '100%',
    paddingHorizontal: space[4],
    fontFamily: FONT.bold,
    // Mirrors the dark outline the SVG renderer strokes around the glyphs, so
    // what's typed matches what gets exported.
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
