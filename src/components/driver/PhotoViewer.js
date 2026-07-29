import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, Animated, TextInput,
  PanResponder, StyleSheet, useWindowDimensions, Platform,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import Icon from '../ui/Icon';
import { useT } from '../../i18n/LanguageContext';
import { saveToPhotoLibrary, downloadChatAttachment } from '../../api/main';
import haptics from '../../lib/haptics';
import { space, type, radius, FONT } from '../../theme/tokens';

// Fullscreen photo viewer: pinch-zoom, pan, double-tap zoom, swipe between the
// photos of an album, and swipe-down to dismiss.
//
// Built on RN's own Animated + PanResponder rather than gesture-handler /
// reanimated on purpose. Neither is in this project, and each is a native
// module — adding them would force an extra EAS build for what is ultimately a
// self-contained screen. The one real cost is that gestures run on the JS
// thread; for a static image with no list scrolling underneath it, that's fine.
//
// The gesture split is what keeps this readable: the pager ScrollView owns
// horizontal swiping while a photo is un-zoomed, and the moment a photo is
// zoomed we disable paging so the PanResponder owns everything. Without that
// switch the two fight over every drag.

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const DISMISS_DISTANCE = 120;
// Matches the thread's own double-tap reaction, so the gesture and the button
// mean the same thing.
const QUICK_REACTION = '❤️';

