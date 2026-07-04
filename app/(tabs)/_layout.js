import React, { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, Animated, Platform, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/ThemeContext';
import { FONT, radius, shadow, motion, elevation, glassFor } from '../../src/theme/tokens';
import haptics from '../../src/lib/haptics';
import { useReduceMotion } from '../../src/lib/useReduceMotion';

// MaterialCommunityIcons outline/filled pairs — outline at rest, filled when
// active. (Feather is outline-only, which is why the tab bar doesn't use the
// app-wide ui/Icon wrapper.)
const TABS = [
  { name: 'earnings',  title: 'Pay',   iconRest: 'wallet-outline', iconActive: 'wallet' },
  { name: 'messages',  title: 'Chat',  iconRest: 'chat-outline',   iconActive: 'chat' },
  { name: 'index',     title: 'Load',  iconRest: 'truck-outline',  iconActive: 'truck', hero: true },
  { name: 'documents', title: 'Docs',  iconRest: 'folder-outline', iconActive: 'folder' },
  { name: 'more',      title: 'More',  iconRest: 'cog-outline',    iconActive: 'cog' },
];

// Floating-island geometry. Screens render underneath the absolute-positioned
// bar, so scrollable content must pad its bottom by TAB_BAR_CLEARANCE
// (+ safe-area inset) or the last items get trapped behind the glass.
const BAR_HEIGHT = 76;
const BAR_BOTTOM_GAP = 10;
export const TAB_BAR_CLEARANCE = BAR_HEIGHT + BAR_BOTTOM_GAP + 16;

// Load is the app's primary screen — a bigger circular badge that stays
// teal-tinted even at rest (unlike the other tabs, which go fully muted)
// so it always reads as the hero tab, not just when it happens to be active.
const HERO_SIZE = 54;

function TabIcon({ iconRest, iconActive, label, color, focused, fillColor, hero, colors }) {
  // Scale/lift pop on focus — mirrors motion.spring so every tab shares the
  // same feel; the hero circle pops slightly more since it's the anchor tab.
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(focused ? 1 : 0.94)).current;
  const lift = useRef(new Animated.Value(focused ? (hero ? -4 : -2) : 0)).current;
  // Gradient cross-fade for the active pill (hard bg switches look cheap).
  const fade = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const scaleTo = focused ? 1 : 0.94;
    const liftTo = focused ? (hero ? -4 : -2) : 0;
    const fadeTo = focused ? 1 : 0;
    if (reduceMotion) {
      scale.setValue(scaleTo);
      lift.setValue(liftTo);
      fade.setValue(fadeTo);
      return;
    }
    Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, ...motion.spring.snappy }).start();
    Animated.spring(lift, { toValue: liftTo, useNativeDriver: true, ...motion.spring.snappy }).start();
    Animated.timing(fade, { toValue: fadeTo, duration: motion.duration.fast, useNativeDriver: true }).start();
  }, [focused, reduceMotion]);

  const transform = [{ scale }, { translateY: lift }];
  const iconName = focused ? iconActive : iconRest;

  const labelStyle = {
    fontSize: 11,
    fontFamily: focused ? FONT.extrabold : FONT.medium,
    letterSpacing: focused ? 0.2 : 0,
    color,
    lineHeight: 13,
  };

  if (hero) {
    return (
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Animated.View style={{ transform }}>
          {focused ? (
            <LinearGradient
              colors={colors.gradients.brand}
              style={{
                width: HERO_SIZE, height: HERO_SIZE, borderRadius: radius.pill,
                alignItems: 'center', justifyContent: 'center',
                ...shadow.glow(colors.teal),
              }}
            >
              {/* Literal white, not onAccent: onAccent is dark ink tuned for
                  the bright accent color, but the brand gradient is dark in
                  both themes — white is the only ink with contrast here. */}
              <MaterialCommunityIcons name={iconName} size={24} color="#FFFFFF" />
            </LinearGradient>
          ) : (
            // No shadow at rest — the glow is reserved for the actual
            // focused tab so it stays the one unambiguous "you are here"
            // signal. Load still reads as the hero tab via its size and
            // always-teal icon, just without competing for attention.
            <View style={{
              width: HERO_SIZE, height: HERO_SIZE, borderRadius: radius.pill,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: fillColor,
            }}>
              <MaterialCommunityIcons name={iconName} size={24} color={colors.teal} />
            </View>
          )}
        </Animated.View>
        <Text style={labelStyle} numberOfLines={1}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      {/* Glow lives on this outer wrapper — the pill itself needs
          overflow:'hidden' for the gradient, which would clip a shadow. */}
      <Animated.View style={[{ transform }, focused ? shadow.glow(colors.teal) : null]}>
        <View style={{
          width: 48, height: 30, alignItems: 'center', justifyContent: 'center',
          borderRadius: radius.pill,
          overflow: 'hidden',
        }}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
            {/* brand gradient (same as the hero circle) so every active tab
                shares one treatment — and it's dark in both themes, so the
                white icon always has contrast. */}
            <LinearGradient
              colors={colors.gradients.brand}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <MaterialCommunityIcons
            name={iconName}
            size={20}
            color={focused ? '#FFFFFF' : colors.textMuted}
          />
        </View>
      </Animated.View>
      <Text style={labelStyle} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// Glass recipe borrowed from GlassView (blur + overlay tint + hairline edge)
// but inlined: GlassView is documented as overlay-only and wraps children
// we don't need here. The overlay tint is the legibility floor on Android,
// where blur quality varies by device.
function IslandBackground({ colors }) {
  const glass = glassFor(colors);
  // Top-edge sheen is what makes glass read as glass instead of grey
  // plastic — stronger in daylight, faint at night.
  const sheen = colors.isDay ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.07)';
  return (
    <View
      pointerEvents="none"
      style={{
        ...StyleSheet.absoluteFillObject,
        borderRadius: radius['2xl'],
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.borderStrong,
      }}
    >
      <BlurView
        intensity={glass.intensity}
        tint={glass.tint}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.overlay }]} />
      <LinearGradient
        colors={[sheen, 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%' }}
      />
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptics.tap() }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarBackground: () => <IslandBackground colors={colors} />,
        tabBarStyle: {
          // Floating glass island: detached from the screen edge, content
          // scrolls behind it through the blur. Height no longer folds in
          // insets.bottom — the whole island floats above the home indicator.
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: insets.bottom + BAR_BOTTOM_GAP,
          height: BAR_HEIGHT,
          borderRadius: radius['2xl'],
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          paddingTop: 8,
          paddingBottom: 8,
          // A floating island casts a normal drop shadow like a card —
          // not the upward shadow a docked bar needs. Strongest tier:
          // the bar floats over content, it can afford it.
          ...elevation[4],
        },
        tabBarItemStyle: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map(({ name, title, iconRest, iconActive, hero }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon
                iconRest={iconRest}
                iconActive={iconActive}
                label={title}
                color={color}
                focused={focused}
                fillColor={colors.tealFill}
                hero={hero}
                colors={colors}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
