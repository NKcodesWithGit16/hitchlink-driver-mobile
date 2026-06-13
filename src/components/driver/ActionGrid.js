import { View, StyleSheet, Linking, Platform } from 'react-native';
import IconButton from '../ui/IconButton';
import { space } from '../../theme/tokens';

/* Navigate / Call / Chat — the three things a driver reaches for.
   Navigate HANDS OFF to the phone's own maps app (never in-app). */
export default function ActionGrid({ address, phone, onChat }) {
  const navigate = () => {
    const q = encodeURIComponent(address || '');
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${q}`,
      android: `google.navigation:q=${q}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`),
    );
  };

  const call = () => phone && Linking.openURL(`tel:${phone}`).catch(() => {});

  return (
    <View style={styles.row}>
      <IconButton icon="navigation" label="Navigate" tone="teal" onPress={navigate} />
      <IconButton icon="phone" label="Call" tone="go" onPress={call} />
      <IconButton icon="message-circle" label="Chat" tone="teal" onPress={onChat} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3] },
});
