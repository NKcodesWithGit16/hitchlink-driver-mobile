import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, TextInput, Pressable,
  Platform, Linking, Animated, Image, Modal, Keyboard, Dimensions, Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter, useFocusEffect } from 'expo-router';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import PeerAvatar from '../../src/components/ui/PeerAvatar';
import RecordingBar from '../../src/components/driver/RecordingBar';
import DocumentReviewModal from '../../src/components/driver/DocumentReviewModal';
import PhotoViewer from '../../src/components/driver/PhotoViewer';
import PhotoEditor from '../../src/components/driver/PhotoEditor';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { useCall } from '../../src/context/CallContext';
import {
  fetchMessages, sendMessage, sendVoiceMessage, sendPhotosMessage, sendDocumentMessage,
  downloadChatAttachment, fetchActiveLoad,
  editMessage, deleteMessage, reactToMessage, removeReaction, markChatRead,
} from '../../src/api/main';
import { canPreview, previewAsync } from 'hitchlink-quicklook';
import { useChatSocket } from '../../src/hooks/useChatSocket';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';
import { playMessageSound } from '../../src/lib/sound';
import { buildChatRows, dayLabel } from '../../src/lib/chatRows';
import { getValidToken } from '../../src/lib/session';
import { parsePeaksString, resamplePeaks } from '../../src/lib/waveform';
import haptics from '../../src/lib/haptics';
import { space, type, radius, FONT, shadow, elevation } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';
import { useCallBannerInset } from '../../src/components/call/CallOverlay';

// Quick-tap reactions, plus the windows the backend enforces (mirror them in the
// UI so we only offer actions that will actually succeed).
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const HEART_EMOJI = '❤️';
const DOUBLE_TAP_MS = 280;
const EDIT_WINDOW_MIN = 15;
const DELETE_WINDOW_MIN = 60;
const ageMin = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity);
const replyPreviewOf = (m) => ({ id: m.id, from: m.from, text: m.text, kind: m.kind });
// Fixed height for the reveal-on-tap timestamp row — a single line of small
// text is always this tall, so an Animated height 0→this gives a precise,
// guaranteed top-down expand (see Bubble's revealAnim) instead of leaving it
// to LayoutAnimation, which doesn't let us control which edge stays put.
const REVEALED_ROW_HEIGHT = 22;
// Anything within this of the bottom of the thread counts as "at the bottom"
// for auto-scroll purposes — roughly one short bubble, so a pixel or two of
// overscroll doesn't unpin it. See "Keeping the newest message in view".
const BOTTOM_PIN_SLOP = 120;
// How long the thread gets to lay itself out before scroll events are treated
// as the driver's own. FlatList measures rows in batches, so the real bottom
// moves several times after the first paint.
const SETTLE_MS = 800;
// How long after we ask for an animated scroll the resulting scroll events are
// still ours rather than the driver's. RN reports no difference between the two,
// and scrollToEnd's animation runs ~250-300ms; anything inside this window is
// discounted. See scrollToEnd / onScroll.
const AUTO_SCROLL_GRACE_MS = 450;
// Cap on one album. The backend takes any number of attachments, but each is
// uploaded on cab wifi or LTE and they all have to land before the message
// posts, so this keeps a fat-fingered "select all" from stalling the thread.
const MAX_PHOTOS_PER_MESSAGE = 10;
// Staging-tray thumbnail edge.
const TRAY_THUMB = 64;
// Photo bubbles size to the image's own aspect ratio inside these bounds, so a
// portrait shot stays portrait instead of being cropped to a landscape box.
// Width tracks the screen so the bubble looks right on a small phone and a
// tablet alike; the height cap stops one tall photo owning the whole thread.
const PHOTO_MAX_W = Math.min(260, Math.round(Dimensions.get('window').width * 0.66));
const PHOTO_MAX_H = 340;
const PHOTO_MIN_EDGE = 96;
// Gap between dismissing one Modal and presenting the next. iOS will not
// present while a dismissal is in flight — it freezes instead — and a Modal's
// fade/slide runs ~250ms. See the collision note above ConfirmDelete.
const MODAL_HANDOFF_MS = 320;

