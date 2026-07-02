import { useEffect, Component } from 'react';
import { View, useWindowDimensions, Text } from 'react-native';
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
import { useLocationSharing } from '../src/hooks/useLocationSharing';

SplashScreen.preventAutoHideAsync().catch(() => {});

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0A0E14', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#FF4D4F', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Startup Error</Text>
          <Text style={{ color: '#F2F6FB', fontSize: 13, textAlign: 'center' }}>{String(this.state.error)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// Streams GPS heartbeats to the dispatcher while signed in (no-op until then).
function LocationReporter() {
  useLocationSharing();
  return null;
}

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
      <LocationReporter />
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
    <ErrorBoundary>
      <SafeAreaProvider style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
        <ThemeProvider>
          <AlertProvider>
            <AuthProvider>
              <ThemedShell />
            </AuthProvider>
          </AlertProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
