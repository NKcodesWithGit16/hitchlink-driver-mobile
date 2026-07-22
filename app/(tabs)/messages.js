import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  Platform, Linking, Animated, Image, Modal, Keyboard, Dimensions, Alert, LayoutAnimation, UIManager,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import RecordingBar from '../../src/components/driver/RecordingBar';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import { useCall } from '../../src/context/CallContext';
import {
  fetchMessages, sendMessage, sendVoiceMessage, sendPhotoMessage, sendDocumentMessage,
  downloadChatAttachment, fetchActiveLoad,
  editMessage, deleteMessage, reactToMessage, removeReaction, markChatRead,
} from '../../src/api/main';
import { useChatSocket } from '../../src/hooks/useChatSocket';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';
import { playMessageSound } from '../../src/lib/sound';
import { getValidToken } from '../../src/lib/session';
import { parsePeaksString, resamplePeaks } from '../../src/lib/waveform';
import haptics from '../../src/lib/haptics';
import { space, type, radius, FONT, shadow } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';

// Quick-tap reactions, plus the windows the backend enforces (mirror them in the
// UI so we only offer actions that will actually succeed).
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const HEART_EMOJI = '❤️';
const DOUBLE_TAP_MS = 280;
const EDIT_WINDOW_MIN = 15;
const DELETE_WINDOW_MIN = 60;
const ageMin = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity);
const replyPreviewOf = (m) => ({ id: m.id, from: m.from, text: m.text, kind: m.kind });

