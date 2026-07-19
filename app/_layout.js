import { useEffect, Component } from 'react';
import { View, useWindowDimensions, Text } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { setAudioModeAsync } from 'expo-audio';
import {
  useFonts,
  Lexend_400Regular, Lexend_500Medium, Lexend_600SemiBold,
  Lexend_700Bold, Lexend_800ExtraBold, Lexend_900Black,
} from '@expo-google-fonts/lexend';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AlertProvider } from '../src/context/AlertContext';
import { CallProvider } from '../src/context/CallContext';
import CallOverlay from '../src/components/call/CallOverlay';
import { WeatherToast, WeatherAlertModalGlobal } from '../src/components/ui/WeatherToast';
import { useLocationSharing } from '../src/hooks/useLocationSharing';
import { usePushNotificationRouting } from '../src/hooks/usePushNotifications';
import { useVoipPushTokenSync } from '../src/hooks/useVoipPushToken';
// Side-effect import: registers the background location task with TaskManager
// at app entry, so it exists when the OS relaunches the app headlessly to
// deliver location updates.
import '../src/lib/backgroundLocation';

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

// Routes push-notification taps (new load / dispatcher message) to the right
// tab, including taps that cold-started the app.
function PushRouter() {
  const { signedIn } = useAuth();
  usePushNotificationRouting(signedIn);
  return null;
}

// Registers/keeps in sync the APNs VoIP token an incoming call needs to ring
// through CallKit — see useVoipPushToken.js and CallContext.js.
function VoipPushRegistrar() {
  const { user, signedIn } = useAuth();
  useVoipPushTokenSync(signedIn ? user?.id : null);
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
    const inWelcome = seg0 === 'welcome';
    const inIntro = inWelcome || inOnboarding;
    if (signedIn) {
      if (inAuth || inIntro) router.replace('/(tabs)');
    } else if (!onboarded) {
      // First run: land on the cinematic welcome; the tour + sign-in are reachable from there.
      if (!inIntro && !inAuth) router.replace('/welcome');
    } else if (!inAuth && !inIntro) {
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
      <PushRouter />
      <VoipPushRegistrar />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      {/* Global overlays — render above everything */}
      <WeatherToast />
      <WeatherAlertModalGlobal />
      <CallOverlay />
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

  // Route audio to the loudspeaker and let voice notes play even with the
  // iOS ringer-silent switch on — otherwise playback is muted "sometimes"
  // depending on the phone's silent switch / prior recording session.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
  }, []);

  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
        <ThemeProvider>
          {/* AlertProvider sits inside AuthProvider: the notifications inbox is
              fetched per signed-in user, so it needs useAuth(). */}
          <AuthProvider>
            <AlertProvider>
              <CallProvider>
                <ThemedShell />
              </CallProvider>
            </AlertProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
