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

// Docked-bar geometry. Screens render underneath the absolute-positioned
// bar, so scrollable content must pad its bottom by TAB_BAR_CLEARANCE
// (+ safe-area inset) or the last items get trapped behind the glass.
const BAR_HEIGHT = 60;
export const TAB_BAR_CLEARANCE = BAR_HEIGHT + 16;

// Load is the app's primary screen — a bigger circular badge that stays
// teal-tinted even at rest (unlike the other tabs, which go fully muted)
// so it always reads as the hero tab, not just when it happens to be active.
const HERO_SIZE = 40;

function TabIcon({ iconRest, iconActive, label, color, focused, fillColor, hero, colors }) {
  // Scale/lift pop on focus — mirrors motion.spring so every tab shares the
  // same feel; the hero circle pops slightly more since it's the anchor tab.
  const reduceMotion = useReduceMotion();
  // Load (hero) sits deliberately raised at all times so it reads as the
  // app's anchor tab; every tab lifts a little more when it's the active one.
  const restLift = hero ? -2 : 0;
  const activeLift = hero ? -4 : -2;
  const scale = useRef(new Animated.Value(focused ? 1 : 0.94)).current;
  const lift = useRef(new Animated.Value(focused ? activeLift : restLift)).current;
  // Gradient cross-fade for the active pill (hard bg switches look cheap).
  const fade = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const scaleTo = focused ? 1 : 0.94;
    const liftTo = focused ? activeLift : restLift;
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
    // No focused letter-spacing bump: the extrabold weight already widens the
    // word, and the extra tracking pushed "Docs"/"More" past their box so
    // numberOfLines={1} ellipsized them to "Do…"/"Mo…".
    color,
    lineHeight: 13,
    // Fixed, centered box wide enough for the boldest label — guarantees the
    // text renders in full regardless of weight/tracking.
    width: 56,
    textAlign: 'center',
  };

  if (hero) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
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
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {/* Glow lives on this outer wrapper — the pill itself needs
          overflow:'hidden' for the gradient, which would clip a shadow. */}
      <Animated.View style={[{ transform }, focused ? shadow.glow(colors.teal) : null]}>
        <View style={{
          width: 46, height: 28, alignItems: 'center', justifyContent: 'center',
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
//
// Docked bar, not a floating island: flush with the screen edges, square
// corners, only a top hairline instead of a full border box — the same
// silhouette as Instagram/most native apps' bottom bars.
function DockedBackground({ colors }) {
  const glass = glassFor(colors);
  // The shared glass overlay is tuned to be see-through, which left the tab
  // icons/labels illegible when bright content scrolled behind them. The bar
  // is the app's primary navigation, so it gets a stronger scrim than a
  // decorative glass panel — still translucent, but opaque enough to read.
  const scrim = colors.isDay ? 'rgba(248,250,252,0.82)' : 'rgba(14,19,26,0.86)';
  return (
    <View
      pointerEvents="none"
      style={{
        ...StyleSheet.absoluteFillObject,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.borderStrong,
      }}
    >
      <BlurView
        intensity={glass.intensity}
        tint={glass.tint}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} />
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
        tabBarBackground: () => <DockedBackground colors={colors} />,
        tabBarStyle: {
          // Docked bar: flush with the screen's bottom and side edges, like
          // Instagram/most native apps — content scrolls behind it through
          // the blur, but the bar itself never floats free of the chrome.
          // Height folds in insets.bottom so the icon row still centers
          // above the home indicator instead of getting pushed into it.
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR_HEIGHT + insets.bottom,
          borderRadius: 0,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          // No vertical padding: each tab now owns its own full-height,
          // centered slot (see TabIcon + tabBarIconStyle), so all five icons
          // share one vertical axis instead of React Navigation biasing the
          // shorter (non-hero) groups toward the top.
          paddingTop: 0,
          paddingBottom: insets.bottom,
          // A docked bar gets a light upward shadow, not the strong drop
          // shadow a floating island needed to separate it from content.
          ...elevation[2],
        },
        tabBarItemStyle: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
        // Let the icon container fill the item height so our centered TabIcon
        // slot can truly center within the bar (RN otherwise reserves space
        // for a hidden label and top-anchors the icon).
        tabBarIconStyle: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', marginTop: 0, marginBottom: 0 },
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
