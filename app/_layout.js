import { useEffect } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold,
  Lexend_700Bold, Lexend_800ExtraBold, Lexend_900Black,
} from '@expo-google-fonts/lexend';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { WeatherToast, WeatherAlertModalGlobal } from '../src/components/ui/WeatherToast';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RouteGate() {
  const { ready, signedIn, onboarded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const seg0 = segments[0];
    const inAuth = seg0 === '(auth)';
    const inOnboarding = seg0 === 'onboarding';
    if (signedIn) {
      if (inAuth || inOnboarding) router.replace('/(tabs)');
    } else if (!onboarded) {
      if (!inOnboarding && !inAuth) router.replace('/onboarding');
    } else if (!inAuth && !inOnboarding) {
      router.replace('/(auth)/sign-in');
    }
  }, [ready, signedIn, onboarded, segments]);

  return null;
}

function ThemedShell() {
  const { colors, scheme } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, width, alignSelf: 'center', overflow: 'hidden', backgroundColor: colors.bg }}>
      <StatusBar style={scheme === 'day' ? 'dark' : 'light'} />
      <RouteGate />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      {/* Global overlays — render above everything */}
      <WeatherToast />
      <WeatherAlertModalGlobal />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold,
    Lexend_700Bold, Lexend_800ExtraBold, Lexend_900Black,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
      <ThemeProvider>
        <AlertProvider>
          <AuthProvider>
            <ThemedShell />
          </AuthProvider>
        </AlertProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
