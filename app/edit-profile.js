import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Image, Alert,
  KeyboardAvoidingView, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useT } from '../src/i18n/LanguageContext';
import { useAuth } from '../src/context/AuthContext';
import { updateDriver, uploadDriverPhoto, removeDriverPhoto } from '../src/api/main';
import { space, radius, FONT, elevation } from '../src/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const t = useT();
  const { userId, driverProfile, user, updateDriverProfile } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Prefer the raw driver record (camelCase phoneNumber) over the mapped
  // `user` object — this form writes straight back to those same fields.
  const initial = useMemo(() => ({
    firstName: driverProfile?.firstName   || user?.firstName || '',
    lastName:  driverProfile?.lastName    || user?.lastName  || '',
    phone:     driverProfile?.phoneNumber || user?.phone     || '',
    email:     driverProfile?.email       || user?.email     || '',
  }), [driverProfile, user]);

  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName,  setLastName]  = useState(initial.lastName);
  const [phone,     setPhone]     = useState(initial.phone);
  const [email,     setEmail]     = useState(initial.email);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');

  const [photoUrl,  setPhotoUrl]  = useState(driverProfile?.photoUrl || user?.photoUrl || null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const dirty =
    firstName.trim() !== initial.firstName ||
    lastName.trim()  !== initial.lastName  ||
    phone.trim()     !== initial.phone     ||
    email.trim()     !== initial.email;

  const canSave = dirty && !saving;

  const onSave = async () => {
    if (!canSave) return;
    const fn = firstName.trim(), ln = lastName.trim(), ph = phone.trim(), em = email.trim();
    if (!fn || !ln) { setFormError(t('editProfile.firstLastRequired')); haptics.error(); return; }
    if (!ph)        { setFormError(t('editProfile.enterPhone'));        haptics.error(); return; }
    if (!EMAIL_RE.test(em)) { setFormError(t('editProfile.enterValidEmail')); haptics.error(); return; }

    setFormError('');
    setSaving(true);
    haptics.press();
    try {
      await updateDriver(userId, { firstName: fn, lastName: ln, phoneNumber: ph, email: em });
      updateDriverProfile({ firstName: fn, lastName: ln, phoneNumber: ph, email: em });
      haptics.success();
      router.back();
    } catch (e) {
      setFormError(
        e.status === 400
          ? t('editProfile.emailPhoneInUse')
          : t('editProfile.saveFailedError')
      );
      haptics.error();
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => { haptics.tap(); router.back(); };

  const savePhoto = async (uri) => {
    const prev = photoUrl;
    setPhotoUrl(uri); // optimistic — the camera/library shot itself, before it's uploaded
    setPhotoBusy(true);
    try {
      const result = await uploadDriverPhoto(userId, uri);
      const finalUrl = result?.photoUrl || uri;
      setPhotoUrl(finalUrl);
      updateDriverProfile({ photoUrl: finalUrl });
      haptics.success();
    } catch {
      setPhotoUrl(prev);
      haptics.error();
      Alert.alert(t('editProfile.couldntUploadTitle'), t('editProfile.couldntUploadBody'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    const prev = photoUrl;
    setPhotoUrl(null);
    setPhotoBusy(true);
    try {
      await removeDriverPhoto(userId);
      updateDriverProfile({ photoUrl: null });
      haptics.success();
    } catch {
      setPhotoUrl(prev);
      haptics.error();
      Alert.alert(t('editProfile.couldntRemoveTitle'), t('editProfile.couldntRemoveBody'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const pickFrom = async (source) => {
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('editProfile.permissionNeededTitle'),
          t('editProfile.permissionNeededBody', { source: source === 'camera' ? t('editProfile.cameraAccess') : t('editProfile.libraryAccess') }),
        );
        return;
      }
      const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const res = await launch({ allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (uri) await savePhoto(uri);
    } catch {
      Alert.alert(t('editProfile.couldntOpenTitle'), t('editProfile.couldntOpenBody'));
    }
  };

  const choosePhoto = () => {
    if (photoBusy) return;
    haptics.tap();
    Alert.alert(t('editProfile.profilePhoto'), undefined, [
      { text: t('editProfile.takePhoto'), onPress: () => pickFrom('camera') },
      { text: t('editProfile.chooseFromLibrary'), onPress: () => pickFrom('library') },
      ...(photoUrl ? [{ text: t('editProfile.removePhoto'), style: 'destructive', onPress: removePhoto }] : []),
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onCancel}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t('editProfile.editProfileTitle')}</Text>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          hitSlop={8}
          style={styles.saveBtn}
          accessibilityRole="button"
          accessibilityLabel={t('editProfile.saveChangesA11y')}
          accessibilityState={{ disabled: !canSave }}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.teal} />
          ) : (
            <Text style={[styles.saveText, { color: canSave ? colors.teal : colors.textMuted }]}>{t('editProfile.save')}</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space[8] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <FadeInView style={styles.avatarWrap}>
            <Pressable
              onPress={choosePhoto}
              accessibilityRole="button"
              accessibilityLabel={t('editProfile.changePhotoA11y')}
            >
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={colors.gradients.brand} style={styles.avatar}>
                  <Text style={styles.avatarText}>{(firstName || t('more.driver')).slice(0, 1).toUpperCase()}</Text>
                </LinearGradient>
              )}
              {photoBusy ? (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : (
                <View style={[styles.avatarBadge, { backgroundColor: colors.teal, borderColor: colors.bg }]}>
                  <Icon name="camera" size={13} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
          </FadeInView>

          {/* Fields */}
          <FadeInView delay={40} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation[1]]}>
            <FieldRow
              label={t('editProfile.firstName')} value={firstName} onChangeText={setFirstName}
              placeholder={t('editProfile.firstName')} autoCapitalize="words" colors={colors} styles={styles}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <FieldRow
              label={t('editProfile.lastName')} value={lastName} onChangeText={setLastName}
              placeholder={t('editProfile.lastName')} autoCapitalize="words" colors={colors} styles={styles}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <FieldRow
              label={t('editProfile.phone')} value={phone} onChangeText={setPhone}
              placeholder={t('editProfile.phoneNumberPlaceholder')} keyboardType="phone-pad" colors={colors} styles={styles}
            />
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <FieldRow
              label={t('editProfile.email')} value={email} onChangeText={setEmail}
              placeholder={t('editProfile.emailAddressPlaceholder')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              colors={colors} styles={styles}
            />
          </FadeInView>

          {formError ? (
            <FadeInView style={styles.errorRow}>
              <Icon name="alert-circle" size={14} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{formError}</Text>
            </FadeInView>
          ) : null}

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {t('editProfile.managedByDispatcher')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldRow({ label, value, onChangeText, placeholder, colors, styles, ...inputProps }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.fieldInput, { color: colors.textPrimary }]}
        {...inputProps}
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontFamily: FONT.bold },
  saveBtn: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center', paddingVertical: space[2] },
  saveText: { fontSize: 16, fontFamily: FONT.black },

  scroll: { paddingHorizontal: space[5], gap: space[4] },

  avatarWrap: { alignItems: 'center', marginTop: space[2], marginBottom: space[2] },
  avatar: { width: 88, height: 88, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 34, fontFamily: FONT.black, color: '#FFFFFF' },
  avatarBusy: {
    ...StyleSheet.absoluteFillObject, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 28, height: 28, borderRadius: 999, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },

  card: { borderRadius: radius.xl, borderWidth: 1, paddingHorizontal: space[4] },
  divider: { height: 1 },

  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: 14 },
  fieldLabel: { width: 92, fontSize: 14, fontFamily: FONT.medium, flexShrink: 0 },
  fieldInput: { flex: 1, fontSize: 15, fontFamily: FONT.semibold, textAlign: 'right', padding: 0 },

  errorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space[2],
  },
  errorText: { fontSize: 12, fontFamily: FONT.bold, flex: 1 },

  hint: { fontSize: 12, fontFamily: FONT.medium, textAlign: 'center', lineHeight: 17, paddingHorizontal: space[4] },
});
