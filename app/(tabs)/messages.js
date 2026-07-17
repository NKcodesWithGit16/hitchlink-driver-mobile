import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  Platform, Linking, Animated, Image, Modal, Keyboard, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import RecordingBar from '../../src/components/driver/RecordingBar';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { useCall } from '../../src/context/CallContext';
import {
  fetchMessages, sendMessage, sendVoiceMessage, sendPhotoMessage, fetchActiveLoad,
  editMessage, deleteMessage, reactToMessage, removeReaction,
} from '../../src/api/main';
import { useChatSocket } from '../../src/hooks/useChatSocket';
import { useVoiceRecorder } from '../../src/hooks/useVoiceRecorder';
import { space, type, radius, FONT, shadow } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';

const QUICK = [
  { label: 'On my way',     icon: 'navigation' },
  { label: 'Running late',  icon: 'clock' },
  { label: 'At the dock',   icon: 'anchor' },
  { label: 'Loaded',        icon: 'check-circle' },
  { label: 'Delivered ✅',  icon: 'flag' },
];

// Quick-tap reactions, plus the windows the backend enforces (mirror them in the
// UI so we only offer actions that will actually succeed).
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_WINDOW_MIN = 15;
const DELETE_WINDOW_MIN = 60;
const ageMin = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / 60000 : Infinity);
const replyPreviewOf = (m) => ({ id: m.id, from: m.from, text: m.text, kind: m.kind });

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { startCall } = useCall();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items,       setItems]       = useState([]);
  const [text,        setText]        = useState('');
  const [typing,      setTyping]      = useState(false);
  const [activeLoad,  setActiveLoad]  = useState(null);
  const [replyTo,     setReplyTo]     = useState(null);   // message being replied to
  const [editing,     setEditing]     = useState(null);   // message being edited
  const [menuFor,     setMenuFor]     = useState(null);   // message with the action sheet open
  const [confirmDel,  setConfirmDel]  = useState(null);   // message pending delete confirmation
  const [viewerUri,   setViewerUri]   = useState(null);   // photo open in the fullscreen viewer
  const [kbOpen,      setKbOpen]      = useState(false);  // keyboard visibility
  const scrollRef   = useRef(null);
  const kbPad       = useRef(new Animated.Value(0)).current; // live keyboard height → wrapper padding

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
      setItems((prev) => {
        const serverDriverTexts = new Set(
          server.filter((m) => m.from === 'driver' && m.text).map((m) => m.text)
        );
        const stillPending = prev.filter(
          (m) => String(m.id).startsWith('local-') && !(m.text && serverDriverTexts.has(m.text))
        );
        return [...server, ...stillPending];
      });
    } catch {}
  }, [user?.id]);

  // Real-time: the SignalR hub nudges `load()` the instant a message arrives.
  // Polling stays as reconciliation — relaxed to 30s while the socket is
  // healthy (it also picks up edits/deletes/reactions, which the hub doesn't
  // broadcast), and back to 5s whenever the socket is down or unavailable
  // (mock mode, web without the module, server unreachable).
  const socketConnected = useChatSocket(user?.id, load);

  useEffect(() => {
    if (!user?.id) return;
    load();
    fetchActiveLoad(user.id).then(setActiveLoad).catch(() => {});
    const timer = setInterval(load, socketConnected ? 30000 : 5000);
    return () => clearInterval(timer);
  }, [user?.id, load, socketConnected]);

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
    sendMessage(user?.id, value, rid).then(load).catch(() => {});
  }, [text, append, user?.id, load, editing, replyTo]);

  const sendVoice = useCallback(async ({ uri, durationSec }) => {
    if (!uri || !user?.id) return;
    const rid = replyTo?.id || null;
    // Show the clip immediately, then upload. Once it's persisted we drop the
    // optimistic copy and let the next poll bring the server's version (which
    // carries the real id + streamable audio URL), so there's no duplicate.
    const localId = `local-${Date.now()}`;
    setItems((prev) => [...prev, { id: localId, from: 'driver', at: nowStr(), kind: 'voice', uri, durationSec, ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}) }]);
    setReplyTo(null);
    scrollToEnd();
    try {
      await sendVoiceMessage(user.id, { uri, durationSec, replyToMessageId: rid });
    } catch {}
    setItems((prev) => prev.filter((m) => m.id !== localId));
    load();
  }, [user?.id, load, scrollToEnd, replyTo]);

  // Tap-to-record voice: start() flips the composer into a recording bar,
  // stop() sends the clip through sendVoice, cancel() discards it.
  const voice = useVoiceRecorder({ onSend: sendVoice });

  // ── Message actions (long-press menu) ───────────────────────────────────
  const startReply = useCallback((m) => { setMenuFor(null); setEditing(null); setReplyTo(m); }, []);

  const startEdit = useCallback((m) => {
    setMenuFor(null);
    setReplyTo(null);
    setEditing(m);
    setText(m.text || '');
  }, []);

  const cancelCompose = useCallback(() => { setEditing(null); setReplyTo(null); setText(''); }, []);

  const react = useCallback(async (m, emoji) => {
    setMenuFor(null);
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
      // Show the photo immediately, then upload. Once persisted we drop the
      // optimistic copy and let the next poll bring the server's version
      // (real id + signed URL) — same reconcile dance as sendVoice.
      const rid = replyTo?.id || null;
      const localId = `local-${Date.now()}`;
      setItems((prev) => [...prev, { id: localId, from: 'driver', at: nowStr(), kind: 'image', uri, ...(replyTo ? { replyTo: replyPreviewOf(replyTo) } : {}) }]);
      setReplyTo(null);
      scrollToEnd();
      try {
        await sendPhotoMessage(user.id, { uri, replyToMessageId: rid });
      } catch {}
      setItems((prev) => prev.filter((m) => m.id !== localId));
      load();
    } catch {}
  }, [user?.id, replyTo, scrollToEnd, load]);

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
              {dispatcher?.name || 'Dispatcher'}
            </Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.go }]} />
              <Text style={[styles.statusText, { color: colors.textMuted }]}>Available · Dispatcher</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={startCall}
            onLongPress={() => dispatcher?.phone && Linking.openURL(`tel:${dispatcher.phone}`).catch(() => {})}
            delayLongPress={400}
            style={[styles.headerBtn, { backgroundColor: colors.goFill, borderColor: colors.go }]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${dispatcher?.name || 'dispatcher'}`}
            accessibilityHint="Starts an in-app call. Long-press to dial their phone number instead."
          >
            <Icon name="phone-call" size={17} color={colors.go} />
          </Pressable>
        </View>
      </View>

      {/* ── Load context banner (tap → Load tab) ── */}
      {activeLoad ? (
        <Pressable
          onPress={() => router.push('/(tabs)')}
          style={({ pressed }) => [styles.loadBanner, { backgroundColor: colors.tealFill, borderColor: colors.teal, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Open load ${activeLoad.id}`}
        >
          <Icon name="truck" size={12} color={colors.teal} />
          <Text style={[styles.loadBannerText, { color: colors.teal }]} numberOfLines={1}>
            {activeLoad.id} · {activeLoad.origin} → {activeLoad.destination}
          </Text>
          <View style={[styles.loadStatusPill, { backgroundColor: colors.teal }]}>
            <Text style={[styles.loadStatusText, { color: colors.onAccent }]}>En Route</Text>
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
          <DateSeparator label="Today" colors={colors} styles={styles} />
          {items.map((m, i) => (
            <Bubble
              key={m.id}
              msg={m}
              prev={items[i - 1]}
              next={items[i + 1]}
              colors={colors}
              styles={styles}
              onAction={() => !m.deleted && !String(m.id).startsWith('local-') && setMenuFor(m)}
              onReactQuick={(emoji) => !String(m.id).startsWith('local-') && react(m, emoji)}
              onOpenImage={setViewerUri}
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
                accessibilityLabel={`Send quick reply: ${label}`}
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
                  {editing ? 'Editing message' : `Replying to ${replyTo.from === 'driver' ? 'yourself' : (dispatcher?.name || 'dispatcher')}`}
                </Text>
                <Text style={[styles.contextText, { color: colors.textMuted }]} numberOfLines={1}>
                  {(editing || replyTo).kind === 'voice' ? '🎤 Voice message'
                    : (editing || replyTo).kind === 'image' ? '📷 Photo'
                    : ((editing || replyTo).text || '')}
                </Text>
              </View>
              <Pressable onPress={cancelCompose} hitSlop={8} style={styles.contextClose} accessibilityRole="button" accessibilityLabel="Cancel">
                <Icon name="x" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}

          {voice.recording ? (
            <RecordingBar elapsed={voice.elapsed} onCancel={voice.cancel} onSend={voice.stop} />
          ) : (
            <View style={[styles.composerInner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Pressable
                onPress={pickAttachment}
                style={styles.attachBtn}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Attach a photo"
              >
                <Icon name="paperclip" size={18} color={colors.textMuted} />
              </Pressable>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={editing ? 'Edit your message…' : 'Message dispatcher…'}
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
                  accessibilityLabel={editing ? 'Save edit' : 'Send'}
                >
                  <Icon name={editing ? 'check' : 'arrow-up'} size={19} color={colors.onAccent} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={voice.start}
                  style={[styles.micBtn]}
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice message"
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

      {/* ── Long-press action sheet ── */}
      <MessageActionSheet
        msg={menuFor}
        meId={user?.id}
        colors={colors}
        styles={styles}
        onClose={() => setMenuFor(null)}
        onReact={react}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={(m) => { setMenuFor(null); setConfirmDel(m); }}
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

function Bubble({ msg, prev, next, colors, styles, onAction, onReactQuick, onOpenImage }) {
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

  // Tail shape: only the last bubble in a group gets a tail
  const tailMine   = !nextSame && mine;
  const tailTheirs = !nextSame && !mine;

  const bubbleStyle = [
    styles.bubble,
    mine ? styles.bubbleMine : [styles.bubbleTheirs, { backgroundColor: colors.surface, borderColor: colors.border }],
    tailMine   && styles.tailMine,
    tailTheirs && styles.tailTheirs,
    !prevSame  && (mine ? styles.firstMine : styles.firstTheirs),
  ];

  const body = <BubbleBody msg={msg} mine={mine} colors={colors} styles={styles} onOpenImage={onOpenImage} />;
  let inner;
  if (msg.deleted) {
    inner = <View style={[bubbleStyle, { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1 }]}>{body}</View>;
  } else if (mine) {
    // Brand teal→navy gradient with white ink — the driver's "voice" in the
    // thread. A soft teal glow lifts it off the near-black background.
    inner = (
      <LinearGradient colors={colors.gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[bubbleStyle, styles.bubbleMineGlow]}>
        {body}
      </LinearGradient>
    );
  } else {
    inner = <View style={bubbleStyle}>{body}</View>;
  }

  return (
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
        {/* No accessibilityRole="button" here — this wrapper only reacts to
            long-press (a plain tap does nothing), and voice bubbles nest a
            real play/pause button inside it. On web, "button" role renders
            an actual <button>, and a <button> can't contain another <button>. */}
        <Pressable
          onLongPress={() => onAction?.()}
          delayLongPress={280}
          disabled={msg.deleted}
          accessibilityLabel="Message — long press for options"
        >
          {inner}
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
      </View>
    </Animated.View>
  );
}

function BubbleBody({ msg, mine, colors, styles, onOpenImage }) {
  const ink = mine ? '#FFFFFF' : colors.textPrimary;
  const sub = mine ? 'rgba(255,255,255,0.62)' : colors.textMuted;

  if (msg.deleted) {
    return (
      <Text style={[styles.deletedText, { color: colors.textMuted }]}>This message was deleted</Text>
    );
  }

  const isVoice = msg.kind === 'voice';
  const isImage = msg.kind === 'image';
  return (
    <>
      {msg.replyTo ? (
        <View style={[styles.replyQuote, {
          borderLeftColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal,
          backgroundColor: mine ? 'rgba(255,255,255,0.12)' : colors.surface2,
        }]}>
          <Text style={[styles.replyQuoteName, { color: mine ? 'rgba(255,255,255,0.9)' : colors.teal }]} numberOfLines={1}>
            {msg.replyTo.from === 'driver' ? 'You' : 'Dispatcher'}
          </Text>
          <Text style={[styles.replyQuoteText, { color: mine ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]} numberOfLines={1}>
            {msg.replyTo.kind === 'voice' ? '🎤 Voice message' : msg.replyTo.kind === 'image' ? '📷 Photo' : (msg.replyTo.text || '')}
          </Text>
        </View>
      ) : null}

      {isImage ? (
        <Pressable
          onPress={() => msg.uri && onOpenImage?.(msg.uri)}
          accessibilityRole="button"
          accessibilityLabel="Open photo fullscreen"
        >
          <Image source={{ uri: msg.uri }} style={styles.bubbleImage} resizeMode="cover" />
        </Pressable>
      ) : isVoice ? (
        msg.uri
          ? <VoicePlayable uri={msg.uri} durationSec={msg.durationSec} mine={mine} colors={colors} styles={styles} />
          : <VoiceStatic durationSec={msg.durationSec} mine={mine} colors={colors} styles={styles} />
      ) : (
        <Text style={[styles.bubbleText, { color: ink }]}>{msg.text}</Text>
      )}
      <View style={styles.meta}>
        {msg.editedAt ? <Text style={[styles.metaEdited, { color: sub }]}>edited</Text> : null}
        <Text style={[styles.metaTime, { color: sub }]}>{msg.at}</Text>
        {mine && <Icon name="check" size={10} color={sub} />}
      </View>
    </>
  );
}

function MessageActionSheet({ msg, colors, styles, onClose, onReact, onReply, onEdit, onDelete }) {
  const mine = msg?.from === 'driver';
  const isText = msg && !msg.kind;
  const canEdit = mine && isText && ageMin(msg?.ts) < EDIT_WINDOW_MIN;
  const canDelete = mine && ageMin(msg?.ts) < DELETE_WINDOW_MIN;
  const mineEmoji = msg?.reactions?.find((r) => r.mine)?.emoji;

  return (
    <Modal visible={!!msg} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
          <View style={styles.sheetEmojis}>
            {EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => msg && onReact(msg, e)}
                style={[styles.sheetEmojiBtn, mineEmoji === e && { backgroundColor: colors.tealFill, borderColor: colors.teal }]}
                accessibilityRole="button"
                accessibilityLabel={`React ${e}`}
              >
                <Text style={styles.sheetEmoji}>{e}</Text>
              </Pressable>
            ))}
          </View>
          <SheetAction icon="corner-up-left" label="Reply" colors={colors} styles={styles} onPress={() => msg && onReply(msg)} />
          {canEdit ? <SheetAction icon="edit-2" label="Edit" colors={colors} styles={styles} onPress={() => msg && onEdit(msg)} /> : null}
          {canDelete ? <SheetAction icon="trash-2" label="Delete for everyone" danger colors={colors} styles={styles} onPress={() => msg && onDelete(msg)} /> : null}
        </Pressable>
      </Pressable>
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

function ConfirmDelete({ msg, colors, styles, onCancel, onConfirm }) {
  return (
    <Modal visible={!!msg} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmOverlay}>
        <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.confirmIcon, { backgroundColor: colors.surface2, borderColor: colors.danger }]}>
            <Icon name="trash-2" size={24} color={colors.danger} />
          </View>
          <Text style={[styles.confirmTitle, { color: colors.textPrimary }]}>Delete for everyone?</Text>
          <Text style={[styles.confirmSub, { color: colors.textSecondary }]}>
            This message will be removed for you and the dispatcher. This can't be undone.
          </Text>
          <Pressable onPress={onConfirm} style={[styles.confirmDanger, { backgroundColor: colors.danger }]} accessibilityRole="button" accessibilityLabel="Delete for everyone">
            <Text style={styles.confirmDangerText}>Delete</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.confirmCancel, { borderColor: colors.border }]} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={[styles.confirmCancelText, { color: colors.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ImageViewer({ uri, colors, styles, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewerOverlay} onPress={onClose}>
        {uri ? (
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel="Photo" />
        ) : null}
        <Pressable
          onPress={onClose}
          style={[styles.viewerClose, { top: insets.top + space[3] }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
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

function VoiceStatic({ durationSec, mine, colors, styles }) {
  const ink = mine ? '#FFFFFF' : colors.teal;
  return (
    <View style={styles.voice}>
      <View style={[styles.playCircle, { borderColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal, backgroundColor: mine ? 'rgba(255,255,255,0.15)' : colors.tealFill }]}>
        <Icon name="play" size={14} color={ink} />
      </View>
      <View style={styles.waveform}>
        {WAVE.map((h, i) => (
          <View key={i} style={[styles.bar, { height: h, backgroundColor: ink, opacity: 0.45 }]} />
        ))}
      </View>
      <Text style={[styles.voiceTime, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
        0:{String(durationSec).padStart(2, '0')}
      </Text>
    </View>
  );
}

function VoicePlayable({ uri, durationSec, mine, colors, styles }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const ink = mine ? '#FFFFFF' : colors.teal;
  const playing = !!status?.playing;
  const dur = status?.duration || durationSec || 1;
  const cur = status?.currentTime || 0;
  const progress = Math.max(0, Math.min(1, dur ? cur / dur : 0));
  const remain = Math.max(0, Math.round(playing ? dur - cur : dur));

  const toggle = () => {
    try {
      if (playing) { player.pause(); return; }
      if (status?.didJustFinish || (dur && cur >= dur - 0.05)) player.seekTo(0);
      player.play();
    } catch {}
  };

  return (
    <Pressable style={styles.voice} onPress={toggle} accessibilityRole="button">
      <View style={[styles.playCircle, { borderColor: mine ? 'rgba(255,255,255,0.6)' : colors.teal, backgroundColor: mine ? 'rgba(255,255,255,0.15)' : colors.tealFill }]}>
        <Icon name={playing ? 'pause' : 'play'} size={14} color={ink} />
      </View>
      <View style={styles.waveform}>
        {WAVE.map((h, i) => {
          const active = i / WAVE.length <= progress;
          return <View key={i} style={[styles.bar, { height: h, backgroundColor: ink, opacity: active ? 1 : 0.25 }]} />;
        })}
      </View>
      <Text style={[styles.voiceTime, { color: mine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
        0:{String(remain).padStart(2, '0')}
      </Text>
    </Pressable>
  );
}

const WAVE = [5, 12, 8, 18, 11, 22, 7, 16, 6, 20, 13, 9, 17, 8, 14, 10, 19, 6, 15, 11];
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
  headerBtn: { width: 44, height: 44, borderRadius: 999, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

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

  bubble: { borderRadius: radius.xl, paddingHorizontal: space[4], paddingVertical: space[3], gap: 4, borderWidth: 0 },
  bubbleMine: {},
  bubbleMineGlow: { shadowColor: c.teal, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 5 },
  bubbleTheirs: { borderWidth: 1 },
  firstMine:   { borderTopRightRadius: radius.xl },
  firstTheirs: { borderTopLeftRadius:  radius.xl },
  tailMine:   { borderBottomRightRadius: 6 },
  tailTheirs: { borderBottomLeftRadius:  6 },

  bubbleText: { ...type.body, lineHeight: 22 },
  bubbleImage: { width: 200, height: 150, borderRadius: radius.md, marginBottom: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 1 },
  metaTime: { fontSize: 10, fontFamily: FONT.medium },
  metaEdited: { fontSize: 10, fontFamily: FONT.medium, fontStyle: 'italic', marginRight: 1 },
  deletedText: { ...type.body, fontStyle: 'italic' },

  /* Reply quote inside a bubble */
  replyQuote: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 5, gap: 1 },
  replyQuoteName: { fontSize: 11, fontFamily: FONT.bold },
  replyQuoteText: { fontSize: 12, fontFamily: FONT.medium },

  /* Reactions */
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, marginHorizontal: 4 },
  reactChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  reactEmoji: { fontSize: 12 },
  reactCount: { fontSize: 11, fontFamily: FONT.bold },

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