const touchDistance = (touches) => {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

export default function PhotoViewer({
  uris, index = 0, msg, filename, onClose,
  onSendReply, onReact, onSaveToDocs, onDelete, onEdit,
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const list = useMemo(() => (uris || []).filter(Boolean), [uris]);
  const [page, setPage] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  // Chrome hides on a single tap so it never covers the thing being inspected,
  // and stays hidden while zoomed — that's when the driver is reading a BOL
  // number and a toolbar across the top is exactly in the way.
  const [chrome, setChrome] = useState(true);
  const [busy, setBusy] = useState(null);        // 'save' | 'share' — disables its button
  const [moreOpen, setMoreOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [toast, setToast] = useState(null);      // { text, bad } — in-modal feedback
  const [kbHeight, setKbHeight] = useState(0);
  const toastTimer = useRef(null);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height || 0));
    const onHide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);
  const pagerRef = useRef(null);
  const visible = list.length > 0;
  const currentUri = list[page];
  const showChrome = chrome && !zoomed;

  // Backdrop fades with the dismiss drag so the thread shows through as the
  // photo is pulled away, rather than the sheet vanishing at a threshold.
  const dismissY = useRef(new Animated.Value(0)).current;
  const backdrop = dismissY.interpolate({
    inputRange: [-300, 0, 300],
    outputRange: [0.2, 1, 0.2],
    extrapolate: 'clamp',
  });

  // Jump to the tapped photo on open. Non-animated: the viewer fades in
  // already, and animating a scroll from page 0 reads as a glitch.
  useEffect(() => {
    if (!visible) return;
    setPage(index);
    const id = requestAnimationFrame(() => {
      pagerRef.current?.scrollTo({ x: index * width, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, index, width]);

  const onMomentumEnd = useCallback((e) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setPage(next);
  }, [width]);

  const close = useCallback(() => {
    dismissY.setValue(0);
    setZoomed(false);
    setMoreOpen(false);
    setReply('');
    onClose?.();
  }, [dismissY, onClose]);

  const showToast = useCallback((text, bad = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, bad });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const save = useCallback(async () => {
    if (busy || !currentUri) return;
    setBusy('save');
    try {
      const outcome = await saveToPhotoLibrary(currentUri, filename || 'photo.jpg');
      if (outcome === 'denied') {
        haptics.error();
        showToast(t('messages.savePhotoDeniedBody'), true);
      } else {
        haptics.success();
        showToast(t('messages.savedToPhotosBody'));
      }
    } catch (err) {
      console.error('[Viewer] Save to photos failed:', err);
      haptics.error();
      showToast(t('messages.savePhotoFailedBody'), true);
    } finally {
      setBusy(null);
    }
  }, [busy, currentUri, filename, t, showToast]);

  const share = useCallback(async () => {
    if (busy || !currentUri) return;
    setBusy('share');
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable on this device');
      // downloadChatAttachment already returns the UTI/mimeType pair the share
      // sheet needs — iOS reads UTI, Android reads mimeType.
      const file = await downloadChatAttachment(currentUri, filename || 'photo.jpg');
      if (!file?.uri) throw new Error('Download returned nothing');
      await Sharing.shareAsync(file.uri, { mimeType: file.contentType, UTI: file.uti || undefined });
    } catch (err) {
      console.error('[Viewer] Share failed:', err);
      haptics.error();
      showToast(t('messages.sharePhotoFailedBody'), true);
    } finally {
      setBusy(null);
    }
  }, [busy, currentUri, filename, t, showToast]);

  const sendReply = useCallback(() => {
    const value = reply.trim();
    if (!value) return;
    setReply('');
    // Deliberately does NOT close: answering "which corner?" shouldn't cost the
    // driver the photo they're looking at. That's the whole point of the layout.
    onSendReply?.(value);
    haptics.success();
  }, [reply, onSendReply]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]} />

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        // Paging off while zoomed, so pan belongs to the photo, not the pager.
        scrollEnabled={!zoomed}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ width: width * list.length }}
      >
        {list.map((uri, i) => (
          <ZoomablePage
            key={`${uri}-${i}`}
            uri={uri}
            width={width}
            height={height}
            active={i === page}
            dismissY={dismissY}
            onZoomChange={setZoomed}
            onDismiss={close}
            onTap={() => setChrome((c) => !c)}
            label={t('messages.photo')}
          />
        ))}
      </ScrollView>

      {/* Chrome sits above the pager so it stays put while photos move.
          A flat translucent bar isn't enough behind it: a 4:3 photo letterboxes
          and the controls land on black, but a screenshot fills the screen and
          the controls land on the picture, where they're barely readable. The
          scrim is a gradient rather than a band so there's no visible seam. */}
      {showChrome ? (
        <LinearGradient
          colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0.35)', 'transparent']}
          style={[styles.scrimTop, { height: insets.top + 96 }]}
          pointerEvents="none"
        />
      ) : null}

      {showChrome ? (
        <View style={[styles.topBar, { paddingTop: insets.top + space[2] }]}>
          <Pressable
            onPress={close}
            style={styles.iconBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('messages.closePhotoA11y')}
          >
            <Icon name="x" size={24} color="#FFFFFF" />
          </Pressable>

          {list.length > 1 ? (
            <Text style={styles.counterText}>
              {t('messages.photoCounter', { current: page + 1, total: list.length })}
            </Text>
          ) : <View />}

          <View style={styles.topActions}>
            <Pressable
              onPress={save}
              disabled={!!busy}
              style={[styles.iconBtn, busy === 'save' && styles.iconBtnBusy]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('messages.savePhotoA11y')}
            >
              {busy === 'save'
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Icon name="download" size={22} color="#FFFFFF" />}
            </Pressable>
            <Pressable
              onPress={share}
              disabled={!!busy}
              style={[styles.iconBtn, busy === 'share' && styles.iconBtnBusy]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('messages.sharePhotoA11y')}
            >
              {busy === 'share'
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Icon name="share" size={21} color="#FFFFFF" />}
            </Pressable>
            <Pressable
              onPress={() => setMoreOpen(true)}
              style={styles.iconBtn}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('messages.moreActionsA11y')}
            >
              <Icon name="more-horizontal" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {showChrome ? (
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.8)']}
          style={[styles.scrimBottom, { height: insets.bottom + 130 }]}
          pointerEvents="none"
        />
      ) : null}

      {showChrome ? (
        <View
          // Plain View, not KeyboardAvoidingView: KAV assumes it's a flex
          // container, and absolutely positioned with `padding` behaviour it
          // mismeasured and let the reply pill run off the bottom of the
          // screen. Tracking the keyboard directly and offsetting `bottom` is
          // both simpler and correct.
          style={[styles.bottomBar, { bottom: kbHeight, paddingBottom: kbHeight ? space[3] : insets.bottom + space[5] }]}
        >
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={t('messages.replyToPhotoPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.55)"
            style={styles.replyInput}
            multiline
            onSubmitEditing={sendReply}
          />
          {reply.trim() ? (
            <Pressable
              onPress={sendReply}
              style={styles.sendBtn}
              accessibilityRole="button"
              accessibilityLabel={t('messages.sendA11y')}
            >
              <Icon name="arrow-up" size={20} color="#0A0E14" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { onReact?.(QUICK_REACTION); haptics.success(); }}
              style={styles.iconBtn}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('messages.reactA11y')}
            >
              <Text style={styles.quickReaction}>{QUICK_REACTION}</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {/* An in-modal overlay, NOT a nested <Modal>. Presenting a Modal from
          inside a Modal — and then a third one for markup or the Documents
          review sheet — is the iOS presentation collision this codebase already
          hit once (see the note above ConfirmDelete in messages.js): the screen
          simply freezes. Actions that need another modal close this one first
          and are re-raised by the parent once it's gone. */}
      {moreOpen ? (
        <Pressable style={styles.sheetOverlay} onPress={() => setMoreOpen(false)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}
            onPress={() => {}}
          >
            <View style={styles.sheetGrabber} />
            {onEdit ? (
              <SheetRow icon="edit-2" label={t('messages.editPhoto')} onPress={() => { setMoreOpen(false); onEdit(currentUri); }} />
            ) : null}
            {onSaveToDocs ? (
              <SheetRow icon="folder-plus" label={t('messages.saveToDocuments')} onPress={() => { setMoreOpen(false); onSaveToDocs(); }} />
            ) : null}
            {onDelete && msg?.from === 'driver' ? (
              <SheetRow icon="trash-2" label={t('common.delete')} danger onPress={() => { setMoreOpen(false); onDelete(); }} />
            ) : null}
          </Pressable>
        </Pressable>
      ) : null}

      {/* Success/failure feedback lives inside the modal. Alert.alert raised
          from here hits the same presentation collision and never appears. */}
      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + 110 }]} pointerEvents="none">
          <Icon name={toast.bad ? 'alert-circle' : 'check-circle'} size={16} color="#FFFFFF" />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      ) : null}
    </Modal>
  );
}