// Old-architecture Android needs this opt-in for LayoutAnimation (used below
// to smoothly expand/collapse the reveal-on-tap timestamp); no-op elsewhere.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const { startCall } = useCall();
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
  const [viewerUri,   setViewerUri]   = useState(null);   // photo open in the fullscreen viewer
  const [kbOpen,      setKbOpen]      = useState(false);  // keyboard visibility
  const [attachMenuOpen, setAttachMenuOpen] = useState(false); // paperclip's Photo/Document sheet
  const scrollRef   = useRef(null);
  const kbPad       = useRef(new Animated.Value(0)).current; // live keyboard height → wrapper padding
  const seenIdsRef  = useRef(new Set());    // dispatcher-message ids already dinged/accounted for
  const firstLoadRef = useRef(true);        // skip the sound on the initial history fetch
  const isTypingRef  = useRef(false);       // have we told the dispatcher "typing" without a "stopped" yet
  const typingTimeoutRef = useRef(null);    // auto-sends "stopped typing" after a pause

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
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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
  }, [kbPad]);

  // dispatcher info comes from the driver profile loaded in AuthContext
  const dispatcher = user?.dispatcher;

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

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const append = useCallback((msg) => {
    setItems((prev) => [...prev, { id: `local-${Date.now()}`, from: 'driver', at: nowStr(), ...msg }]);
    scrollToEnd();
  }, [scrollToEnd]);

  const send = useCallback((body) => {
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
    scrollToEnd();
    try {
      await sendVoiceMessage(user.id, { uri, durationSec, waveformPeaks, replyToMessageId: rid });
      setItems((prev) => prev.filter((m) => m.id !== localId));
      load();
      haptics.success();
    } catch {
      setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
      haptics.error();
    }
  }, [user?.id, load, scrollToEnd, replyTo]);

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
  // again (or tapping a different message) closes it. LayoutAnimation makes
  // the row grow/shrink smoothly instead of popping.
  const toggleReveal = useCallback((id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

  const confirmDelete = useCallback(async () => {
    const m = confirmDel;
    setConfirmDel(null);
    if (!m) return;
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, text: undefined, kind: undefined, uri: undefined, reactions: [] } : x)));
    try { await deleteMessage(m.id, user?.id, 'everyone'); } catch {}
    load();
  }, [confirmDel, user?.id, load]);

  const pickAttachment = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;
      // Show the photo immediately, then upload. On success we drop the
      // optimistic copy and let the next poll bring the server's version (real
      // id + signed URL); on failure it stays visible marked failed instead of
      // silently vanishing — same reconcile dance as sendVoice.
      const rid = replyTo?.id || null;
      const localId = `local-${Date.now()}`;
      setItems((prev) => [...prev, { id: localId, from: 'driver', at: nowStr(), kind: 'image', uri, ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}) }]);
      setReplyTo(null);
      scrollToEnd();
      try {
        await sendPhotoMessage(user.id, { uri, replyToMessageId: rid });
        setItems((prev) => prev.filter((m) => m.id !== localId));
        load();
        haptics.success();
      } catch {
        setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
        haptics.error();
      }
    } catch {}
  }, [user?.id, replyTo, scrollToEnd, load]);

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
      scrollToEnd();
      try {
        await sendDocumentMessage(user.id, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, replyToMessageId: rid });
        setItems((prev) => prev.filter((m) => m.id !== localId));
        load();
        haptics.success();
      } catch {
        setItems((prev) => prev.map((m) => (m.id === localId ? { ...m, failed: true } : m)));
        haptics.error();
      }
    } catch {}
  }, [user?.id, replyTo, scrollToEnd, load]);

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

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.peerInfo}>
          <LinearGradient colors={colors.gradients.teal} style={styles.avatar}>
            <Text style={styles.avatarInitials}>
              {(dispatcher?.name || 'D').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </Text>
          </LinearGradient>
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
          <Pressable
            onPress={startCall}
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

        {/* ── Chat area ── */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => scrollToEnd(false)}
          showsVerticalScrollIndicator={false}
          style={styles.chatScroll}
        >
          <DateSeparator label={t('common.today')} colors={colors} styles={styles} />
          {items.map((m, i) => (
            <Bubble
              key={m.id}
              msg={m}
              prev={items[i - 1]}
              next={items[i + 1]}
              colors={colors}
              styles={styles}
              onAction={(anchor, mine) => !m.deleted && !String(m.id).startsWith('local-') && setFocus({ msg: m, anchor, mine })}
              onReactQuick={(emoji) => !String(m.id).startsWith('local-') && react(m, emoji)}
              onDoubleTap={() => !m.deleted && !String(m.id).startsWith('local-') && react(m, HEART_EMOJI)}
              onOpenImage={setViewerUri}
              onCallBack={startCall}
              revealed={revealedId === m.id}
              onToggleReveal={() => toggleReveal(m.id)}
              showSeen={m.id === lastReadMineId}
            />
          ))}
          {typing ? <TypingIndicator colors={colors} styles={styles} /> : null}
        </ScrollView>

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
                placeholder={editing ? t('messages.editPlaceholder') : t('messages.messagePlaceholder')}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { color: colors.textPrimary }]}
                multiline
                numberOfLines={1}
                onSubmitEditing={() => send()}
              />
              {text.trim() ? (
                <Pressable
                  onPress={() => send()}
                  style={[styles.sendBtn, { backgroundColor: colors.teal }, shadow.glow(colors.teal)]}
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

      {/* ── Long-press focused menu: message lifts in place, everything else blurs ── */}
      <FocusedMessageOverlay
        focus={focus}
        colors={colors}
        styles={styles}
        onClose={() => setFocus(null)}
        onReact={react}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={(m) => { setFocus(null); setConfirmDel(m); }}
      />

      {/* ── Delete confirmation ── */}
      <ConfirmDelete
        msg={confirmDel}
        colors={colors}
        styles={styles}
        onCancel={() => setConfirmDel(null)}
        onConfirm={confirmDelete}
      />

      {/* ── Fullscreen photo viewer ── */}
      <ImageViewer uri={viewerUri} colors={colors} styles={styles} onClose={() => setViewerUri(null)} />
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

function Bubble({ msg, prev, next, colors, styles, onAction, onReactQuick, onDoubleTap, onOpenImage, onCallBack, revealed, onToggleReveal, showSeen }) {
  const t = useT();
  const mine = msg.from === 'driver';
  const prevSame = prev?.from === msg.from;
  const nextSame = next?.from === msg.from;
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
            <LinearGradient colors={colors.gradients.teal} style={styles.dispAvatar}>
              <Text style={styles.dispAvatarText}>D</Text>
            </LinearGradient>
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
            </View>
          ) : null}

          {/* Messenger-style "seen" indicator — the dispatcher's tiny avatar
              under the last driver-sent message their read cursor has passed,
              instead of WhatsApp-style checkmarks on every sent message. */}
          {showSeen ? (
            <View style={styles.seenRow}>
              <LinearGradient colors={colors.gradients.teal} style={styles.seenAvatar}>
                <Text style={styles.seenAvatarText}>D</Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* Messenger-style: hidden by default, appears centered below the
          bubble it belongs to when tapped (see handlePress above). */}
      {revealed ? (
        <View style={styles.revealedTimeRow}>
          <Text style={styles.revealedTimeText}>
            {msg.editedAt ? `${t('messages.edited')} · ` : ''}{msg.at}
          </Text>
        </View>
      ) : null}
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
        <Pressable
          onPress={() => {
            const isDouble = onBubbleDoubleTap?.();
            if (!isDouble) { msg.uri && onOpenImage?.(msg.uri); onBubbleToggleReveal?.(); }
          }}
          onLongPress={onBubbleLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={t('messages.openPhotoA11y')}
        >
          <Image source={{ uri: msg.uri }} style={styles.bubbleImage} resizeMode="cover" />
        </Pressable>
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
function FocusedMessageOverlay({ focus, colors, styles, onClose, onReact, onReply, onEdit, onDelete }) {
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

  const active = focus || held;
  if (!active) return null;

  const { msg, anchor, mine } = active;
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const REACTION_H = 56;
  const GAP = 10;
  const isText = msg && !msg.kind;
  const canEdit = mine && isText && ageMin(msg?.ts) < EDIT_WINDOW_MIN;
  const canDelete = mine && ageMin(msg?.ts) < DELETE_WINDOW_MIN;
  const actionCount = 1 + (canEdit ? 1 : 0) + (canDelete ? 1 : 0);
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
    <Modal visible={!!focus || !!held} transparent animationType="none" onRequestClose={close}>
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
        {canDelete ? <SheetAction icon="trash-2" label={t('messages.deleteForEveryone')} danger colors={colors} styles={styles} onPress={() => { onDelete(msg); close(); }} /> : null}
      </Animated.View>
    </Modal>
  );
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

function AttachMenuSheet({ visible, colors, styles, onClose, onPhoto, onDocument }) {
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
          <SheetAction icon="image" label={t('messages.photo')} colors={colors} styles={styles} onPress={() => { onClose(); onPhoto(); }} />
          <SheetAction icon="file-text" label={t('messages.document')} colors={colors} styles={styles} onPress={() => { onClose(); onDocument(); }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ConfirmDelete({ msg, colors, styles, onCancel, onConfirm }) {
  const t = useT();
  return (
    <Modal visible={!!msg} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.confirmIcon, { backgroundColor: colors.surface2, borderColor: colors.danger }]}>
            <Icon name="trash-2" size={24} color={colors.danger} />
          </View>
          <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>{t('messages.deleteForEveryoneQ')}</Text>
          <Text style={[styles.confirmSub, { color: colors.textSecondary }]}>
            {t('messages.deleteForEveryoneBody')}
          </Text>
          <Pressable onPress={onConfirm} style={[styles.confirmDanger, { backgroundColor: colors.danger }]} accessibilityRole="button" accessibilityLabel={t('messages.deleteForEveryone')}>
            <Text style={styles.confirmDangerText}>{t('common.delete')}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.confirmCancel, { borderColor: colors.border }]} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Text style={[styles.confirmCancelText, { color: colors.textMuted }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ImageViewer({ uri, colors, styles, onClose }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerOverlay} onPress={onClose}>
        {uri ? (
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={t('messages.photo')} />
        ) : null}
        <Pressable
          onPress={onClose}
          style={[styles.viewerClose, { top: insets.top + space[3] }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('messages.closePhotoA11y')}
        >
          <Icon name="x" size={24} color="#FFFFFF" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TypingIndicator({ colors, styles }) {
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
      <LinearGradient colors={colors.gradients.teal} style={styles.dispAvatar}>
        <Text style={styles.dispAvatarText}>D</Text>
      </LinearGradient>
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
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, msg.mimeType ? { mimeType: msg.mimeType } : undefined);
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
  avatar: { width: 48, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarInitials: { fontSize: 16, fontFamily: FONT.black, color: c.onAccent },
  peerName: { ...type.bodyStrong, fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  statusText: { ...type.caption },
  headerActions: { flexDirection: 'row', gap: space[2], marginLeft: space[3] },
  callBtn: { width: 44, height: 44, flexShrink: 0 },
  callBtnFill: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

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

  dispAvatar: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dispAvatarText: { fontSize: 12, fontFamily: FONT.black, color: c.onAccent },

  // Messenger-style: one uniform pill radius for every bubble — grouping
  // reads from spacing + avatar placement only, never a cut tail corner.
  bubble: { borderRadius: radius.xl, paddingHorizontal: space[4], paddingVertical: space[3], gap: 4, borderWidth: 0 },
  bubbleMine: {},
  bubbleMineGlow: { shadowColor: c.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5 },
  bubbleTheirs: { borderWidth: 1 },

  bubbleText: { ...type.body, lineHeight: 22 },
  bubbleImage: { width: 200, height: 150, borderRadius: radius.md, marginBottom: 2 },
  deletedText: { ...type.body, fontStyle: 'italic' },

  // Messenger-style: hidden by default, appears centered below the tapped
  // bubble (see Bubble's `revealed` prop / handlePress).
  revealedTimeRow: { alignItems: 'center', marginTop: 4, marginBottom: 2 },
  revealedTimeText: { fontSize: 12, fontFamily: FONT.medium, color: c.textMuted, ...type.num },

  // Messenger-style "seen" indicator — dispatcher's tiny avatar under the
  // last driver-sent message they've read, instead of per-message checkmarks.
  seenRow: { marginTop: 3, alignItems: 'flex-end' },
  seenAvatar: { width: 16, height: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  seenAvatarText: { fontSize: 8, fontFamily: FONT.black, color: c.onAccent },

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

  /* Fullscreen photo viewer */
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', right: space[4], width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

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
  input: { flex: 1, minHeight: 38, maxHeight: 110, paddingVertical: 8, lineHeight: 22, textAlignVertical: 'center', ...type.body },
  sendBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  micBtn: { width: 38, height: 38, flexShrink: 0 },
  micBtnFill: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
