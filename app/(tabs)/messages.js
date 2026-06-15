import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform, Linking, Animated, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../../src/components/ui/Icon';
import VoiceButton from '../../src/components/driver/VoiceButton';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../../src/theme/ThemeContext';
import { useAuth } from '../../src/context/AuthContext';
import { fetchMessages, sendMessage, fetchActiveLoad } from '../../src/api/main';
import { space, type, radius, FONT, shadow } from '../../src/theme/tokens';

const QUICK = [
  { label: 'On my way',     icon: 'navigation' },
  { label: 'Running late',  icon: 'clock' },
  { label: 'At the dock',   icon: 'anchor' },
  { label: 'Loaded',        icon: 'check-circle' },
  { label: 'Delivered ✅',  icon: 'flag' },
];

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items,      setItems]      = useState([]);
  const [text,       setText]       = useState('');
  const [typing,     setTyping]     = useState(false);
  const [activeLoad, setActiveLoad] = useState(null);
  const scrollRef   = useRef(null);
  const typingTimer = useRef(null);

  // dispatcher info comes from the driver profile loaded in AuthContext
  const dispatcher = user?.dispatcher;

  useEffect(() => {
    if (!user?.id) return;
    fetchMessages(user.id).then(setItems).catch(() => {});
    fetchActiveLoad(user.id).then(setActiveLoad).catch(() => {});
  }, [user?.id]);

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
    append({ text: value });
    setText('');
    sendMessage(user?.id, value).catch(() => {});
    // Simulate dispatcher typing reply
    clearTimeout(typingTimer.current);
    setTyping(true);
    typingTimer.current = setTimeout(() => setTyping(false), 3200);
  }, [text, append, user?.id]);

  const sendVoice = useCallback(({ uri, durationSec }) => append({ kind: 'voice', uri, durationSec }), [append]);

  const pickAttachment = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (uri) append({ kind: 'image', uri });
    } catch {}
  }, [append]);

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={[styles.header, shadow.card]}>
        <LinearGradient
          colors={[colors.surface, colors.surface]}
          style={StyleSheet.absoluteFill}
        />
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
            onPress={() => dispatcher?.phone && Linking.openURL(`tel:${dispatcher.phone}`).catch(() => {})}
            style={[styles.headerBtn, { backgroundColor: colors.goFill, borderColor: colors.go }]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${dispatcher?.name || 'dispatcher'}`}
          >
            <Icon name="phone-call" size={17} color={colors.go} />
          </Pressable>
        </View>
      </View>

      {/* ── Load context banner ── */}
      {activeLoad ? (
        <View style={[styles.loadBanner, { backgroundColor: colors.tealFill, borderColor: colors.teal }]}>
          <Icon name="truck" size={12} color={colors.teal} />
          <Text style={[styles.loadBannerText, { color: colors.teal }]} numberOfLines={1}>
            {activeLoad.id} · {activeLoad.origin} → {activeLoad.destination}
          </Text>
          <View style={[styles.loadStatusPill, { backgroundColor: colors.teal }]}>
            <Text style={[styles.loadStatusText, { color: colors.onAccent }]}>En Route</Text>
          </View>
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>

        {/* ── Chat area ── */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => scrollToEnd(false)}
          showsVerticalScrollIndicator={false}
          style={{ backgroundColor: colors.bg }}
        >
          <DateSeparator label="Today" colors={colors} styles={styles} />
          {items.map((m, i) => (
            <Bubble key={m.id} msg={m} prev={items[i - 1]} next={items[i + 1]} colors={colors} styles={styles} />
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
        <View style={[styles.composerOuter, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space[3]) }]}>
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
              placeholder="Message dispatcher…"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.textPrimary }]}
              multiline
              onSubmitEditing={() => send()}
            />
            {text.trim() ? (
              <Pressable
                onPress={() => send()}
                style={[styles.sendBtn, { backgroundColor: colors.teal }, shadow.glow(colors.teal)]}
                accessibilityLabel="Send"
              >
                <Icon name="arrow-up" size={19} color={colors.onAccent} />
              </Pressable>
            ) : (
              <VoiceButton onSend={sendVoice} />
            )}
          </View>
        </View>

      </KeyboardAvoidingView>
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

function Bubble({ msg, prev, next, colors, styles }) {
  const mine = msg.from === 'driver';
  const prevSame = prev?.from === msg.from;
  const nextSame = next?.from === msg.from;
  const showAvatar = !mine && !nextSame;

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

  return (
    <View style={[
      styles.bubbleRow,
      mine ? styles.rowMine : styles.rowTheirs,
      prevSame ? { marginTop: 3 } : { marginTop: 10 },
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

      <View style={{ maxWidth: '78%', minWidth: 0 }}>
        {mine ? (
          <LinearGradient
            colors={colors.gradients.teal}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={bubbleStyle}
          >
            <BubbleBody msg={msg} mine colors={colors} styles={styles} />
          </LinearGradient>
        ) : (
          <View style={bubbleStyle}>
            <BubbleBody msg={msg} mine={false} colors={colors} styles={styles} />
          </View>
        )}
      </View>
    </View>
  );
}

function BubbleBody({ msg, mine, colors, styles }) {
  const ink = mine ? colors.onAccent : colors.textPrimary;
  const isVoice = msg.kind === 'voice';
  const isImage = msg.kind === 'image';
  return (
    <>
      {isImage ? (
        <Image source={{ uri: msg.uri }} style={styles.bubbleImage} resizeMode="cover" accessibilityLabel="Attached photo" />
      ) : isVoice ? (
        msg.uri
          ? <VoicePlayable uri={msg.uri} durationSec={msg.durationSec} mine={mine} colors={colors} styles={styles} />
          : <VoiceStatic durationSec={msg.durationSec} mine={mine} colors={colors} styles={styles} />
      ) : (
        <Text style={[styles.bubbleText, { color: ink }]}>{msg.text}</Text>
      )}
      <View style={styles.meta}>
        <Text style={[styles.metaTime, { color: mine ? 'rgba(255,255,255,0.55)' : colors.textMuted }]}>{msg.at}</Text>
        {mine && <Icon name="check" size={10} color="rgba(255,255,255,0.55)" />}
      </View>
    </>
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
  const ink = mine ? colors.onAccent : colors.teal;
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
  const ink = mine ? colors.onAccent : colors.teal;
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
    backgroundColor: c.surface, zIndex: 10,
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
  bubbleTheirs: { borderWidth: 1 },
  firstMine:   { borderTopRightRadius: radius.xl },
  firstTheirs: { borderTopLeftRadius:  radius.xl },
  tailMine:   { borderBottomRightRadius: 6 },
  tailTheirs: { borderBottomLeftRadius:  6 },

  bubbleText: { ...type.body, lineHeight: 22 },
  bubbleImage: { width: 200, height: 150, borderRadius: radius.md, marginBottom: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 1 },
  metaTime: { fontSize: 10, fontFamily: FONT.medium },

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
    flexDirection: 'row', alignItems: 'flex-end', gap: space[2],
    borderRadius: radius.xl, borderWidth: 1,
    paddingLeft: space[3], paddingRight: space[2], paddingVertical: space[2],
  },
  attachBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: { flex: 1, minHeight: 44, maxHeight: 110, paddingVertical: 6, ...type.body },
  sendBtn: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
