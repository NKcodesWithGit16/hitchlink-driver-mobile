import { useState, useRef } from 'react';
import { Pressable, Text, StyleSheet, View, Animated, Alert } from 'react-native';
import haptics from '../../lib/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import Icon from '../ui/Icon';
import { useTheme } from '../../theme/ThemeContext';
import { radius, type, FONT } from '../../theme/tokens';

/* Push-to-talk: hold to record, release to send. Captures real audio via
   expo-audio and hands the clip {uri, durationSec} to onSend. */
export default function VoiceButton({ onSend }) {
  const { colors } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const startRef = useRef(0);
  const activeRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;

  const start = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Allow the mic to send a voice message.'); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      activeRef.current = true;
      setRecording(true);
      startRef.current = Date.now();
      haptics.impact();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.18, duration: 500, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      ).start();
    } catch {
      activeRef.current = false;
      setRecording(false);
    }
  };

  const stop = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    pulse.stopAnimation();
    pulse.setValue(1);
    setRecording(false);
    const secs = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
    haptics.tap();
    try {
      await recorder.stop();
      onSend?.({ uri: recorder.uri || null, durationSec: secs });
    } catch {
      onSend?.({ uri: null, durationSec: secs });
    }
  };

  return (
    <View style={styles.wrap}>
      {recording ? (
        <View style={[styles.hint, { backgroundColor: colors.surface2, borderColor: colors.danger + '55' }]}>
          <View style={[styles.recDot, { backgroundColor: colors.danger }]} />
          <Text style={[styles.hintText, { color: colors.textPrimary }]}>Recording… release to send</Text>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable onPressIn={start} onPressOut={stop} accessibilityRole="button" accessibilityLabel="Hold to record a voice message">
          <LinearGradient
            colors={recording ? colors.gradients.danger : colors.gradients.teal}
            style={styles.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <Icon name="mic" size={24} color={colors.onAccent} />
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  btn: { width: 54, height: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  hint: {
    position: 'absolute', bottom: 62, right: -4, width: 220,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8,
  },
  recDot: { width: 9, height: 9, borderRadius: 999 },
  hintText: { ...type.caption, fontFamily: FONT.bold },
});
