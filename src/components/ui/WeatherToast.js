import { useEffect, useRef, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from './Icon';
import PrimaryAction from './PrimaryAction';
import GlassView from './GlassView';
import { useTheme } from '../../theme/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { space, type, radius, FONT, shadow } from '../../theme/tokens';

const TOAST_DURATION = 7000;

/* ── Sliding top notification banner ── */
export function WeatherToast() {
  const { colors } = useTheme();
  const { activeAlert, toastVisible, dismissToast, openModal } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const autoTimer = useRef(null);

  useEffect(() => {
    if (toastVisible) {
      clearTimeout(autoTimer.current);
      Animated.spring(translateY, {
        toValue: 0, damping: 18, stiffness: 200, useNativeDriver: true,
      }).start();
      autoTimer.current = setTimeout(dismissToast, TOAST_DURATION);
    } else {
      clearTimeout(autoTimer.current);
      Animated.timing(translateY, {
        toValue: -120, duration: 260, useNativeDriver: true,
      }).start();
    }
    return () => clearTimeout(autoTimer.current);
  }, [toastVisible]);

  if (!activeAlert) return null;

  const severe = activeAlert.severity === 'severe';
  const accent = severe ? colors.danger : colors.caution;
  const fill   = severe ? colors.dangerFill : colors.cautionFill;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top: insets.top + space[2], transform: [{ translateY }] },
        shadow.float,
      ]}
      pointerEvents={toastVisible ? 'box-none' : 'none'}
    >
      <Pressable onPress={openModal}>
        <GlassView radius={radius.xl} border={false} style={[styles.toast, { borderColor: accent, borderLeftColor: accent }]}>
          <View style={[styles.iconWrap, { backgroundColor: fill }]}>
            <Icon name="alert-triangle" size={18} color={accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[styles.title, { color: accent }]} numberOfLines={1}>{activeAlert.title}</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]} numberOfLines={1}>
              ~{activeAlert.etaMinutes} min ahead · Near {activeAlert.near}
            </Text>
          </View>
          <Pressable onPress={dismissToast} style={styles.close} hitSlop={10}>
            <Icon name="x" size={16} color={colors.textMuted} />
          </Pressable>
        </GlassView>
      </Pressable>
    </Animated.View>
  );
}

/* ── Full-screen alert modal (rendered globally) ── */
export function WeatherAlertModalGlobal() {
  const { colors } = useTheme();
  const { activeAlert, modalVisible, closeModal } = useAlert();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!activeAlert) return null;

  const severe = activeAlert.severity === 'severe';
  const grad   = severe ? colors.gradients.weatherSevere : colors.gradients.weatherWarn;
  const accent = severe ? colors.danger : colors.caution;

  return (
    <Modal visible={modalVisible} animationType="slide" onRequestClose={closeModal}>
      <LinearGradient colors={grad} style={styles.alertScreen}>
        <View style={styles.alertInner}>
          <View style={[styles.alertBadge, { borderColor: accent }]}>
            <Icon name="alert-triangle" size={40} color={accent} />
          </View>
          <Text style={[styles.alertEta, { color: accent }]}>~{activeAlert.etaMinutes} MIN AHEAD</Text>
          <Text style={[styles.alertHeadline, { color: colors.textPrimary }]}>{activeAlert.title}</Text>
          <Text style={[styles.alertWhere, { color: colors.textSecondary }]}>Near {activeAlert.near}</Text>
          <Text style={[styles.alertAdvice, { color: colors.textSecondary }]}>{activeAlert.advice}</Text>
          <View style={{ height: space[6] }} />
          <PrimaryAction
            label="Find a safe truck stop"
            icon="map-pin"
            tone={severe ? 'danger' : 'caution'}
            onPress={() => Linking.openURL('https://www.google.com/maps/search/truck+stop+near+me').catch(() => {})}
          />
          <Pressable onPress={closeModal} style={styles.alertDismiss}>
            <Text style={[styles.alertDismissText, { color: colors.textMuted }]}>Got it — keep driving safe</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </Modal>
  );
}

const makeStyles = (c) => StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], zIndex: 999 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    borderRadius: radius.xl, borderWidth: 1.5, borderLeftWidth: 4,
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  iconWrap: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { ...type.bodyStrong, fontSize: 14 },
  sub: { ...type.caption },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  alertScreen: { flex: 1 },
  alertInner: { flex: 1, padding: space[6], justifyContent: 'center', gap: space[2] },
  alertBadge: { width: 88, height: 88, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: space[4] },
  alertEta: { ...type.label, fontSize: 13 },
  alertHeadline: { fontSize: 34, fontFamily: FONT.extrabold, letterSpacing: -0.8 },
  alertWhere: { ...type.title },
  alertAdvice: { ...type.body, lineHeight: 24, marginTop: space[3] },
  alertDismiss: { alignItems: 'center', paddingVertical: space[4], marginTop: space[2] },
  alertDismissText: { ...type.bodyStrong },
});
