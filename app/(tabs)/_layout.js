import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { View, Text } from 'react-native';
import { useTheme } from '../../src/theme/ThemeContext';
import { FONT, radius, type } from '../../src/theme/tokens';

const TABS = [
  { name: 'index',     title: 'Load',  icon: 'truck' },
  { name: 'messages',  title: 'Chat',  icon: 'message-square' },
  { name: 'earnings',  title: 'Pay',   icon: 'dollar-sign' },
  { name: 'documents', title: 'Docs',  icon: 'folder' },
  { name: 'more',      title: 'More',  icon: 'sliders' },
];

function TabIcon({ name, label, color, focused, fillColor }) {
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      <View style={{
        width: 48, height: 30, alignItems: 'center', justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: focused ? fillColor : 'transparent',
      }}>
        <Feather name={name} size={20} color={color} />
      </View>
      <Text style={{ fontSize: 11, fontFamily: FONT.bold, color, lineHeight: 13 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 72,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarItemStyle: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={icon} label={title} color={color} focused={focused} fillColor={colors.tealFill} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