function SheetRow({ icon, label, danger, onPress }) {
  const color = danger ? '#FF6B6B' : '#FFFFFF';
  return (
    <Pressable onPress={onPress} style={styles.sheetRow} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={19} color={color} />
      <Text style={[styles.sheetLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ZoomablePage({ uri, width, height, active, dismissY, onZoomChange, onDismiss, onTap, label }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Animated.Values can't be read synchronously mid-gesture, so the committed
  // value of each is mirrored here and updated on release.
  const cur = useRef({ scale: 1, x: 0, y: 0 }).current;
  const gesture = useRef({ startDist: 0, startScale: 1, startX: 0, startY: 0, mode: null }).current;
  const lastTap = useRef(0);

  const setZoomed = useCallback((v) => {
    if (cur.scale !== v) onZoomChange?.(v > 1);
  }, [cur, onZoomChange]);

  // A photo left zoomed while the driver swipes to the next one would come back
  // zoomed and off-centre. Reset whenever this page loses focus.
  useEffect(() => {
    if (active) return;
    cur.scale = 1; cur.x = 0; cur.y = 0;
    scale.setValue(1); translateX.setValue(0); translateY.setValue(0);
  }, [active, cur, scale, translateX, translateY]);

  const springHome = useCallback(() => {
    cur.scale = 1; cur.x = 0; cur.y = 0;
    onZoomChange?.(false);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
    ]).start();
  }, [cur, scale, translateX, translateY, onZoomChange]);

  const zoomTo = useCallback((next) => {
    cur.scale = next; cur.x = 0; cur.y = 0;
    onZoomChange?.(next > 1);
    Animated.parallel([
      Animated.spring(scale, { toValue: next, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2 }),
    ]).start();
  }, [cur, scale, translateX, translateY, onZoomChange]);

  const responder = useMemo(() => PanResponder.create({
    // Two fingers always mean pinch. One finger only belongs to us when the
    // photo is zoomed (pan) or the drag is clearly vertical (dismiss) —
    // anything else is left to the pager so horizontal swipes still page.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (e, g) => {
      if (e.nativeEvent.touches.length === 2) return true;
      if (cur.scale > 1) return true;
      return Math.abs(g.dy) > Math.abs(g.dx) * 1.5 && Math.abs(g.dy) > 8;
    },

    onPanResponderGrant: (e) => {
      const touches = e.nativeEvent.touches;
      gesture.startScale = cur.scale;
      gesture.startX = cur.x;
      gesture.startY = cur.y;
      if (touches.length === 2) {
        gesture.mode = 'pinch';
        gesture.startDist = touchDistance(touches);
      } else {
        gesture.mode = cur.scale > 1 ? 'pan' : 'dismiss';
      }
    },

    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;

      // Fingers can arrive after the gesture starts — promote to a pinch
      // rather than dragging the photo sideways mid-zoom.
      if (touches.length === 2) {
        if (gesture.mode !== 'pinch') {
          gesture.mode = 'pinch';
          gesture.startDist = touchDistance(touches);
          gesture.startScale = cur.scale;
        }
        const ratio = touchDistance(touches) / (gesture.startDist || 1);
        const next = Math.min(MAX_SCALE, Math.max(0.8, gesture.startScale * ratio));
        scale.setValue(next);
        cur.scale = next;
        return;
      }

      if (gesture.mode === 'pan') {
        translateX.setValue(gesture.startX + g.dx);
        translateY.setValue(gesture.startY + g.dy);
        return;
      }

      if (gesture.mode === 'dismiss') {
        translateY.setValue(g.dy);
        dismissY.setValue(g.dy);
      }
    },

    onPanResponderRelease: (_e, g) => {
      if (gesture.mode === 'dismiss') {
        if (Math.abs(g.dy) > DISMISS_DISTANCE) { onDismiss?.(); return; }
        dismissY.setValue(0);
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        cur.y = 0;
        return;
      }

      if (gesture.mode === 'pinch') {
        // An over-pinch springs back to 1 instead of sticking below it.
        if (cur.scale <= 1.02) { springHome(); return; }
        const clamped = Math.min(MAX_SCALE, cur.scale);
        cur.scale = clamped;
        scale.setValue(clamped);
        onZoomChange?.(true);
        return;
      }

      if (gesture.mode === 'pan') {
        // Keep the photo from being flung off screen: cap the offset at how far
        // the scaled image actually overflows the viewport.
        const maxX = Math.max(0, (width * cur.scale - width) / 2);
        const maxY = Math.max(0, (height * cur.scale - height) / 2);
        const x = Math.min(maxX, Math.max(-maxX, gesture.startX + g.dx));
        const y = Math.min(maxY, Math.max(-maxY, gesture.startY + g.dy));
        cur.x = x; cur.y = y;
        Animated.parallel([
          Animated.spring(translateX, { toValue: x, useNativeDriver: true, bounciness: 2 }),
          Animated.spring(translateY, { toValue: y, useNativeDriver: true, bounciness: 2 }),
        ]).start();
      }
    },

    onPanResponderTerminationRequest: () => false,
  }), [cur, gesture, scale, translateX, translateY, dismissY, width, height, springHome, onDismiss, onZoomChange]);

  // A single tap toggles the chrome, a double tap zooms — so the single-tap
  // action has to wait out the double-tap window, or every zoom would also
  // flash the toolbars off and back on.
  const tapTimer = useRef(null);
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
      if (cur.scale > 1) springHome(); else zoomTo(DOUBLE_TAP_SCALE);
      return;
    }
    lastTap.current = now;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapTimer.current = null; onTap?.(); }, DOUBLE_TAP_MS);
  }, [cur, springHome, zoomTo, onTap]);

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      <Pressable onPress={handleTap} style={StyleSheet.absoluteFill}>
        <Animated.Image
          source={{ uri }}
          resizeMode="contain"
          accessibilityLabel={label}
          style={[
            { width, height },
            { transform: [{ translateX }, { translateY }, { scale }] },
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },

  // Gradients rather than solid bars: controls stay readable over a full-bleed
  // screenshot without stamping a hard-edged band across the photo.
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[3], paddingBottom: space[2],
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconBtnBusy: { opacity: 0.6 },
  counterText: { color: '#FFFFFF', fontSize: 13, fontFamily: FONT.medium, ...type.num },

  bottomBar: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end', gap: space[2],
    paddingHorizontal: space[3], paddingTop: space[2],
  },
  replyInput: {
    flex: 1, minHeight: 40, maxHeight: 110,
    paddingHorizontal: space[3], paddingVertical: 9,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(255,255,255,0.14)',
    color: '#FFFFFF', ...type.body,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  quickReaction: { fontSize: 24 },

  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#14181F',
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: space[2], paddingHorizontal: space[2],
  },
  sheetGrabber: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center', marginBottom: space[2],
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 14, paddingHorizontal: space[3] },
  sheetLabel: { ...type.body },

  toast: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingHorizontal: space[3], paddingVertical: 10,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(20,24,31,0.95)',
    maxWidth: '86%',
  },
  toastText: { color: '#FFFFFF', ...type.caption, flexShrink: 1 },
});