// "kind" describes an attachment message's payload type; used both for the
// reply-quote preview and the composer's edit/reply context bar.
function kindLabel(kind, t) {
  return kind === 'voice' ? t('messages.kindVoice')
    : kind === 'document' ? t('messages.kindDocument')
    : kind === 'video' ? t('messages.kindVideo')
    : kind === 'image' ? t('messages.kindImage')
    : null;
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const callInset = useCallBannerInset();
  const router = useRouter();
  const { colors } = useTheme();
  const t = useT();
  const { user } = useAuth();

  const QUICK = [
    { label: t('messages.quickOnMyWay'),    icon: 'navigation' },
    { label: t('messages.quickRunningLate'), icon: 'clock' },
    { label: t('messages.quickAtDock'),     icon: 'anchor' },
    { label: t('messages.quickLoaded'),     icon: 'check-circle' },
    { label: t('messages.quickDelivered'),  icon: 'flag' },
  ];
  const { startCall, status: callStatus, expand: expandCall } = useCall();
  // Now that a call can be minimized to a pill, the driver can be sitting in
  // this screen mid-call — and startCall() bails on any non-idle status, so
  // the Call button would look broken. Reopen the call instead.
  const onCallPress = useCallback(() => {
    if (callStatus === 'idle') startCall({ video: false });
    else expandCall();
  }, [callStatus, startCall, expandCall]);
  // Video gets its own button rather than sharing the phone one's long press:
  // that gesture is already the carrier-phone fallback, and a long press
  // advertises nothing to a driver who doesn't know it's there.
  const onVideoCallPress = useCallback(() => {
    if (callStatus === 'idle') startCall({ video: true });
    else expandCall();
  }, [callStatus, startCall, expandCall]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items,       setItems]       = useState([]);
  const [text,        setText]        = useState('');
  const [typing,      setTyping]      = useState(false);
  const [activeLoad,  setActiveLoad]  = useState(null);
  const [replyTo,     setReplyTo]     = useState(null);   // message being replied to
  const [editing,     setEditing]     = useState(null);   // message being edited
  const [focus,       setFocus]       = useState(null);   // { msg, anchor, mine } — long-pressed message, floating menu open
  const [revealedId,  setRevealedId]  = useState(null);   // Messenger-style: id of the message currently showing its timestamp
  const [confirmDel,  setConfirmDel]  = useState(null);   // message pending delete confirmation
  const [viewer,      setViewer]      = useState(null);   // { msg, uris, index } open in the fullscreen viewer
  const [markup,      setMarkup]      = useState(null);   // { uri, msg } open in the markup editor
  const [kbOpen,      setKbOpen]      = useState(false);  // keyboard visibility
  const [attachMenuOpen, setAttachMenuOpen] = useState(false); // paperclip's Photo/Document sheet
  // Photos picked but not yet sent, shown as a removable strip above the input.
  // Staging them rather than firing on pick is what lets a driver drop a wrong
  // photo, reorder their mind, or add a caption before it reaches dispatch.
  const [pendingPhotos, setPendingPhotos] = useState([]);  // [{ id, uri }]
  const [sendingPhotos, setSendingPhotos] = useState(false);
  // `send` is defined above sendPhotos in this file and has to hand off to it.
  // Refs keep that one-way handoff without reordering the composer block, and
  // sidestep the stale closure a direct dependency would create.
  const pendingPhotosRef = useRef(pendingPhotos);
  pendingPhotosRef.current = pendingPhotos;
  const sendPhotosRef = useRef(null);
  // "Save to Documents": the picked attachment is downloaded first, then handed
  // to the same review sheet the Documents tab uses, so the driver tags the
  // type/label/expiry rather than filing everything as an untyped "Other" with
  // no expiry — which would quietly defeat the credential-expiry reminders.
  const [docSaveBusy,  setDocSaveBusy]  = useState(false);
  const [docSaveAsset, setDocSaveAsset] = useState(null);
  const scrollRef   = useRef(null);
  // Bottom-pinning state — see the "Keeping the newest message in view" block
  // below. Declared up here, along with the two helpers that drive it, because
  // the keyboard listeners (which run before that block in source order) scroll
  // the thread too and have to go through the same path.
  const atBottomRef = useRef(true);   // driver is parked on the newest message
  const settledRef  = useRef(false);  // first paint finished laying itself out
  const settleTimerRef = useRef(null);
  const autoScrollingRef = useRef(false); // a scroll WE asked for is in flight
  const autoScrollTimerRef = useRef(null);
  const kbPad       = useRef(new Animated.Value(0)).current; // live keyboard height → wrapper padding
  const seenIdsRef  = useRef(new Set());    // dispatcher-message ids already dinged/accounted for
  const firstLoadRef = useRef(true);        // skip the sound on the initial history fetch
  const isTypingRef  = useRef(false);       // have we told the dispatcher "typing" without a "stopped" yet
  const typingTimeoutRef = useRef(null);    // auto-sends "stopped typing" after a pause

  // Every programmatic scroll goes through here so the scroll events it
  // generates can be told apart from a driver's drag. Without that, an animated
  // scrollToEnd unpins the very thing it was called to pin: the frames on the
  // way down all report "not at the bottom", onScroll believes them, and the
  // next content-size change declines to follow.
  const scrollToEnd = useCallback((animated = true) => {
    autoScrollingRef.current = true;
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
    autoScrollTimerRef.current = setTimeout(
      () => { autoScrollingRef.current = false; },
      animated ? AUTO_SCROLL_GRACE_MS : 120,
    );
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  // (Re)starts the settle window — the period during which the thread is still
  // measuring itself and every content-size change pins unconditionally.
  const armSettle = useCallback(() => {
    settledRef.current = false;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => { settledRef.current = true; }, SETTLE_MS);
  }, []);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
  }, []);

  // Keyboard tracking drives two things: (1) kbOpen collapses the composer's
  // own bottom padding (the floating tab island is hidden behind the keyboard,
  // so it no longer needs to reserve room for it); (2) kbPad lifts the whole
  // thread + composer above the keyboard, replacing KeyboardAvoidingView (see
  // the wrapper below for why we manage it ourselves).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => {
      setKbOpen(true);
      // Pad by the gap between the TOP of the keyboard and the bottom of the
      // screen — not by endCoordinates.height. Under Android edge-to-edge this
      // wrapper runs to the physical screen bottom (under the nav bar), but
      // `.height` excludes that nav-bar strip, so padding by height left the
      // composer overlapping the keyboard by the nav-bar inset. screenY is
      // absolute, so screenH − screenY is the true occlusion. Fall back to
      // height if screenY is missing.
      const end = e?.endCoordinates;
      const screenH = Dimensions.get('screen').height;
      const occlusion = end && typeof end.screenY === 'number' && end.screenY > 0
        ? Math.max(0, screenH - end.screenY)
        : (end?.height ?? 0);
      Animated.timing(kbPad, {
        toValue: occlusion,
        duration: e?.duration || 220,
        useNativeDriver: false,
      }).start();
      // Follow the keyboard down to the newest message only if that's where
      // the driver already was. Scrolled up re-reading something, tapping the
      // composer must not throw away their place.
      if (atBottomRef.current) scrollToEnd(true);
    });
    const h = Keyboard.addListener(hideEvt, (e) => {
      setKbOpen(false);
      // Reset hard to 0 — don't trust the hide event's coordinates. On Android
      // (edge-to-edge) keyboardDidHide can report a bogus height, which is what
      // left the composer stuck lifted instead of dropping back to rest.
      Animated.timing(kbPad, {
        toValue: 0,
        duration: e?.duration || 180,
        useNativeDriver: false,
      }).start();
    });
    return () => { s.remove(); h.remove(); };
  }, [kbPad, scrollToEnd]);

  // dispatcher info comes from the driver profile loaded in AuthContext
  const dispatcher = user?.dispatcher;

  // Cheap fingerprint of a server payload — everything that would actually
  // change what's on screen. The poll runs every 5s while the socket is down
  // and returns up to 100 unchanged messages the overwhelming majority of the
  // time; comparing this lets an unchanged poll skip setItems entirely instead
  // of re-rendering the whole thread on a timer.
  const signatureOf = (list) => list
    .map((m) => `${m.id}|${m.editedAt ?? ''}|${m.read ? 1 : 0}|${m.deleted ? 1 : 0}|${(m.reactions || []).map((r) => `${r.emoji}${r.count}${r.mine ? 'm' : ''}`).join(',')}`)
    .join(';');
  const lastSigRef = useRef(null);

  // Pull chat history and reconcile with any optimistic messages we appended
  // locally but the server hasn't echoed back yet (so they don't flicker away).
  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const server = await fetchMessages(user.id);
      // One ding for any dispatcher message we haven't seen yet — covers both
      // the socket nudge and the polling fallback with a single code path, and
      // skips the driver's own sends (from === 'driver').
      if (!firstLoadRef.current) {
        const hasNewIncoming = server.some((m) => m.from !== 'driver' && !seenIdsRef.current.has(m.id));
        if (hasNewIncoming) playMessageSound();
      }
      server.forEach((m) => seenIdsRef.current.add(m.id));
      firstLoadRef.current = false;

      setItems((prev) => {
        const serverDriverTexts = new Set(
          server.filter((m) => m.from === 'driver' && m.text).map((m) => m.text)
        );
        const stillPending = prev.filter(
          (m) => String(m.id).startsWith('local-') && !(m.text && serverDriverTexts.has(m.text))
        );
        // Nothing changed server-side and no optimistic bubble needs
        // reconciling — return the identical array so React bails out of the
        // re-render instead of rebuilding every bubble on a 5s timer.
        const sig = signatureOf(server);
        if (sig === lastSigRef.current && stillPending.length === 0
            && prev.length === server.length) {
          return prev;
        }
        lastSigRef.current = sig;
        return [...server, ...stillPending];
      });
      // The driver has this screen open and just fetched history — advance
      // their read cursor so the dispatcher's own sent messages show as read.
      if (server.some((m) => m.from !== 'driver')) markChatRead(user.id, user.id).catch(() => {});
    } catch {}
  }, [user?.id]);

  // Real-time: the SignalR hub nudges `load()` the instant a message arrives,
  // and flips `typing` when the dispatcher's TypingChanged event says so.
  // Polling stays as reconciliation — relaxed to 30s while the socket is
  // healthy (it also picks up edits/deletes/reactions, which the hub doesn't
  // broadcast), and back to 5s whenever the socket is down or unavailable
  // (mock mode, web without the module, server unreachable).
  const { connected: socketConnected, sendTyping } = useChatSocket(user?.id, load, setTyping);

  useEffect(() => {
    if (!user?.id) return;
    load();
    fetchActiveLoad(user.id).then(setActiveLoad).catch(() => {});
    const timer = setInterval(load, socketConnected ? 30000 : 5000);
    return () => clearInterval(timer);
  }, [user?.id, load, socketConnected]);

  // Tells the dispatcher "typing" the moment text appears, and "stopped" both
  // after a pause and immediately on send/cancel — never leaves them staring
  // at a stale "typing…" bubble.
  const stopTypingSignal = useCallback(() => {
    if (typingTimeoutRef.current) { clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = null; }
    if (isTypingRef.current) { isTypingRef.current = false; sendTyping(false); }
  }, [sendTyping]);

  const handleTextChange = useCallback((value) => {
    setText(value);
    const hasText = value.trim().length > 0;
    if (hasText && !isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(true);
    } else if (!hasText) {
      stopTypingSignal();
      return;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTypingSignal, 3000);
  }, [sendTyping, stopTypingSignal]);

  // Stop signaling "typing" if the driver navigates away mid-composition.
  useEffect(() => () => stopTypingSignal(), [stopTypingSignal]);

  // ── Keeping the newest message in view ──────────────────────────────────
  // A messenger opens on the newest message and stays there. Auto-scrolling
  // only when the message COUNT rose (what this did before) missed both of the
  // cases that matter:
  //
  //   Opening the tab — the one scroll fired a frame after the data arrived,
  //   before FlatList had measured the variable-height bubbles. It only ever
  //   renders a batch at a time, so "the bottom" it scrolled to was the bottom
  //   of the first ~20 rows, part-way up the thread.
  //
  //   Sending — the optimistic bubble bumps the count and scrolls, then the
  //   server echo replaces it with the persisted copy. Same count, different
  //   height (plus a "seen" avatar row appearing), so nothing re-scrolled and
  //   the driver was left just off the bottom of their own message.
  //
  // So pin to the bottom on every content-size change instead, but ONLY while
  // the driver is already there. That guard is what lets this coexist with the
  // reveal-on-tap timestamp: scrolled up reading history, a bubble growing
  // 22px no longer yanks the view down — which is the exact bug that got
  // onContentSizeChange removed in the first place.
  //
  // Until the thread settles, FlatList is still measuring batches and the
  // bottom keeps moving, so every change pins unconditionally and without
  // animation — the driver should never SEE the thread walking itself down.
  // Settled means either they took control (a drag) or layout has had time to
  // converge; from then on it's the conditional pin, animated.
  //
  // This runs on FOCUS, not just on mount, and that's the whole point: the tab
  // stays mounted when the driver switches away, so scrolling up to re-read
  // something and coming back used to restore the old scroll offset. Opening
  // the chat means "show me the latest", so every entry resets the pin and
  // drops to the newest message — the scroll position is not worth preserving
  // across a tab switch, the conversation is.
  useFocusEffect(
    useCallback(() => {
      atBottomRef.current = true;
      armSettle();
      scrollToEnd(false);
    }, [armSettle, scrollToEnd]),
  );

  // …and the settle window has to be measured from when there is something to
  // lay out, not from when the tab gained focus. Opening chat as the very first
  // screen after a cold start (or a Metro bundle) meant the whole 800ms was
  // spent on an EMPTY list: history is still in flight behind auth, the socket
  // and the active-load fetch. By the time the messages landed the thread had
  // already declared itself settled, so the one scroll it got was the animated,
  // conditional kind, aimed at the bottom of the first measured batch — leaving
  // the driver part-way up. Switching tabs and back worked only because the
  // rows were measured by then, which is exactly the asymmetry to remove.
  const hasContentRef = useRef(false);
  useEffect(() => {
    if (items.length === 0) { hasContentRef.current = false; return; }
    if (hasContentRef.current) return;   // only the 0 → n transition
    hasContentRef.current = true;
    atBottomRef.current = true;
    armSettle();
    scrollToEnd(false);
  }, [items.length, armSettle, scrollToEnd]);

  const onScroll = useCallback((e) => {
    if (!settledRef.current) return;      // our own settling scrolls, not the driver
    if (autoScrollingRef.current) return; // ditto, for a scroll we just asked for
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    atBottomRef.current = fromBottom <= BOTTOM_PIN_SLOP;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (!settledRef.current) { scrollToEnd(false); return; }
    if (atBottomRef.current) scrollToEnd(true);
  }, [scrollToEnd]);

  // Sending is an explicit "I'm on the newest message" — even if the driver had
  // scrolled up, their own message has to land in view.
  const pinToBottom = useCallback(() => {
    atBottomRef.current = true;
    scrollToEnd(settledRef.current);
  }, [scrollToEnd]);

  const append = useCallback((msg) => {
    setItems((prev) => [...prev, { id: `local-${Date.now()}`, from: 'driver', at: nowStr(), ...msg }]);
    pinToBottom();
  }, [pinToBottom]);

  const send = useCallback((body) => {
    // Staged photos win: the text box is the album's caption, not a separate
    // message. sendPhotos consumes both and clears them.
    if (pendingPhotosRef.current.length > 0) { sendPhotosRef.current?.(); return; }
    const value = (body ?? text).trim();
    if (!value) return;
    stopTypingSignal();

    // Editing an existing message: PATCH it, optimistically update in place.
    if (editing) {
      const id = editing.id;
      setEditing(null);
      setText('');
      setItems((prev) => prev.map((m) => (m.id === id ? { ...m, text: value, editedAt: new Date().toISOString() } : m)));
      editMessage(id, value, user?.id).then(load).catch(() => {});
      return;
    }

    const rid = replyTo?.id || null;
    append({ text: value, ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}) });
    setText('');
    setReplyTo(null);
    // Send, then pull fresh history so the optimistic bubble is reconciled with
    // the server's persisted copy (correct id/time).
    sendMessage(user?.id, value, rid).then(() => { load(); haptics.success(); }).catch(() => haptics.error());
  }, [text, append, user?.id, load, editing, replyTo, stopTypingSignal]);

  const sendVoice = useCallback(async ({ uri, durationSec, waveformPeaks }) => {
    if (!uri || !user?.id) return;
    const rid = replyTo?.id || null;
    // Show the clip immediately, then upload. On success we drop the optimistic
    // copy and let the next poll bring the server's version (real id +
    // streamable audio URL); on failure it stays visible marked failed instead
    // of silently vanishing. waveformPeaks is the driver's own real mic-level
    // trace (see useVoiceRecorder) so the sender sees their real waveform too,
    // not just the recipient.
    const localId = `local-${Date.now()}`;
    setItems((prev) => [...prev, { id: localId, from: 'driver', at: nowStr(), kind: 'voice', uri, durationSec, waveformPeaks, ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}) }]);
    setReplyTo(null);
    pinToBottom();
    try {
      await sendVoiceMessage(user.id, { uri, durationSec, waveformPeaks, replyToMessageId: rid });
      setItems((prev) => prev.filter((m) => m.id !== localId));
      load();
      haptics.success();
    } catch {
      setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
      haptics.error();
    }
  }, [user?.id, load, pinToBottom, replyTo]);

  // Tap-to-record voice: start() flips the composer into a recording bar,
  // stop() sends the clip through sendVoice, cancel() discards it.
  const voice = useVoiceRecorder({ onSend: sendVoice });

  // ── Message actions (long-press menu) ───────────────────────────────────
  const startReply = useCallback((m) => { setFocus(null); setEditing(null); setReplyTo(m); }, []);

  const startEdit = useCallback((m) => {
    setFocus(null);
    setReplyTo(null);
    setEditing(m);
    setText(m.text || '');
  }, []);

  const cancelCompose = useCallback(() => { stopTypingSignal(); setEditing(null); setReplyTo(null); setText(''); }, [stopTypingSignal]);

  // Messenger-style: tapping a message reveals its timestamp; tapping it
  // again (or tapping a different message) closes it. Each Bubble animates
  // its own expand/collapse locally (see revealAnim) driven by this state.
  const toggleReveal = useCallback((id) => {
    setRevealedId((prev) => (prev === id ? null : id));
  }, []);

  const react = useCallback(async (m, emoji) => {
    setFocus(null);
    const mineReaction = m.reactions?.find((r) => r.mine);
    try {
      if (mineReaction?.emoji === emoji) await removeReaction(m.id, user?.id);
      else await reactToMessage(m.id, emoji, user?.id);
    } catch {}
    load();
  }, [user?.id, load]);

  // Deliberately NOT optimistic. The confirm sheet is modal and blocks the
  // thread anyway, so applying the change early buys nothing and costs a
  // rollback — and rolling back is what made a failed delete look like the
  // message "came back on its own". Instead the sheet holds a spinner until the
  // server has actually committed, and rethrows so it can show why if it
  // hasn't. Errors must not go through Alert here: an iOS alert raised while
  // this Modal is dismissing hits the same presentation collision that froze
  // the screen, so it would never appear.
  //
  // The two scopes then apply differently: "everyone" leaves a tombstone both
  // sides can see, while "me" removes the row outright — the server filters it
  // from every later fetch for this driver (GetHistory's as_=driver /
  // DeletedForDriver filter), so a placeholder only this phone would show would
  // be wrong.
  const confirmDelete = useCallback(async (scope) => {
    const m = confirmDel?.msg;
    if (!m) return;
    try {
      await deleteMessage(m.id, user?.id, scope);
      setItems((prev) => (scope === 'me'
        ? prev.filter((x) => x.id !== m.id)
        : prev.map((x) => (x.id === m.id
          ? { ...x, deleted: true, text: undefined, kind: undefined, uri: undefined, reactions: [] }
          : x))));
      setConfirmDel(null);
      haptics.success();
      load();
    } catch (err) {
      console.error(`[Chat] Delete (${scope}) failed:`, err);
      haptics.error();
      throw err; // the sheet renders it, including the HTTP status
    }
  }, [confirmDel, user?.id, load]);

  // POST /documents carries the file as base64 JSON, so the whole thing passes
  // through JS memory on the way. Rate cons and BOLs are comfortably under
  // this; the cap is here so an oversized scan says why instead of failing as
  // an opaque network error.
  const DOC_SAVE_MAX_BYTES = 15 * 1024 * 1024;

  const saveToDocuments = useCallback(async (msg) => {
    if (docSaveBusy || !msg?.uri) return;
    if (msg.sizeBytes && msg.sizeBytes > DOC_SAVE_MAX_BYTES) {
      haptics.error();
      Alert.alert(t('messages.tooLargeForDocsTitle'), t('messages.tooLargeForDocsBody'));
      return;
    }
    setDocSaveBusy(true);
    try {
      // Pulls the attachment out of R2 into the cache, with the extension and
      // sanitised name the viewer work already gave it.
      const file = await downloadChatAttachment(msg.uri, msg.filename || 'document');
      if (!file?.uri) throw new Error('Attachment download returned nothing');
      setDocSaveAsset({
        uri: file.uri,
        name: file.fileName,
        mimeType: msg.mimeType || file.contentType,
        size: msg.sizeBytes,
      });
    } catch (err) {
      console.error('[Chat] Could not stage attachment for Documents:', err);
      haptics.error();
      Alert.alert(t('messages.saveToDocsFailedTitle'), t('messages.saveToDocsFailedBody'));
    } finally {
      setDocSaveBusy(false);
    }
  }, [docSaveBusy, t]);

  // Picks photos into the staging tray. Nothing uploads here — sendPhotos()
  // does that when the driver actually hits send.
  const pickAttachment = useCallback(async () => {
    if (!user?.id) return;
    try {
      // Compatible mode makes iOS transcode HEIC to JPEG on export. Without it
      // the picker hands back the camera roll's original HEIC, which the
      // dispatcher's web chat can't render at all (src/lib/imageMime.js).
      const res = await ImagePicker.launchImageLibraryAsync({
        quality: 0.6,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_MESSAGE,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled) return;
      // Dimensions travel with the pick so the optimistic bubble gets the right
      // shape immediately and the receiver can size before downloading.
      const picked = (res.assets || [])
        .filter((a) => a?.uri)
        .map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
      if (picked.length === 0) return;
      setPendingPhotos((prev) => {
        // The tray can already hold photos from an earlier pick, and
        // selectionLimit only caps a single trip through the picker.
        const room = MAX_PHOTOS_PER_MESSAGE - prev.length;
        if (room <= 0) {
          Alert.alert(
            t('messages.photoLimitTitle'),
            t('messages.photoLimitBody', { count: MAX_PHOTOS_PER_MESSAGE }),
          );
          return prev;
        }
        if (picked.length > room) {
          Alert.alert(
            t('messages.photoLimitTitle'),
            t('messages.photoLimitBody', { count: MAX_PHOTOS_PER_MESSAGE }),
          );
        }
        return [
          ...prev,
          ...picked.slice(0, room).map((p, i) => ({ id: `p-${Date.now()}-${i}`, ...p })),
        ];
      });
      haptics.success();
    } catch (err) {
      // The picker itself failed to open or read the pick — there's no bubble
      // on screen to mark failed, so say so out loud rather than looking like
      // the tap did nothing.
      console.error('[Chat] Could not pick a photo:', err);
      haptics.error();
      Alert.alert(t('messages.attachFailedTitle'), t('messages.attachFailedBody'));
    }
  }, [user?.id, t]);

  const removePendingPhoto = useCallback((id) => {
    setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Opens the viewer on a whole album at the tapped photo. The message comes
  // along because the viewer's actions (reply, react, delete, save) all need it.
  const openViewer = useCallback((uris, index = 0, msg = null) => {
    const list = (Array.isArray(uris) ? uris : [uris]).filter(Boolean);
    if (list.length === 0) return;
    setViewer({ msg, uris: list, index: Math.max(0, Math.min(index, list.length - 1)) });
  }, []);

  // Delete confirmation is a Modal too, so it takes the same handoff.
  const setConfirmDelAfterViewer = useCallback((pending) => {
    setViewer(null);
    setTimeout(() => setConfirmDel(pending), MODAL_HANDOFF_MS);
  }, []);

  // An annotated copy is sent as a NEW message: the backend has no
  // edit-attachment endpoint, and keeping the original in the thread is the
  // right record anyway — the markup is a comment on it, not a correction.
  const handleMarkupDone = useCallback(async (edited) => {
    setMarkup(null);
    setViewer(null);
    if (!edited?.uri) return;
    // The editor reports the output's real size, so the optimistic bubble gets
    // the right shape straight away rather than measuring the file first.
    await uploadPhotos({
      photos: [{ uri: edited.uri, width: edited.width, height: edited.height }],
      caption: '',
      rid: null,
      replyPreview: null,
    });
  }, [uploadPhotos]);

  // The shared upload path for both a first send and a retry. Posts the whole
  // batch as ONE message. Same optimistic-then-reconcile dance as sendVoice:
  // the bubble appears instantly, tracks real upload progress, and on failure
  // stays on screen marked failed — carrying everything a retry needs — rather
  // than vanishing as if the driver never sent it.
  const uploadPhotos = useCallback(async ({ photos, caption, rid, replyPreview }) => {
    if (!user?.id || !photos?.length) return;
    const localId = `local-${Date.now()}`;
    const uris = photos.map((p) => p.uri);

    setSendingPhotos(true);
    setItems((prev) => [...prev, {
      id: localId,
      from: 'driver',
      at: nowStr(),
      kind: 'image',
      uri: uris[0],
      uris,
      width: photos[0]?.width,
      height: photos[0]?.height,
      text: caption || undefined,
      uploading: true,
      progress: 0,
      ...(replyPreview ? { replyTo: replyPreview } : {}),
    }]);
    pinToBottom();

    try {
      await sendPhotosMessage(user.id, {
        uris: photos,
        text: caption || null,
        replyToMessageId: rid,
        onProgress: (fraction) => {
          setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, progress: fraction } : m)));
        },
      });
      setItems((prev) => prev.filter((m) => m.id !== localId));
      load();
      haptics.success();
    } catch (err) {
      console.error('[Chat] Photo upload failed:', err);
      setItems((prev) => prev.map((m) => (m.id === localId
        ? { ...m, uploading: false, failed: true, retry: { photos, caption, rid, replyPreview } }
        : m)));
      haptics.error();
    } finally {
      setSendingPhotos(false);
    }
  }, [user?.id, pinToBottom, load]);

  // Sends whatever is staged in the tray, with the text box as the caption.
  const sendPhotos = useCallback(async () => {
    if (!user?.id || pendingPhotos.length === 0 || sendingPhotos) return;
    const photos = pendingPhotos.map((p) => ({ uri: p.uri, width: p.width, height: p.height }));
    const caption = text.trim();
    const rid = replyTo?.id || null;

    setPendingPhotos([]);
    setText('');
    setReplyTo(null);
    stopTypingSignal();
    await uploadPhotos({ photos, caption, rid, replyPreview: replyTo ? replyPreviewOf(replyTo) : null });
  }, [user?.id, pendingPhotos, sendingPhotos, text, replyTo, stopTypingSignal, uploadPhotos]);
  sendPhotosRef.current = sendPhotos;

  // Re-runs a send whose uploads failed. The uris are still on the failed
  // bubble, so this costs the driver one tap instead of re-picking every photo
  // out of the library.
  const retrySend = useCallback((m) => {
    if (!m?.retry) return;
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    uploadPhotos(m.retry);
  }, [uploadPhotos]);

  const pickDocument = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;
      const rid = replyTo?.id || null;
      const localId = `local-${Date.now()}`;
      setItems((prev) => [...prev, {
        id: localId, from: 'driver', at: nowStr(), kind: 'document',
        uri: asset.uri, filename: asset.name, sizeBytes: asset.size, mimeType: asset.mimeType,
        ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}),
      }]);
      setReplyTo(null);
      pinToBottom();
      try {
        await sendDocumentMessage(user.id, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, replyToMessageId: rid });
        setItems((prev) => prev.filter((m) => m.id !== localId));
        load();
        haptics.success();
      } catch (err) {
        console.error('[Chat] Document upload failed:', err);
        setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
        haptics.error();
      }
    } catch (err) {
      console.error('[Chat] Could not pick a document:', err);
      haptics.error();
      Alert.alert(t('messages.attachFailedTitle'), t('messages.attachFailedBody'));
    }
  }, [user?.id, replyTo, pinToBottom, load, t]);

  // Messages + real per-day separators, flattened into the single keyed array
  // the virtualized list below consumes. Grouping neighbours (prevFrom/
  // nextFrom) are resolved here rather than by index-peeking during render,
  // because a FlatList row can't see its siblings.
  const rows = useMemo(
    () => buildChatRows(items, (key, date) => dayLabel(key, date, {
      today: t('common.today'),
      yesterday: t('common.yesterday'),
      months: t('common.monthsShort'),
    })),
    [items, t],
  );

  // Messenger-style "seen" indicator goes on exactly one message — the most
  // recent driver-sent message the dispatcher's read cursor has passed —
  // not on every read message, to avoid a column of avatars.
  const lastReadMineId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      if (m.from === 'driver' && m.read && !String(m.id).startsWith('local-')) return m.id;
    }
    return null;
  }, [items]);

  const renderRow = useCallback(({ item: row }) => {
    if (row.type === 'sep') {
      return <DateSeparator label={row.label} colors={colors} styles={styles} />;
    }
    const m = row.msg;
    // Optimistic bubbles have no server id yet, so none of the actions that
    // address a message by id (react, edit, delete, long-press menu) can apply
    // to them until the send is reconciled.
    const isLocal = String(m.id).startsWith('local-');
    return (
      <Bubble
        msg={m}
        prevFrom={row.prevFrom}
        nextFrom={row.nextFrom}
        colors={colors}
        styles={styles}
        onAction={(anchor, mine) => !m.deleted && !isLocal && setFocus({ msg: m, anchor, mine })}
        onReactQuick={(emoji) => !isLocal && react(m, emoji)}
        onDoubleTap={() => !m.deleted && !isLocal && react(m, HEART_EMOJI)}
        onOpenImage={openViewer}
        onCallBack={onCallPress}
        onRetry={retrySend}
        revealed={revealedId === m.id}
        onToggleReveal={() => toggleReveal(m.id)}
        showSeen={m.id === lastReadMineId}
        dispatcher={dispatcher}
      />
    );
  }, [colors, styles, react, onCallPress, revealedId, toggleReveal, lastReadMineId, dispatcher]);

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top + callInset }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.peerInfo}>
          <PeerAvatar photoUrl={dispatcher?.photoUrl} name={dispatcher?.name} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.peerName, { color: colors.textPrimary }]} numberOfLines={1}>
              {dispatcher?.name || t('messages.dispatcherFallback')}
            </Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.go }]} />
              <Text style={[styles.statusText, { color: colors.textMuted }]}>{t('messages.availableDispatcher')}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          {/* Video is the secondary affordance and is styled as one — a driver
              reaches for audio far more often, and two filled green circles
              would be two competing primaries. It carries the accent fill
              rather than green, because green here means "call" (the phone-UI
              convention answer/hang-up rests on) and is not a colour to spend
              on a second button. */}
          <Pressable
            onPress={onVideoCallPress}
            style={styles.videoBtn}
            accessibilityRole="button"
            accessibilityLabel={t('call.videoCallA11y', { name: dispatcher?.name || t('messages.dispatcherFallback') })}
          >
            <Icon family="material-community" name="video" size={19} color={colors.tealBright} />
          </Pressable>
          <Pressable
            onPress={onCallPress}
            onLongPress={() => dispatcher?.phone && Linking.openURL(`tel:${dispatcher.phone}`).catch(() => {})}
            delayLongPress={400}
            style={styles.callBtn}
            accessibilityRole="button"
            accessibilityLabel={t('messages.callA11y', { name: dispatcher?.name || t('messages.dispatcherFallback') })}
            accessibilityHint={t('messages.callHintA11y')}
          >
            <LinearGradient
              colors={colors.gradients.go}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.callBtnFill, shadow.glow(colors.go)]}
            >
              <Icon family="ionicons" name="call" size={18} color={colors.onAccent} />
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* ── Load context banner (tap → Load tab) ── */}
      {activeLoad ? (
        <Pressable
          onPress={() => router.push('/(tabs)')}
          style={({ pressed }) => [styles.loadBanner, { backgroundColor: colors.tealFill, borderColor: colors.teal, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={t('messages.openLoadA11y', { id: activeLoad.id })}
        >
          <Icon name="truck" size={12} color={colors.teal} />
          <Text style={[styles.loadBannerText, { color: colors.teal }]} numberOfLines={1}>
            {activeLoad.id} · {activeLoad.origin} → {activeLoad.destination}
          </Text>
          <View style={[styles.loadStatusPill, { backgroundColor: colors.teal }]}>
            <Text style={[styles.loadStatusText, { color: colors.onAccent }]}>{t('messages.enRoute')}</Text>
          </View>
          <Icon name="chevron-right" size={14} color={colors.teal} />
        </Pressable>
      ) : null}

      {/* We drive keyboard avoidance ourselves instead of using
          KeyboardAvoidingView. Edge-to-edge (mandatory since Expo SDK 54) stops
          Android's window from resizing for the keyboard, and KAV's
          behavior="padding" left a residual gap after the keyboard closed — the
          composer stayed lifted instead of dropping back above the tab bar.
          Padding this wrapper by the live keyboard height (captured in the
          Keyboard listeners, animated, and reset hard to 0 on hide) lifts the
          composer above the keyboard and always returns it to rest. */}
      <Animated.View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kbPad }}>

        {/* Soft brand glow lighting the top of the thread — ambient depth,
            near-invisible, fixed while messages scroll over it. */}
        <LinearGradient
          pointerEvents="none"
          colors={colors.isDay
            ? ['rgba(1,147,171,0.12)', 'rgba(4,40,90,0.04)', 'transparent']
            : ['rgba(31,182,206,0.16)', 'rgba(4,40,90,0.06)', 'transparent']}
          style={styles.threadGlow}
        />

        {/* ── Chat area ──
            Virtualized: a long thread used to mount every bubble at once (each
            with its own Animated values and, for voice notes, its own player),
            which is what made opening a busy conversation stutter. Kept
            NON-inverted so the existing ordering, grouping and scroll-to-end
            behaviour carry over unchanged. */}
        <FlatList
          ref={scrollRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          style={styles.chatScroll}
          ListFooterComponent={typing ? <TypingIndicator colors={colors} styles={styles} dispatcher={dispatcher} /> : null}
          // Bottom-pinning (see the block above onScroll): the content size
          // changes several times while FlatList measures its batches, and each
          // one re-pins until the real bottom is reached.
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          scrollEventThrottle={16}
          // A drag means the driver has taken over — stop treating scroll
          // events as our own settling and honour where they leave the thread.
          // A real finger outranks an in-flight auto-scroll, so cancel that too.
          onScrollBeginDrag={() => {
            settledRef.current = true;
            autoScrollingRef.current = false;
          }}
          // The thread opens at the bottom; rendering a screenful up front
          // keeps that first paint from showing a gap above the newest message.
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        />

        {/* ── Quick replies ── */}
        <View style={[styles.quickWrap, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quick}>
            {QUICK.map(({ label, icon }) => (
              <Pressable
                key={label}
                onPress={() => send(label)}
                style={({ pressed }) => [
                  styles.chip,
                  { borderColor: pressed ? colors.teal : colors.border,
                    backgroundColor: pressed ? colors.tealFill : colors.surface2 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('messages.quickReplyA11y', { label })}
              >
                <Icon name={icon} size={12} color={colors.teal} />
                <Text style={[styles.chipText, { color: colors.textSecondary }]}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* ── Composer ── */}
        {/* Padded past the floating tab island so the input is never covered
            by (or typed under) the glass bar. */}
        <View style={[styles.composerOuter, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: kbOpen ? space[3] : insets.bottom + TAB_BAR_CLEARANCE }]}>
          {/* Reply / edit context bar */}
          {(replyTo || editing) ? (
            <View style={[styles.contextBar, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <View style={[styles.contextStripe, { backgroundColor: colors.teal }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.contextTitle, { color: colors.teal }]}>
                  {editing
                    ? t('messages.editingMessage')
                    : replyTo.from === 'driver'
                      ? t('messages.replyingToYourself')
                      : t('messages.replyingTo', { name: dispatcher?.name || t('messages.dispatcherFallback') })}
                </Text>
                <Text style={[styles.contextText, { color: colors.textMuted }]} numberOfLines={1}>
                  {kindLabel((editing || replyTo).kind, t) || (editing || replyTo).text || ''}
                </Text>
              </View>
              <Pressable onPress={cancelCompose} hitSlop={8} style={styles.contextClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
                <Icon name="x" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}

          {/* Staged photos, newest to the right. Each carries its own × so a
              mis-tap is undoable before anything reaches dispatch. */}
          {pendingPhotos.length > 0 && !voice.recording ? (
            <View style={styles.trayWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.trayRow}
                keyboardShouldPersistTaps="handled"
              >
                {pendingPhotos.map((p) => (
                  <View key={p.id} style={styles.trayItem}>
                    <Image source={{ uri: p.uri }} style={styles.trayThumb} resizeMode="cover" />
                    <Pressable
                      onPress={() => removePendingPhoto(p.id)}
                      hitSlop={8}
                      style={[styles.trayRemove, { backgroundColor: colors.surface }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('messages.removePhotoA11y')}
                    >
                      <Icon name="x" size={12} color={colors.textPrimary} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Text style={[styles.trayCount, { color: colors.textMuted }]}>
                {t('messages.photosSelected', { count: pendingPhotos.length })}
              </Text>
            </View>
          ) : null}

          {voice.recording ? (
            <RecordingBar elapsed={voice.elapsed} onCancel={voice.cancel} onSend={voice.stop} />
          ) : (
            <View style={[styles.composerInner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Pressable
                onPress={() => setAttachMenuOpen(true)}
                style={styles.attachBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('messages.attachA11y')}
              >
                <Icon name="paperclip" size={18} color={colors.textMuted} />
              </Pressable>
              <TextInput
                value={text}
                onChangeText={handleTextChange}
                placeholder={
                  editing ? t('messages.editPlaceholder')
                    : pendingPhotos.length > 0 ? t('messages.captionPlaceholder')
                      : t('messages.messagePlaceholder')
                }
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.textPrimary }]}
                multiline
                numberOfLines={1}
                onSubmitEditing={() => send()}
              />
              {/* Staged photos make send available on their own — an album with
                  no caption is a perfectly normal message. */}
              {text.trim() || pendingPhotos.length > 0 ? (
                <Pressable
                  onPress={() => send()}
                  disabled={sendingPhotos}
                  style={[styles.sendBtn, { backgroundColor: colors.teal, opacity: sendingPhotos ? 0.5 : 1 }, shadow.glow(colors.teal)]}
                  accessibilityLabel={editing ? t('messages.saveEditA11y') : t('messages.sendA11y')}
                >
                  <Icon name={editing ? 'check' : 'arrow-up'} size={19} color={colors.onAccent} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={voice.start}
                  style={[styles.micBtn]}
                  accessibilityRole="button"
                  accessibilityLabel={t('messages.recordVoiceA11y')}
                >
                  <LinearGradient colors={colors.gradients.teal} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.micBtnFill}>
                    <Icon name="mic" size={19} color={colors.onAccent} />
                  </LinearGradient>
                </Pressable>
              )}
            </View>
          )}
        </View>

      </Animated.View>

      {/* ── Attach: Photo / Document ── */}
      <AttachMenuSheet
        visible={attachMenuOpen}
        colors={colors}
        styles={styles}
        onClose={() => setAttachMenuOpen(false)}
        onPhoto={pickAttachment}
        onDocument={pickDocument}
      />

      {/* ── Long-press focused menu: message lifts in place, everything else blurs ──
          onDelete fires only once that overlay has fully dismissed (see closeThen
          inside it) — opening this confirm Modal while the overlay's own Modal was
          still on screen is what froze the whole screen on iOS. */}
      <FocusedMessageOverlay
        focus={focus}
        colors={colors}
        styles={styles}
        onClose={() => setFocus(null)}
        onReact={react}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={(m, canEveryone) => setConfirmDel({ msg: m, canEveryone })}
        onSaveToDocs={saveToDocuments}
      />

      {/* ── Save to Documents: review/tag before it's filed ──
          Deliberately NOT a <Modal> for the busy state — the download runs
          right after the focused overlay dismisses, and stacking another
          presented view controller there is the collision that froze this
          screen before. A plain absolute overlay has no such problem. */}
      {docSaveBusy ? (
        <View style={styles.docSaveBusy} pointerEvents="auto">
          <View style={[styles.docSaveBusyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.teal} />
            <Text style={[styles.docSaveBusyText, { color: colors.textPrimary }]}>{t('messages.preparingDocument')}</Text>
          </View>
        </View>
      ) : null}

      <DocumentReviewModal
        visible={!!docSaveAsset}
        asset={docSaveAsset}
        extraction={null}
        extractionError={null}
        driverId={user?.id}
        onSaved={() => { setDocSaveAsset(null); haptics.success(); }}
        onCancel={() => setDocSaveAsset(null)}
        colors={colors}
      />

      {/* ── Delete confirmation ── */}
      <ConfirmDelete
        pending={confirmDel}
        colors={colors}
        styles={styles}
        onCancel={() => setConfirmDel(null)}
        onConfirm={confirmDelete}
      />

      {/* ── Fullscreen photo viewer ── */}
      {viewer ? (
        <PhotoViewer
          uris={viewer.uris}
          index={viewer.index}
          msg={viewer.msg}
          filename={viewer.msg?.filename || 'photo.jpg'}
          onClose={() => setViewer(null)}
          onSendReply={(body) => {
            // Replies to the photo quote its message and leave the viewer open.
            sendMessage(user?.id, body, viewer.msg?.id || null)
              .then(load)
              .catch(() => haptics.error());
          }}
          onReact={(emoji) => viewer.msg && react(viewer.msg, emoji)}
          // Both of these open another Modal. Presenting one while the viewer
          // is still up is the iOS collision that freezes the screen, so the
          // viewer closes first and the action is re-raised on the next tick,
          // once its dismissal has actually run.
          onSaveToDocs={() => {
            const m = viewer.msg;
            setViewer(null);
            if (m) setTimeout(() => saveToDocuments(m), MODAL_HANDOFF_MS);
          }}
          onDelete={() => viewer.msg && setConfirmDelAfterViewer({
            msg: viewer.msg,
            // Same rule the long-press menu applies (messages.js:1712) — own
            // message, still inside the backend's delete-for-everyone window.
            // Omitting it would silently downgrade every delete to "for me".
            canEveryone: viewer.msg.from === 'driver' && ageMin(viewer.msg.ts) < DELETE_WINDOW_MIN,
          })}
          onEdit={(uri) => {
            const m = viewer.msg;
            setViewer(null);
            setTimeout(() => setMarkup({ uri, msg: m }), MODAL_HANDOFF_MS);
          }}
        />
      ) : null}

      {markup ? (
        <PhotoEditor
          uri={markup.uri}
          onCancel={() => setMarkup(null)}
          onDone={handleMarkupDone}
        />
      ) : null}
    </ScreenFade>
  );
}

/* ─────────── Sub-components ─────────── */

function DateSeparator({ label, colors, styles }) {
  return (
    <View style={styles.dateSep}>
      <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
      <View style={[styles.datePill, { backgroundColor: colors.surfaceHi }]}>
        <Text style={[styles.datePillText, { color: colors.textMuted }]}>{label}</Text>
      </View>
      <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

// The visual shell of a bubble (shape + gradient/deleted styling + body),
// factored out of Bubble so the long-press focused-message overlay can render
// an exact-looking clone of the pressed message without duplicating the
// gradient/deleted/theirs branching logic.
// Messenger-style: every bubble gets the same uniform pill radius regardless
// of its position in a grouped run — grouping reads purely from spacing and
// avatar placement (see Bubble below), not from a cut "tail" corner.
function BubbleVisual({ msg, mine, colors, styles, onOpenImage, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const bubbleStyle = [
    styles.bubble,
    mine ? styles.bubbleMine : [styles.bubbleTheirs, { backgroundColor: colors.surface, borderColor: colors.border }],
    msg.failed && { opacity: 0.55 },
  ];

  const body = (
    <BubbleBody
      msg={msg} mine={mine} colors={colors} styles={styles} onOpenImage={onOpenImage}
      onBubbleDoubleTap={onBubbleDoubleTap} onBubbleLongPress={onBubbleLongPress} onBubbleToggleReveal={onBubbleToggleReveal}
    />
  );

  // A photo with nothing else to say needs no bubble — the gradient and its
  // padding only framed the image in a coloured border. Every chat app renders
  // a bare photo, and it lets the picture run to the full bubble width instead
  // of losing 32pt to horizontal padding. A caption, reply quote or failure
  // state brings the bubble back, because then there is something to hold.
  const bare = !msg.deleted
    && msg.kind === 'image'
    && !msg.text
    && !msg.replyTo
    && !msg.failed;
  if (bare) {
    return <View style={[styles.bareMedia, msg.uploading && styles.bareMediaSending]}>{body}</View>;
  }

  if (msg.deleted) {
    return <View style={[bubbleStyle, { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1 }]}>{body}</View>;
  }
  if (mine) {
    // Brand teal→navy gradient with white ink — the driver's "voice" in the
    // thread. A soft teal glow lifts it off the near-black background.
    return (
      <LinearGradient colors={colors.gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[bubbleStyle, styles.bubbleMineGlow]}>
        {body}
      </LinearGradient>
    );
  }
  return <View style={bubbleStyle}>{body}</View>;
}

// prevFrom/nextFrom are the senders of the neighbouring messages WITHIN the
// same day, resolved upstream by buildChatRows — a virtualized row can't reach
// its siblings, and grouping must not span a date separator.
function Bubble({ msg, prevFrom, nextFrom, colors, styles, onAction, onReactQuick, onDoubleTap, onOpenImage, onCallBack, onRetry, revealed, onToggleReveal, showSeen, dispatcher }) {
  const t = useT();
  const mine = msg.from === 'driver';
  const prevSame = prevFrom === msg.from;
  const nextSame = nextFrom === msg.from;
  const showAvatar = !mine && !nextSame;
  const hasReactions = msg.reactions?.length > 0;

  // Gentle entrance — runs once when a bubble first mounts (stable m.id keys
  // mean existing bubbles don't re-animate on every poll/re-render).
  const reduce = useReduceMotion();
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(enter, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, []);

  // Messenger-style reveal-on-tap timestamp: an Animated height/opacity this
  // bubble owns and drives itself off the `revealed` prop — top-anchored, so
  // it always expands downward from directly under the bubble, never from
  // the bottom of the screen. Height can't use the native driver, but it's a
  // single small row so the JS-thread cost is negligible.
  const revealAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(revealAnim, { toValue: revealed ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [revealed, revealAnim]);

  // Missed calls are a system-style event, not a directional chat bubble —
  // render as a centered card (like a date separator) instead of the usual
  // left/right gradient bubble, so it reads distinctly at a glance.
  if (msg.kind === 'missed_call' && !msg.deleted) {
    return <MissedCallCard msg={msg} mine={mine} colors={colors} styles={styles} enter={enter} onCallBack={onCallBack} />;
  }

  const pressableRef = useRef(null);
  const lastTapRef = useRef(0);
  const [showHeart, setShowHeart] = useState(false);
  const heartBurst = useRef(new Animated.Value(0)).current;

  const fireHeartBurst = useCallback(() => {
    if (reduce) return; // still reacts — just skip the pop animation
    setShowHeart(true);
    heartBurst.setValue(0);
    Animated.timing(heartBurst, { toValue: 1, duration: 650, useNativeDriver: true })
      .start(() => setShowHeart(false));
  }, [heartBurst, reduce]);

  // Double-tap-to-heart, WhatsApp/Instagram-style: two taps inside the window
  // hearts the message (or un-hearts it if you already had); a lone tap does
  // nothing on its own. Returns whether this call WAS the completing tap of a
  // double-tap, so attachment bubbles (voice/document/video/image) — which
  // have their own tap-to-play/open Pressable and call this from inside it —
  // can skip re-running their primary action on that specific tap instead of
  // e.g. toggling voice playback on/off again or re-opening a document.
  const registerDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      onDoubleTap?.();
      fireHeartBurst();
      haptics.tap();
      return true;
    }
    lastTapRef.current = now;
    return false;
  }, [onDoubleTap, fireHeartBurst]);

  // Long-press: measure the bubble's live on-screen position so the focused
  // overlay can "lift" it from exactly where it already is instead of
  // reopening a generic bottom sheet. Reads off `pressableRef` — the OUTER
  // wrapper below — regardless of which element the touch actually landed
  // on, so attachment bubbles report the same accurate rect as text bubbles.
  const handleLongPress = useCallback(() => {
    pressableRef.current?.measureInWindow?.((x, y, width, height) => {
      haptics.press();
      onAction?.({ x, y, width, height }, mine);
    });
  }, [onAction, mine]);

  // Messenger-style: a single tap that isn't the completing half of a
  // double-tap reveals/hides this message's timestamp instead of doing
  // nothing. Which message is revealed lives in MessagesScreen (`revealed`
  // prop) so opening one closes any other that was open.
  const handlePress = useCallback(() => {
    const isDouble = registerDoubleTap();
    if (!isDouble) onToggleReveal?.();
  }, [registerDoubleTap, onToggleReveal]);

  // Voice/document/video/image bubbles nest their OWN Pressable (play button,
  // open-document row, thumbnail) for their tap-to-act behavior. In React
  // Native a touch landing on a nested Pressable is claimed entirely by that
  // inner Pressable — the outer one below never sees onPress/onLongPress for
  // it. So those attachment components are handed these same functions and
  // call them directly from their own Pressable's onPress/onLongPress — see
  // BubbleBody's isImage branch and VoicePlayable/DocumentAttachment/
  // VideoAttachment below.
  const inner = (
    <BubbleVisual
      msg={msg} mine={mine} colors={colors} styles={styles} onOpenImage={onOpenImage}
      onBubbleDoubleTap={registerDoubleTap} onBubbleLongPress={handleLongPress} onBubbleToggleReveal={onToggleReveal}
    />
  );

  return (
    <>
      <Animated.View style={[
        styles.bubbleRow,
        mine ? styles.rowMine : styles.rowTheirs,
        prevSame ? { marginTop: 3 } : { marginTop: 10 },
        { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
      ]}>
        {/* Dispatcher avatar — shown only on last bubble in group */}
        {!mine ? (
          showAvatar ? (
            <PeerAvatar photoUrl={dispatcher?.photoUrl} name={dispatcher?.name} size={34} />
          ) : (
            <View style={{ width: 34 }} />
          )
        ) : null}

        <View style={{ maxWidth: '78%', minWidth: 0, alignItems: mine ? 'flex-end' : 'flex-start' }}>
          {/* No accessibilityRole="button" here — this wrapper reacts to
              long-press, double-tap, and a plain tap (reveal timestamp), and
              voice bubbles nest a real play/pause button inside it. On web,
              "button" role renders an actual <button>, and a <button> can't
              contain another <button>. */}
          <Pressable
            ref={pressableRef}
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={280}
            disabled={msg.deleted}
            accessibilityLabel={t('messages.longPressOptionsA11y')}
            style={{ position: 'relative' }}
          >
            {inner}
            {showHeart ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.heartBurst,
                  {
                    opacity: heartBurst.interpolate({ inputRange: [0, 0.12, 0.65, 1], outputRange: [0, 1, 1, 0] }),
                    transform: [{ scale: heartBurst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.25, 1] }) }],
                  },
                ]}
              >
                <Text style={styles.heartBurstEmoji}>{HEART_EMOJI}</Text>
              </Animated.View>
            ) : null}
          </Pressable>

          {hasReactions ? (
            <View style={[styles.reactRow, mine ? { justifyContent: 'flex-end' } : null]}>
              {msg.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  onPress={() => onReactQuick?.(r.emoji)}
                  style={[styles.reactChip, { backgroundColor: colors.surfaceHi, borderColor: r.mine ? colors.teal : colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.emoji} ${r.count}`}
                >
                  <Text style={styles.reactEmoji}>{r.emoji}</Text>
                  {r.count > 1 ? <Text style={[styles.reactCount, { color: colors.textMuted }]}>{r.count}</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {msg.failed ? (
            <View style={[styles.failedRow, mine ? { justifyContent: 'flex-end' } : null]}>
              <Icon name="alert-circle" size={11} color={colors.danger} />
              <Text style={[styles.failedText, { color: colors.danger }]}>{t('messages.notSent')}</Text>
              {/* Without this a failed album meant re-picking every photo from
                  the library again — the uris are still in hand, so offer them. */}
              {msg.retry ? (
                <Pressable onPress={() => onRetry?.(msg)} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.retryText, { color: colors.teal }]}>{t('common.retry')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Messenger-style "seen" indicator — the dispatcher's tiny avatar
              under the last driver-sent message their read cursor has passed,
              instead of WhatsApp-style checkmarks on every sent message. */}
          {showSeen ? (
            <View style={styles.seenRow}>
              <PeerAvatar photoUrl={dispatcher?.photoUrl} name={dispatcher?.name} size={16} />
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* Messenger-style: collapsed to nothing by default, expands downward
          from directly under the bubble it belongs to when tapped (see
          handlePress above) — always mounted so both opening AND a different
          message's row closing animate, instead of just popping away. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.revealedTimeRow,
          { height: revealAnim.interpolate({ inputRange: [0, 1], outputRange: [0, REVEALED_ROW_HEIGHT] }), opacity: revealAnim },
        ]}
      >
        <Text style={styles.revealedTimeText}>
          {msg.editedAt ? `${t('messages.edited')} · ` : ''}{msg.at}
        </Text>
      </Animated.View>
    </>
  );
}

// Centered system-style event card for a missed call — distinct from the
// left/right chat bubbles so a missed call reads at a glance instead of
// blending into the message stream as plain text. `mine` means the driver
// placed the call and it went unanswered; otherwise the dispatcher called
// and the driver missed it, so a one-tap "Call back" is worth surfacing.
function MissedCallCard({ msg, mine, colors, styles, enter, onCallBack }) {
  const t = useT();
  return (
    <Animated.View style={[
      styles.missedCallCardRow,
      { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
    ]}>
      <View style={[styles.missedCallCard, { backgroundColor: colors.dangerFill, borderColor: colors.danger }]}>
        <View style={[styles.missedCallIcon, { backgroundColor: colors.danger }]}>
          <Icon family="material-community" name="phone-missed" size={16} color={colors.onAccent} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.missedCallTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {mine ? t('messages.missedCall') : t('messages.missedCallFromDispatcher')}
          </Text>
          <Text style={[styles.missedCallSub, { color: colors.textMuted }]} numberOfLines={1}>
            {mine ? t('messages.dispatcherNoPickup') : t('messages.youNoPickup')} · {msg.at}
          </Text>
        </View>

        {!mine ? (
          <Pressable
            onPress={onCallBack}
            style={[styles.missedCallBtn, { backgroundColor: colors.teal }]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.callDispatcherBackA11y')}
          >
            <Icon family="ionicons" name="call" size={13} color={colors.onAccent} />
            <Text style={[styles.missedCallBtnText, { color: colors.onAccent }]}>{t('messages.callBack')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

// Messenger-style: no time/edited/read chrome lives in the content itself
// anymore — Bubble renders the reveal-on-tap timestamp and the "seen" avatar
// outside of this, so BubbleBody only ever renders the message's actual
// content (reply quote + the kind-specific body).
// Natural pixel sizes keyed by uri. A module-level cache because FlatList
// recycles chat rows: without it, every scroll past a photo re-measures it and
// the bubble visibly snaps from placeholder to final shape again.
const imageSizeCache = new Map();

/**
 * Resolves a photo's display size, preserving its real aspect ratio.
 *
 * A single fixed box was the old behaviour and it cropped every portrait photo
 * to a landscape letterbox — which is most phone photos, and exactly the shape
 * a driver uses for a trailer door or a full page of paperwork.
 *
 * Dimensions come from the message when the sender recorded them (no flicker),
 * otherwise from Image.getSize once the URL resolves. Until either lands the
 * caller renders a placeholder at `null`.
 */
function usePhotoSize(uri, width, height) {
  const known = width > 0 && height > 0 ? { width, height } : imageSizeCache.get(uri) || null;
  const [measured, setMeasured] = useState(known);

  useEffect(() => {
    if (known) { setMeasured(known); return; }
    if (!uri) return;
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (!(w > 0 && h > 0)) return;
        imageSizeCache.set(uri, { width: w, height: h });
        if (alive) setMeasured({ width: w, height: h });
      },
      // A failure here is not fatal — the bubble falls back to a default box
      // and the <Image> shows whatever it can.
      () => {},
    );
    return () => { alive = false; };
  }, [uri, known?.width, known?.height]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!measured) return null;
  const ratio = measured.width / measured.height;
  let w = PHOTO_MAX_W;
  let h = w / ratio;
  if (h > PHOTO_MAX_H) { h = PHOTO_MAX_H; w = h * ratio; }
  // Panoramas and very tall shots would otherwise become slivers.
  return { width: Math.max(PHOTO_MIN_EDGE, Math.round(w)), height: Math.max(PHOTO_MIN_EDGE, Math.round(h)) };
}

// A single photo, sized to its own shape, with a shimmer standing in until both
// the dimensions and the bytes have arrived.
function SinglePhoto({ uri, sizeFrom, width, height, styles, onPress, onLongPress, label }) {
  // Measured off the full-size URL, not the thumbnail: both share an aspect
  // ratio, and the full one is what the cache is keyed on elsewhere.
  const size = usePhotoSize(sizeFrom || uri, width, height);
  const [loaded, setLoaded] = useState(false);
  const box = size || { width: PHOTO_MAX_W, height: Math.round(PHOTO_MAX_W * 0.75) };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.photoFrame, box]}
    >
      {/* A neutral scrim, not the theme Skeleton: inside a teal sent-bubble the
          shimmer read as a big empty coloured panel rather than a photo on its
          way. A dim overlay plus a spinner says "loading" unambiguously. */}
      {!loaded ? (
        <View style={[StyleSheet.absoluteFill, styles.photoLoading]}>
          <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}
      <Image
        source={{ uri }}
        style={[box, { opacity: loaded ? 1 : 0 }]}
        resizeMode="cover"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </Pressable>
  );
}

// Messenger-style album. One photo takes its own aspect ratio; two sit side by
// side; three puts the odd one across the row beneath; four tile 2×2; beyond
// four we show the first four with a "+N" over the last, because a bubble that
// grows without bound pushes the rest of the thread off screen.
//
// Multi-photo tiles stay square on purpose — a grid of mixed aspect ratios
// reads as broken, and the viewer shows each photo whole anyway.
function PhotoAlbum({ uris, thumbUris, width, height, msg, styles, onOpen, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const t = useT();
  const list = uris || [];
  if (list.length === 0) return null;

  // Bubbles show the small companion image; the viewer always gets the full one.
  const thumbs = thumbUris?.length === list.length ? thumbUris : list;
  const shown = list.slice(0, 4);
  const overflow = list.length - shown.length;

  // The viewer opens on the whole album at the tapped photo, so the driver can
  // swipe through the rest instead of closing and reopening for each one.
  const press = (i) => () => {
    const isDouble = onBubbleDoubleTap?.();
    if (!isDouble) { onOpen?.(list, i, msg); onBubbleToggleReveal?.(); }
  };

  if (list.length === 1) {
    return (
      <SinglePhoto
        uri={thumbs[0]}
        sizeFrom={list[0]}
        width={width}
        height={height}
        styles={styles}
        onPress={press(0)}
        onLongPress={onBubbleLongPress}
        label={t('messages.openPhotoA11y')}
      />
    );
  }

  // Explicit rows rather than a wrapping grid: percentage widths plus a gap
  // overflow the container, and three photos in a 2×2 would leave a hole. Two
  // per row, with an odd third spanning the full width underneath.
  const rows = shown.length === 3
    ? [shown.slice(0, 2), shown.slice(2)]
    : shown.length === 2 ? [shown]
      : [shown.slice(0, 2), shown.slice(2)].filter((r) => r.length > 0);

  let index = -1;
  return (
    <View
      style={styles.album}
      accessibilityLabel={t('messages.photoAlbumA11y', { count: list.length })}
    >
      {rows.map((row, r) => (
        <View key={r} style={styles.albumRow}>
          {row.map((uri) => {
            index += 1;
            const isLastShown = index === shown.length - 1;
            return (
              <Pressable
                key={uri || index}
                onPress={press(index)}
                onLongPress={onBubbleLongPress}
                delayLongPress={280}
                style={styles.albumTile}
                accessibilityRole="button"
                accessibilityLabel={t('messages.openPhotoA11y')}
              >
                <Image source={{ uri: thumbs[index] || uri }} style={styles.albumImage} resizeMode="cover" />
                {isLastShown && overflow > 0 ? (
                  <View style={styles.albumOverflow}>
                    <Text style={styles.albumOverflowText}>{`+${overflow}`}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function BubbleBody({ msg, mine, colors, styles, onOpenImage, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const t = useT();
  const ink = mine ? '#FFFFFF' : colors.textPrimary;

  if (msg.deleted) {
    return (
      <Text style={[styles.deletedText, { color: colors.textMuted }]}>{t('messages.messageDeleted')}</Text>
    );
  }

  const isVoice = msg.kind === 'voice';
  const isImage = msg.kind === 'image';
  const isDocument = msg.kind === 'document';
  const isVideo = msg.kind === 'video';

  return (
    <>
      {msg.replyTo ? (
        <View style={[styles.replyQuote, {
          borderLeftColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal,
          backgroundColor: mine ? 'rgba(255,255,255,0.12)' : colors.surface2,
        }]}>
          <Text style={[styles.replyQuoteName, { color: mine ? 'rgba(255,255,255,0.9)' : colors.teal }]} numberOfLines={1}>
            {msg.replyTo.from === 'driver' ? t('messages.you') : t('messages.dispatcherFallback')}
          </Text>
          <Text style={[styles.replyQuoteText, { color: mine ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]} numberOfLines={1}>
            {kindLabel(msg.replyTo.kind, t) || msg.replyTo.text || ''}
          </Text>
        </View>
      ) : null}

      {isImage ? (
        <View>
          <PhotoAlbum
            uris={msg.uris?.length ? msg.uris : [msg.uri].filter(Boolean)}
            thumbUris={msg.thumbUris}
            width={msg.width}
            height={msg.height}
            msg={msg}
            styles={styles}
            onOpen={onOpenImage}
            onBubbleDoubleTap={onBubbleDoubleTap}
            onBubbleLongPress={onBubbleLongPress}
            onBubbleToggleReveal={onBubbleToggleReveal}
          />
          {/* While the bytes are still going up. Without it a driver on weak LTE
              sees a finished-looking bubble and taps send again. */}
          {msg.uploading ? (
            <View style={styles.uploadVeil} pointerEvents="none">
              <Text style={styles.uploadPct}>{`${Math.round((msg.progress || 0) * 100)}%`}</Text>
              <View style={styles.uploadTrack}>
                <View style={[styles.uploadFill, { width: `${Math.round((msg.progress || 0) * 100)}%` }]} />
              </View>
            </View>
          ) : null}
        </View>
      ) : isVoice ? (
        msg.uri
          ? <VoicePlayable uri={msg.uri} durationSec={msg.durationSec} waveformPeaks={msg.waveformPeaks} mine={mine} colors={colors} styles={styles} onBubbleDoubleTap={onBubbleDoubleTap} onBubbleLongPress={onBubbleLongPress} onBubbleToggleReveal={onBubbleToggleReveal} />
          : <VoiceStatic durationSec={msg.durationSec} waveformPeaks={msg.waveformPeaks} mine={mine} colors={colors} styles={styles} />
      ) : isDocument ? (
        <DocumentAttachment msg={msg} mine={mine} colors={colors} styles={styles} onBubbleDoubleTap={onBubbleDoubleTap} onBubbleLongPress={onBubbleLongPress} onBubbleToggleReveal={onBubbleToggleReveal} />
      ) : isVideo ? (
        <VideoAttachment msg={msg} mine={mine} colors={colors} styles={styles} onBubbleDoubleTap={onBubbleDoubleTap} onBubbleLongPress={onBubbleLongPress} onBubbleToggleReveal={onBubbleToggleReveal} />
      ) : (
        <Text style={[styles.bubbleText, { color: ink }]}>{msg.text}</Text>
      )}
    </>
  );
}

// The iMessage-style long-press menu: the pressed bubble "lifts" from exactly
// where it was measured (see Bubble's handleLongPress), the rest of the
// screen blurs behind it, a row of quick reactions floats above/below it, and
// Reply/Edit/Delete float as a second panel — all anchored to the message's
// real on-screen position instead of a generic bottom sheet.
function FocusedMessageOverlay({ focus, colors, styles, onClose, onReact, onReply, onEdit, onDelete, onSaveToDocs }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  // Keep rendering the last focus while the close animation plays out, so the
  // menu fades/scales away instead of vanishing the instant it's dismissed.
  const [held, setHeld] = useState(focus);

  useEffect(() => {
    if (focus) {
      setHeld(focus);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 190, useNativeDriver: true }).start();
    }
  }, [focus, anim]);

  const close = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setHeld(null);
      onClose();
    });
  }, [anim, onClose]);

  // Anything that opens ANOTHER <Modal> has to wait for this one to be gone.
  // On iOS a Modal is a presented UIViewController, and presenting a second one
  // while this is still on screen (it lingers through the 140ms fade above)
  // leaves an orphaned presentation that eats every touch — the app looks
  // frozen until it's reloaded. `onDismiss` fires once the dismissal actually
  // completes; on Android it never fires and stacking is harmless, so the
  // action runs inline there. Same pattern as AttachMenuSheet.
  const pendingRef = useRef(null);

  const runPending = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }, []);

  const closeThen = useCallback((action) => {
    pendingRef.current = action;
    close();
    if (Platform.OS !== 'ios') runPending();
  }, [close, runPending]);

  // The <Modal> below stays MOUNTED even when there's nothing focused, and only
  // toggles `visible`. Returning null here instead would unmount it, destroying
  // the native RCTModalHostView before it can deliver onDismiss — and that
  // event is what runs the deferred action, so Delete silently did nothing.
  // (AttachMenuSheet works precisely because it never unmounts.)
  const active = focus || held;
  return (
    <Modal visible={!!active} transparent animationType="none" onRequestClose={close} onDismiss={runPending}>
      {active ? renderFocusedBody() : null}
    </Modal>
  );

  function renderFocusedBody() {
    const { msg, anchor, mine } = active;
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const REACTION_H = 56;
    const GAP = 10;
    const isText = msg && !msg.kind;
    const canEdit = mine && isText && ageMin(msg?.ts) < EDIT_WINDOW_MIN;
    // "Delete for everyone" is the sender's, and only inside the window the
    // backend enforces. "Delete for me" has neither restriction — it just hides
    // the row for this driver — so the Delete action is always offered and the
    // sheet below decides which scopes to put on it. Previously the whole action
    // disappeared once the window lapsed, which read as "this app has no delete".
    const canDeleteForEveryone = mine && ageMin(msg?.ts) < DELETE_WINDOW_MIN;
    // Paperwork can be filed into the Documents tab from either side of the
    // thread: the dispatcher sends a rate confirmation, or the driver
    // photographs a signed BOL and wants their own copy on file. Gated on the
    // attachment kind rather than the sender, so there's no invisible rule
    // about which bubbles offer it. Voice/video/gif/sticker are excluded —
    // nothing there belongs in a tab built around credential expiry.
    const canSaveToDocs = msg?.kind === 'document' || msg?.kind === 'image';
    const actionCount = 2 + (canEdit ? 1 : 0) + (canSaveToDocs ? 1 : 0);
    const ACTIONS_H = actionCount * 50 + space[2] * 2;
    const stackH = REACTION_H + GAP + anchor.height + GAP + ACTIONS_H;

    const minTop = insets.top + space[3];
    const maxTop = Math.max(minTop, screenH - insets.bottom - space[3] - stackH);
    const groupTop = Math.max(minTop, Math.min(anchor.y - REACTION_H - GAP, maxTop));

    const reactionTop = groupTop;
    const bubbleTop = groupTop + REACTION_H + GAP;
    const actionsTop = bubbleTop + anchor.height + GAP;

    const edgeLeft = anchor.x;
    const edgeRight = screenW - (anchor.x + anchor.width);
    const sideStyle = mine
      ? { right: Math.max(edgeRight, space[4]) }
      : { left: Math.max(edgeLeft, space[4]) };
    const panelWidth = Math.min(Math.max(anchor.width, 180), 260);

    const mineReaction = msg?.reactions?.find((r) => r.mine)?.emoji;
    const opacity = anim;
    const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

    return (
      <>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents={focus ? 'auto' : 'none'}>
          <BlurView intensity={45} tint={colors.isDay ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
        </Animated.View>

        <Animated.View
          pointerEvents={focus ? 'auto' : 'none'}
          style={[styles.focusReactions, sideStyle, { top: reactionTop, backgroundColor: colors.surfaceHi, borderColor: colors.border, opacity, transform: [{ scale }] }]}
        >
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => { onReact(msg, e); close(); }}
              style={[styles.focusReactionBtn, mineReaction === e && { backgroundColor: colors.tealFill, borderColor: colors.teal }]}
              accessibilityRole="button"
              accessibilityLabel={`React ${e}`}
            >
              <Text style={styles.focusReactionEmoji}>{e}</Text>
            </Pressable>
          ))}
        </Animated.View>

        <View pointerEvents="none" style={{ position: 'absolute', top: bubbleTop, left: anchor.x, width: anchor.width }}>
          <Animated.View style={{ opacity, transform: [{ scale }] }}>
            <BubbleVisual msg={msg} mine={mine} colors={colors} styles={styles} onOpenImage={() => {}} />
          </Animated.View>
        </View>

        <Animated.View
          pointerEvents={focus ? 'auto' : 'none'}
          style={[styles.focusActionsPanel, sideStyle, { top: actionsTop, width: panelWidth, backgroundColor: colors.surface, borderColor: colors.border, opacity, transform: [{ scale }] }]}
        >
          <SheetAction icon="corner-up-left" label={t('messages.reply')} colors={colors} styles={styles} onPress={() => { onReply(msg); close(); }} />
          {canEdit ? <SheetAction icon="edit-2" label={t('common.edit')} colors={colors} styles={styles} onPress={() => { onEdit(msg); close(); }} /> : null}
          {canSaveToDocs ? <SheetAction icon="folder-plus" label={t('messages.saveToDocuments')} colors={colors} styles={styles} onPress={() => closeThen(() => onSaveToDocs(msg))} /> : null}
          <SheetAction icon="trash-2" label={t('common.delete')} danger colors={colors} styles={styles} onPress={() => closeThen(() => onDelete(msg, canDeleteForEveryone))} />
        </Animated.View>
      </>
    );
  }
}

function SheetAction({ icon, label, danger, colors, styles, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sheetAction, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={18} color={danger ? colors.danger : colors.textSecondary} />
      <Text style={[styles.sheetActionText, { color: danger ? colors.danger : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

// iOS presents a <Modal> as a real UIViewController, and the image/document
// pickers are view controllers too. Launching one in the same tick as this
// sheet's dismissal put the two transitions on top of each other: either iOS
// refused the presentation outright, or the sheet's dismissal tore down the
// picker presented on top of it. Tapping Photo/Document just closed the sheet
// and did nothing at all.
//
// So the tap only *records* what to do, and the action runs once the sheet is
// genuinely gone: `onDismiss` fires after the dismissal completes on iOS. It
// never fires on Android, where presenting is safe anyway — hence the direct
// call there. Whichever path runs, it clears the ref first, so an action can
// never fire twice.
function AttachMenuSheet({ visible, colors, styles, onClose, onPhoto, onDocument }) {
  const t = useT();
  const pendingRef = useRef(null);

  const runPending = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }, []);

  const choose = useCallback((action) => {
    pendingRef.current = action;
    onClose();
    if (Platform.OS !== 'ios') runPending();
  }, [onClose, runPending]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={runPending}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
          <SheetAction icon="image" label={t('messages.photo')} colors={colors} styles={styles} onPress={() => choose(onPhoto)} />
          <SheetAction icon="file-text" label={t('messages.document')} colors={colors} styles={styles} onPress={() => choose(onDocument)} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Scope chooser, WhatsApp-style. "Delete for me" is always on offer; "Delete
// for everyone" only while the sender is still inside the backend's window
// (see canDeleteForEveryone), so the sheet never shows an action that would
// come back as a 400.
// Scope chooser, WhatsApp-style. "Delete for me" is always on offer; "Delete
// for everyone" only while the sender is still inside the backend's window
// (see canDeleteForEveryone), so the sheet never shows an action that would
// come back as a 400.
//
// It stays open until the delete actually lands. A failure is shown right here
// with the server's status rather than through Alert — an alert raised while
// this Modal dismisses would never appear on iOS (the same presented-view
// collision that froze the screen), which is exactly how a failing delete came
// to look like "nothing happens".
function ConfirmDelete({ pending, colors, styles, onCancel, onConfirm }) {
  const t = useT();
  const canEveryone = !!pending?.canEveryone;
  const [busy, setBusy] = useState(null);   // which scope is in flight
  const [failed, setFailed] = useState('');

  useEffect(() => { setBusy(null); setFailed(''); }, [pending]);

  const run = async (scope) => {
    if (busy) return;
    setBusy(scope);
    setFailed('');
    try {
      await onConfirm(scope);
    } catch (err) {
      setFailed(err?.status ? `${t('messages.deleteFailedBody')} (${err.status})` : (err?.message || t('messages.deleteFailedBody')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={!!pending} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.confirmIcon, { backgroundColor: colors.surface2, borderColor: colors.danger }]}>
            <Icon name="trash-2" size={24} color={colors.danger} />
          </View>
          <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>
            {failed ? t('messages.deleteFailedTitle') : t('messages.deleteMessageQ')}
          </Text>
          <Text style={[styles.confirmSub, { color: failed ? colors.danger : colors.textSecondary }]}>
            {failed || (canEveryone ? t('messages.deleteForEveryoneBody') : t('messages.deleteForMeOnlyBody'))}
          </Text>

          {canEveryone ? (
            <Pressable
              onPress={() => run('everyone')}
              disabled={!!busy}
              style={[styles.confirmDanger, { backgroundColor: colors.danger, opacity: busy && busy !== 'everyone' ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t('messages.deleteForEveryone')}
            >
              {busy === 'everyone'
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.confirmDangerText}>{t('messages.deleteForEveryone')}</Text>}
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => run('me')}
            disabled={!!busy}
            style={[canEveryone ? styles.confirmCancel : styles.confirmDanger,
              canEveryone ? { borderColor: colors.border } : { backgroundColor: colors.danger },
              { opacity: busy && busy !== 'me' ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.deleteForMe')}
          >
            {busy === 'me'
              ? <ActivityIndicator size="small" color={canEveryone ? colors.textPrimary : '#FFFFFF'} />
              : (
                <Text style={canEveryone
                  ? [styles.confirmCancelText, { color: colors.textPrimary }]
                  : styles.confirmDangerText}
                >
                  {t('messages.deleteForMe')}
                </Text>
              )}
          </Pressable>

          <Pressable onPress={onCancel} disabled={!!busy} style={[styles.confirmCancel, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Text style={[styles.confirmCancelText, { color: colors.textMuted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function TypingIndicator({ colors, styles, dispatcher }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i - 1) * 160),
        ])
      )
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);

  return (
    <View style={[styles.bubbleRow, styles.rowTheirs, { marginTop: 10 }]}>
      <PeerAvatar photoUrl={dispatcher?.photoUrl} name={dispatcher?.name} size={34} />
      <View style={[styles.typingBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[styles.typingDot, { backgroundColor: colors.textMuted, opacity: d, transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
          />
        ))}
      </View>
    </View>
  );
}

function VoiceStatic({ durationSec, waveformPeaks, mine, colors, styles }) {
  const ink = mine ? '#FFFFFF' : colors.teal;
  const heights = useMemo(() => barHeights(waveformPeaks), [waveformPeaks]);
  return (
    <View style={styles.voice}>
      <View style={[styles.playCircle, { borderColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal, backgroundColor: mine ? 'rgba(255,255,255,0.15)' : colors.tealFill }]}>
        <Icon name="play" size={14} color={ink} />
      </View>
      <View style={styles.waveform}>
        {heights.map((h, i) => (
          <View key={i} style={[styles.bar, { height: h, backgroundColor: ink, opacity: 0.45 }]} />
        ))}
      </View>
      <Text style={[styles.voiceTime, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
        0:{String(durationSec).padStart(2, '0')}
      </Text>
    </View>
  );
}

function VoicePlayable({ uri, durationSec, waveformPeaks, mine, colors, styles, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const heights = useMemo(() => barHeights(waveformPeaks), [waveformPeaks]);
  // GET /chat/messages/{id}/audio requires a JWT — a bare { uri } source sends
  // an unauthenticated request and 401s, so playback needs an authed source.
  //
  // Resolving that source is deferred to the first tap rather than done on
  // mount: a chat history can hold dozens of voice bubbles, and every one of
  // them renders a VoicePlayable. Eagerly loading a native player per bubble
  // means dozens of concurrent AVPlayer/ExoPlayer instances competing for the
  // device's audio session the moment the screen renders — which is exactly
  // the kind of thing that makes play() silently no-op without ever throwing
  // a catchable JS error. Only the bubble(s) actually tapped get a player.
  const [source, setSource] = useState(null);
  const pendingPlayRef = useRef(false);

  // Default updateInterval is 500ms, which reads as a stepped/jumpy waveform
  // on a clip this short — 100ms is expo-audio's own recommended value for a
  // smoothly animating progress indicator.
  const player = useAudioPlayer(source, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const ink = mine ? '#FFFFFF' : colors.teal;
  const playing = !!status?.playing;
  const dur = status?.duration || durationSec || 1;
  const cur = status?.currentTime || 0;
  const progress = Math.max(0, Math.min(1, dur ? cur / dur : 0));
  const remain = Math.max(0, Math.round(playing ? dur - cur : dur));

  // Once a just-requested source finishes loading, start the playback that
  // the tap asked for (setSource above only takes effect on the next render,
  // so play() can't be called in the same tap that requests the source).
  useEffect(() => {
    if (source && pendingPlayRef.current && status?.isLoaded) {
      pendingPlayRef.current = false;
      try { player.play(); } catch {}
    }
  }, [source, status?.isLoaded, player]);

  const toggle = async () => {
    try {
      if (playing) { player.pause(); return; }
      if (!source) {
        if (!uri) return;
        pendingPlayRef.current = true;
        const token = await getValidToken();
        setSource(token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri });
        return;
      }
      if (status?.didJustFinish || (dur && cur >= dur - 0.05)) player.seekTo(0);
      player.play();
    } catch {}
  };

  // A tap here is claimed entirely by THIS Pressable (React Native doesn't
  // bubble gesture responders to the ancestor bubble Pressable) — so long
  // press and double-tap-to-heart have to be wired up right here too, not
  // just on the outer wrapper. Skip re-toggling play/pause on the specific
  // tap that completes a double-tap so hearting a clip doesn't blip it.
  const handlePress = () => {
    const isDouble = onBubbleDoubleTap?.();
    if (!isDouble) { toggle(); onBubbleToggleReveal?.(); }
  };

  return (
    <Pressable style={styles.voice} onPress={handlePress} onLongPress={onBubbleLongPress} delayLongPress={280} accessibilityRole="button">
      <View style={[styles.playCircle, { borderColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal, backgroundColor: mine ? 'rgba(255,255,255,0.15)' : colors.tealFill }]}>
        <Icon name={playing ? 'pause' : 'play'} size={14} color={ink} />
      </View>
      <View style={styles.waveform}>
        {heights.map((h, i) => {
          const active = i / heights.length <= progress;
          return <View key={i} style={[styles.bar, { height: h, backgroundColor: ink, opacity: active ? 1 : 0.25 }]} />;
        })}
      </View>
      <Text style={[styles.voiceTime, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
        0:{String(remain).padStart(2, '0')}
      </Text>
    </Pressable>
  );
}

function fmtBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Documents/videos open externally (download → native share sheet) instead of
// previewing inline — this app has no in-app video player, and
// Sharing.shareAsync needs a local file rather than the remote R2 URL, so a
// download step happens either way.
function useOpenAttachment(msg, t) {
  const [opening, setOpening] = useState(false);
  const open = useCallback(async () => {
    if (!msg.uri || opening) return;
    setOpening(true);
    try {
      const result = await downloadChatAttachment(msg.uri, msg.filename || 'file');
      if (Platform.OS === 'web') {
        window.open(result.uri, '_blank');
      } else if (canPreview(result.uri)) {
        // Same in-app system viewer the Documents tab uses — a PDF the
        // dispatcher sent opens right here instead of bouncing out to Files.
        await previewAsync(result.uri);
      } else if (await Sharing.isAvailableAsync()) {
        // mimeType is Android-only and UTI iOS-only, so both go in — without
        // the UTI (and the extension downloadChatAttachment now puts on the
        // cache file) iOS can't tell what this is and offers nowhere to open it.
        await Sharing.shareAsync(result.uri, {
          mimeType: msg.mimeType || result.contentType,
          ...(result.uti ? { UTI: result.uti } : {}),
          dialogTitle: msg.filename || undefined,
        });
      } else {
        await Linking.openURL(msg.uri);
      }
    } catch {
      Alert.alert(t('messages.couldNotOpen'), t('messages.pleaseTryAgain'));
    } finally {
      setOpening(false);
    }
  }, [msg.uri, msg.filename, msg.mimeType, opening, t]);
  return { opening, open };
}

function DocumentAttachment({ msg, mine, colors, styles, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const t = useT();
  const { opening, open } = useOpenAttachment(msg, t);
  // Same nested-Pressable-claims-the-touch reasoning as VoicePlayable above —
  // long-press/double-tap need to be wired directly on this Pressable, and
  // the double-tap-completing tap skips re-opening the document.
  const handlePress = () => {
    const isDouble = onBubbleDoubleTap?.();
    if (!isDouble) { open(); onBubbleToggleReveal?.(); }
  };
  return (
    <Pressable
      style={styles.docCard}
      onPress={handlePress}
      onLongPress={onBubbleLongPress}
      delayLongPress={280}
      disabled={opening}
      accessibilityRole="button"
      accessibilityLabel={t('messages.openDocumentA11y', { filename: msg.filename || '' })}
    >
      <View style={[styles.docCardIcon, { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : colors.tealFill }]}>
        <Icon name={opening ? 'loader' : 'file-text'} size={18} color={mine ? '#FFFFFF' : colors.teal} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.docCardName, { color: mine ? '#FFFFFF' : colors.textPrimary }]}>
          {msg.filename || t('messages.documentFallback')}
        </Text>
        {msg.sizeBytes ? (
          <Text style={[styles.docCardSub, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
            {fmtBytes(msg.sizeBytes)}
          </Text>
        ) : null}
      </View>
      <Icon name="download" size={14} color={mine ? 'rgba(255,255,255,0.7)' : colors.textMuted} />
    </Pressable>
  );
}

function VideoAttachment({ msg, mine, colors, styles, onBubbleDoubleTap, onBubbleLongPress, onBubbleToggleReveal }) {
  const t = useT();
  const { opening, open } = useOpenAttachment(msg, t);
  // Same nested-Pressable-claims-the-touch reasoning as VoicePlayable above.
  const handlePress = () => {
    const isDouble = onBubbleDoubleTap?.();
    if (!isDouble) { open(); onBubbleToggleReveal?.(); }
  };
  return (
    <Pressable style={styles.videoCard} onPress={handlePress} onLongPress={onBubbleLongPress} delayLongPress={280} disabled={opening} accessibilityRole="button" accessibilityLabel={t('messages.openVideoA11y')}>
      {msg.thumbnailUri ? (
        <Image source={{ uri: msg.thumbnailUri }} style={styles.videoThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.videoThumb, styles.videoThumbPlaceholder, { backgroundColor: mine ? 'rgba(255,255,255,0.12)' : colors.surface2 }]}>
          <Icon name="film" size={22} color={mine ? '#FFFFFF' : colors.textMuted} />
        </View>
      )}
      <View style={styles.videoPlayBadge}>
        <Icon name={opening ? 'loader' : 'play'} size={16} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

const BAR_COUNT = 20;
const MIN_BAR_H = 4;
const MAX_BAR_H = 24;
// Generic pattern for clips with no real waveform data — recorded before
// this feature existed, or from any source that doesn't send peaks.
const FALLBACK_PEAKS = [0.05, 0.35, 0.15, 0.6, 0.3, 0.75, 0.1, 0.5, 0.08, 0.65, 0.4, 0.2, 0.55, 0.15, 0.45, 0.25, 0.6, 0.08, 0.5, 0.3];

// Maps a message's raw waveformPeaks string (or the fallback pattern) to the
// pixel bar heights a voice bubble actually draws.
function barHeights(waveformPeaksString) {
  const raw = parsePeaksString(waveformPeaksString);
  const peaks = raw.length ? resamplePeaks(raw, BAR_COUNT) : FALLBACK_PEAKS;
  return peaks.map((p) => MIN_BAR_H + Math.max(0, Math.min(1, p)) * (MAX_BAR_H - MIN_BAR_H));
}

const nowStr = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface },

  /* Header */
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space[4], paddingVertical: space[3],
    backgroundColor: c.surface, zIndex: 10, borderBottomWidth: 1,
  },
  peerInfo: { flexDirection: 'row', alignItems: 'center', gap: space[3], flex: 1, minWidth: 0 },
  peerName: { ...type.bodyStrong, fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  statusText: { ...type.caption },
  headerActions: { flexDirection: 'row', gap: space[2], marginLeft: space[3] },
  callBtn: { width: 44, height: 44, flexShrink: 0 },
  callBtnFill: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  videoBtn: {
    width: 44, height: 44, flexShrink: 0, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.tealFill,
    borderWidth: 1, borderColor: c.border,
  },

  /* Load banner */
  loadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: space[4], paddingVertical: 9, borderBottomWidth: 1,
  },
  loadBannerText: { ...type.caption, fontFamily: FONT.bold, flex: 1 },
  loadStatusPill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  loadStatusText: { fontSize: 10, fontFamily: FONT.black },

  /* Chat */
  // flex:1 lets the thread SHRINK when the keyboard padding is applied to the
  // wrapper — without it the fixed-height column overflows and the composer
  // sits under the keyboard instead of lifting above it.
  chatScroll: { flex: 1, backgroundColor: 'transparent' },
  threadGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 200 },
  chatContent: { padding: space[4], paddingBottom: space[6], gap: 0 },

  dateSep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: space[4] },
  dateLine: { flex: 1, height: 1 },
  datePill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  datePillText: { ...type.caption, fontSize: 11, fontFamily: FONT.bold },

  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },

  // Messenger-style: one uniform pill radius for every bubble — grouping
  // reads from spacing + avatar placement only, never a cut tail corner.
  bubble: { borderRadius: radius.xl, paddingHorizontal: space[4], paddingVertical: space[3], gap: 4, borderWidth: 0 },
  // A photo sent on its own: no gradient, no padding, just the rounded image.
  // No radius here on purpose — the photo rounds itself, and clipping twice at
  // two different radii leaves visible corner artifacts.
  bareMedia: {},
  bareMediaSending: { opacity: 0.9 },
  bubbleMine: {},
  bubbleMineGlow: { shadowColor: c.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5 },
  bubbleTheirs: { borderWidth: 1 },

  bubbleText: { ...type.body, lineHeight: 22 },
  // Single photo: the box comes from usePhotoSize, so only the chrome is here.
  photoFrame: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: 2, backgroundColor: 'rgba(0,0,0,0.22)' },
  photoLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },

  // Multi-photo album. Width matches the single-photo cap so a thread of mixed
  // messages keeps one left/right edge; tiles are square and share the row
  // evenly via flex, so a 3-photo album's last tile spans the full width.
  album: { width: PHOTO_MAX_W, gap: 3, marginBottom: 2, borderRadius: radius.lg, overflow: 'hidden' },
  albumRow: { flexDirection: 'row', gap: 3 },
  albumTile: { flex: 1, aspectRatio: 1, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.22)' },
  albumImage: { width: '100%', height: '100%' },
  albumOverflow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  albumOverflowText: { color: '#FFFFFF', fontSize: 20, fontFamily: FONT.bold, ...type.num },
  deletedText: { ...type.body, fontStyle: 'italic' },

  // Messenger-style: collapsed to 0 height by default, animates open downward
  // from directly under the tapped bubble (see Bubble's revealAnim).
  revealedTimeRow: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  revealedTimeText: { fontSize: 12, fontFamily: FONT.medium, color: c.textMuted, ...type.num },

  // Messenger-style "seen" indicator — dispatcher's tiny avatar under the
  // last driver-sent message they've read, instead of per-message checkmarks.
  seenRow: { marginTop: 3, alignItems: 'flex-end' },

  /* Document / video attachment cards */
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, maxWidth: 240, paddingVertical: 2 },
  docCardIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  docCardName: { fontSize: 13, fontFamily: FONT.bold },
  docCardSub: { fontSize: 11, fontFamily: FONT.medium, marginTop: 1 },
  videoCard: { width: 200, height: 150, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  videoThumb: { width: '100%', height: '100%', position: 'absolute' },
  videoThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  videoPlayBadge: { width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  /* Failed-to-send indicator */
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, marginHorizontal: 4 },
  retryText: { fontSize: 12, fontFamily: FONT.semibold, textDecorationLine: 'underline' },

  // Upload progress over an in-flight photo bubble.
  uploadVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.md,
  },
  uploadPct: { color: '#FFFFFF', fontSize: 15, fontFamily: FONT.bold, ...type.num },
  uploadTrack: { width: '62%', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  uploadFill: { height: '100%', backgroundColor: '#FFFFFF' },
  failedText: { fontSize: 11, fontFamily: FONT.medium },

  missedCallCardRow: { alignItems: 'center', marginVertical: space[2] },
  missedCallCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    maxWidth: '92%', borderWidth: 1, borderRadius: radius.lg,
    paddingHorizontal: space[3], paddingVertical: space[2] + 2,
  },
  missedCallIcon: { width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  missedCallTitle: { fontSize: 13, fontFamily: FONT.bold },
  missedCallSub: { fontSize: 11, fontFamily: FONT.medium, marginTop: 1 },
  missedCallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0,
    borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7,
  },
  missedCallBtnText: { fontSize: 12, fontFamily: FONT.bold },

  /* Reply quote inside a bubble */
  replyQuote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 5, gap: 1 },
  replyQuoteName: { fontSize: 11, fontFamily: FONT.bold },
  replyQuoteText: { fontSize: 12, fontFamily: FONT.medium },

  /* Reactions */
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, marginHorizontal: 4 },
  reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  reactEmoji: { fontSize: 12 },
  reactCount: { fontSize: 11, fontFamily: FONT.bold },

  /* Double-tap heart burst */
  heartBurst: {
    position: 'absolute', top: '50%', left: '50%', width: 80, height: 80,
    marginLeft: -40, marginTop: -40, alignItems: 'center', justifyContent: 'center',
  },
  heartBurstEmoji: { fontSize: 56 },

  /* Focused long-press menu (floating, anchored to the pressed bubble) */
  focusReactions: {
    position: 'absolute', flexDirection: 'row', gap: 2,
    borderRadius: radius.pill, borderWidth: 1, padding: 5, ...shadow.float,
  },
  focusReactionBtn: { width: 42, height: 42, borderRadius: 999, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  focusReactionEmoji: { fontSize: 22 },
  focusActionsPanel: {
    position: 'absolute', borderRadius: radius.lg, borderWidth: 1,
    paddingVertical: space[1], overflow: 'hidden', ...shadow.float,
  },

  /* Action sheet */
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], borderWidth: 1, paddingTop: space[3], paddingBottom: space[6], paddingHorizontal: space[3] },
  sheetEmojis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[2], paddingVertical: space[2], marginBottom: space[2] },
  sheetEmojiBtn: { width: 46, height: 46, borderRadius: 999, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  sheetEmoji: { fontSize: 24 },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: 14, borderRadius: radius.lg },
  sheetActionText: { ...type.body, fontFamily: FONT.bold },

  /* Delete confirmation */
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[5] },
  confirmCard: { width: '100%', maxWidth: 360, borderRadius: radius['2xl'], borderWidth: 1, padding: space[6], alignItems: 'center', gap: space[3] },
  confirmIcon: { width: 60, height: 60, borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  confirmTitle: { fontSize: 19, fontFamily: FONT.black, textAlign: 'center' },
  confirmSub: { ...type.caption, textAlign: 'center', lineHeight: 19 },
  confirmDanger: { width: '100%', height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  confirmDangerText: { ...type.bodyStrong, color: '#fff' },
  confirmCancel: { width: '100%', height: 48, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirmCancelText: { ...type.bodyStrong },

  /* Save-to-Documents busy state — a plain overlay, not a Modal (see usage) */
  docSaveBusy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  docSaveBusyCard: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingVertical: space[4], paddingHorizontal: space[5],
    borderRadius: radius.lg, borderWidth: 1,
  },
  docSaveBusyText: { ...type.bodyStrong },

  /* Fullscreen photo viewer */

  /* Reply / edit context bar */
  contextBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.lg, paddingVertical: 8, paddingRight: 8, paddingLeft: 0, marginBottom: space[2], overflow: 'hidden' },
  contextStripe: { width: 4, alignSelf: 'stretch', borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
  contextTitle: { fontSize: 12, fontFamily: FONT.bold },
  contextText: { fontSize: 12, fontFamily: FONT.medium },
  contextClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  /* Typing */
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.xl, borderBottomLeftRadius: 6, borderWidth: 1, paddingHorizontal: space[4], paddingVertical: 14 },
  typingDot: { width: 7, height: 7, borderRadius: 999 },

  /* Voice */
  voice: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2, minWidth: 180 },
  playCircle: { width: 36, height: 36, borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 26, flex: 1 },
  bar: { width: 3, borderRadius: 2 },
  voiceTime: { fontSize: 11, fontFamily: FONT.bold, minWidth: 30 },

  /* Quick replies */
  quickWrap: { borderTopWidth: 1 },
  quick: { paddingHorizontal: space[4], paddingVertical: space[3], gap: 0, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: 7, marginRight: space[2] },
  chipText: { fontSize: 12, fontFamily: FONT.bold },

  /* Composer */
  composerOuter: { borderTopWidth: 1, paddingHorizontal: space[4], paddingTop: space[3] },
  composerInner: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    borderRadius: radius.xl, borderWidth: 1,
    paddingLeft: 5, paddingRight: 5, paddingVertical: 5,
  },
  attachBtn: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Staging tray: photos picked but not yet sent.
  trayWrap: { marginBottom: space[2] },
  trayRow: { flexDirection: 'row', gap: space[2], paddingRight: space[2], paddingTop: 6 },
  // Room at the top-right for the × badge, which sits half outside the thumb.
  trayItem: { width: TRAY_THUMB, height: TRAY_THUMB },
  trayThumb: { width: TRAY_THUMB, height: TRAY_THUMB, borderRadius: radius.md },
  trayRemove: {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    ...elevation.e1,
  },
  trayCount: { ...type.caption, marginTop: 6 },
  input: { flex: 1, minHeight: 38, maxHeight: 110, paddingVertical: 8, lineHeight: 22, textAlignVertical: 'center', ...type.body },
  sendBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  micBtn: { width: 38, height: 38, flexShrink: 0 },
  micBtnFill: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
