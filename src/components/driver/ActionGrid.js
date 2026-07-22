import { View, StyleSheet, Linking, Platform } from 'react-native';
import IconButton from '../ui/IconButton';
import { useT } from '../../i18n/LanguageContext';
import { space } from '../../theme/tokens';

// Loaded defensively, same probe pattern as useLocationSharing — if
// expo-location isn't linked in this build, navigate() just falls back to
// letting the maps app resolve its own current location.
let Location = null;
try {
  Location = require('expo-location');
} catch {
  Location = null;
}

// We already hold foreground location permission (granted while signed in,
// for the heartbeat feature — see useLocationSharing), so fetch a quick fix
// ourselves and hand it to the maps app as an explicit origin. Leaving the
// origin blank makes the maps app depend on ITS OWN location permission,
// which may never have been granted even though ours has — that's what
// produces a destination pin with no route line.
async function currentCoords() {
  if (!Location) return null;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    const pos = last || await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return pos ? `${pos.coords.latitude},${pos.coords.longitude}` : null;
  } catch {
    return null;
  }
}

/* Navigate / Call / Chat — the three things a driver reaches for.
   Navigate HANDS OFF to the phone's own maps app (never in-app). */
export default function ActionGrid({ address, lat, lng, phone, onChat }) {
  const t = useT();
  const navigate = async () => {
    // Prefer the geocoded pickup/dropoff coordinates over the free-text
    // address — a street name alone can be ambiguous (multiple towns share
    // one), where a lat/lng pair never is.
    const destination = (lat != null && lng != null) ? `${lat},${lng}` : (address || '');
    const q = encodeURIComponent(destination);
    const origin = await currentCoords();
    const o = origin ? encodeURIComponent(origin) : null;
    const gmWeb = o
      ? `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${q}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
    // Google Maps app first on every platform — comgooglemaps:// on iOS,
    // google.navigation: on Android. Falls back to the Google Maps website
    // (never Apple Maps) if the app isn't installed.
    const url = Platform.select({
      ios: o ? `comgooglemaps://?saddr=${o}&daddr=${q}&directionsmode=driving` : `comgooglemaps://?daddr=${q}&directionsmode=driving`,
      android: `google.navigation:q=${q}`,
      default: gmWeb,
    });
    Linking.openURL(url).catch(() => Linking.openURL(gmWeb));
  };

  const call = () => phone && Linking.openURL(`tel:${phone}`).catch(() => {});

  return (
    <View style={styles.row}>
      <IconButton icon="navigation" label={t('load.navigate')} tone="teal" onPress={navigate} />
      <IconButton icon="phone" label={t('load.call')} tone="go" onPress={call} />
      <IconButton icon="message-circle" label={t('tabs.chat')} tone="teal" onPress={onChat} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3] },
});
