import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Image, Alert,
  KeyboardAvoidingView, ActivityIndicator, Platform, BackHandler, Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';

import Icon from '../src/components/ui/Icon';
import FadeInView from '../src/components/ui/FadeInView';
import PrimaryAction from '../src/components/ui/PrimaryAction';
import SectionLabel from '../src/components/ui/SectionLabel';
import ActionSheet from '../src/components/driver/ActionSheet';
import haptics from '../src/lib/haptics';
import { useTheme } from '../src/theme/ThemeContext';
import { useT } from '../src/i18n/LanguageContext';
import { useAuth } from '../src/context/AuthContext';
import { useCallBannerInset } from '../src/components/call/CallOverlay';
import { updateDriver, uploadDriverPhoto, removeDriverPhoto } from '../src/api/main';
import { space, radius, type, FONT, tap, elevation, motion } from '../src/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gap between dismissing one Modal and presenting the next (or a native
// picker). iOS will not present while a dismissal is in flight — it freezes
// instead. Same constant and same reason as documents.js / messages.js.
const MODAL_HANDOFF_MS = 320;

// Tab order, which is also the order a failed save picks a field to focus.
const ORDER = ['firstName', 'lastName', 'phone', 'email'];

// Breathing room left between a focused field and whatever the keyboard (plus
// the save bar sitting on top of it) has taken over. Roughly covers the rest
// of the field block below the input's own baseline.
const KEYBOARD_GAP = 28;

/* Edit profile.
 *
 * The fields are big, left-aligned and tappable across their whole width on
 * purpose. The previous version put the label left and the value right-aligned
 * on one ~43px row, so the only thing that opened the keyboard was the text
 * itself — a moving target well under the 56px this app uses everywhere else,
 * and impossible with gloves on. Every field here is one 68px block: tap
 * anywhere in it (label, icon, empty space) and it focuses.
 *
 * Saving is the standard 64px PrimaryAction pinned to the bottom rather than a
 * small "Save" link in the header, and it rides above the keyboard so a driver
 * never has to dismiss the keyboard to find it.
 */
export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const callInset = useCallBannerInset();
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

  const [form,      setForm]      = useState(initial);
  const [errors,    setErrors]    = useState({});
  const [focused,   setFocused]   = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');
  const [sheet,     setSheet]     = useState(null); // 'photo' | 'discard'

  const [photoUrl,  setPhotoUrl]  = useState(driverProfile?.photoUrl || user?.photoUrl || null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [kbUp,      setKbUp]      = useState(false);

  const inputs = {
    firstName: useRef(null),
    lastName:  useRef(null),
    phone:     useRef(null),
    email:     useRef(null),
  };

  const scrollRef  = useRef(null);
  const offsetRef  = useRef(0);   // live scroll position
  const footerRef  = useRef(0);   // measured height of the save bar
  const keyboardY  = useRef(0);   // top edge of the keyboard, 0 when hidden
  const focusedRef = useRef(null);

  /* Shrinking the scroll view is only half the job: it stops the keyboard
     covering anything, but the field the driver just tapped can still be below
     the fold — Phone and Email are the bottom two, which is exactly where the
     overlap was reported. So scroll it back into view, and by the MINIMUM
     amount: yanking the form to the top on every focus is its own annoyance.

     Measured in window coordinates against the keyboard's own reported top
     edge, so it needs no assumptions about insets, the header, or how tall a
     particular keyboard (or its autofill/emoji bar) happens to be. */
  const ensureVisible = useCallback((kbTop) => {
    const key = focusedRef.current;
    const node = key ? inputs[key].current : null;
    if (!node?.measureInWindow || !kbTop) return;
    node.measureInWindow((x, y, w, h) => {
      if (typeof y !== 'number' || typeof h !== 'number') return;
      const limit = kbTop - footerRef.current - KEYBOARD_GAP;
      const delta = (y + h) - limit;
      if (delta > 1) scrollRef.current?.scrollTo({ y: offsetRef.current + delta, animated: true });
    });
  }, []);

  useEffect(() => {
    // iOS reports the frame before it animates, so the scroll rides along with
    // the keyboard instead of chasing it; Android only reports once it's up.
    // WillChangeFrame rather than WillShow so switching to emoji/autofill —
    // which changes the height without a fresh "show" — is picked up too.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvt, (e) => {
      const top = e?.endCoordinates?.screenY;
      if (typeof top !== 'number') return;
      // On iOS that same event fires as it leaves, with the frame parked just
      // off the bottom of the window — which is "hidden", not a 0-height one.
      const up = top < winH - 1;
      keyboardY.current = up ? top : 0;
      setKbUp(up);
      if (up) ensureVisible(top);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardY.current = 0;
      setKbUp(false);
    });
    return () => { show.remove(); hide.remove(); };
  }, [ensureVisible, winH]);

  // The profile can land after this screen mounts (a cold start straight into
  // More › Profile), and useState only reads its initial value once. Seed the
  // form when it arrives — but never over something already typed, which is
  // what `edited` guards: the fetch can easily land mid-keystroke.
  const seeded = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (seeded.current || edited.current) return;
    if (!ORDER.some((k) => initial[k])) return;
    seeded.current = true;
    setForm(initial);
    // Only if the driver hasn't just picked one — that upload is optimistic.
    setPhotoUrl((p) => p || driverProfile?.photoUrl || user?.photoUrl || null);
  }, [initial, driverProfile, user]);

  const dirty = ORDER.some((k) => form[k].trim() !== initial[k]);

  const setField = (key, v) => {
    edited.current = true;
    setForm((f) => ({ ...f, [key]: v }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
    if (formError) setFormError('');
  };

  const errorFor = useCallback((key, value) => {
    const v = (value ?? '').trim();
    if (key === 'firstName') return v ? null : t('editProfile.firstNameRequired');
    if (key === 'lastName')  return v ? null : t('editProfile.lastNameRequired');
    if (key === 'phone')     return v ? null : t('editProfile.enterPhone');
    if (key === 'email')     return EMAIL_RE.test(v) ? null : t('editProfile.enterValidEmail');
    return null;
  }, [t]);

  // Validate on blur so a mistake is flagged as the driver leaves the field,
  // not only when they reach the bottom of the screen. An empty field they
  // never touched stays quiet — that is the save button's job.
  const onBlurField = (key) => {
    setFocused((f) => (f === key ? null : f));
    if (!form[key].trim() && !initial[key]) return;
    const e = errorFor(key, form[key]);
    if (e) setErrors((prev) => ({ ...prev, [key]: e }));
  };

  const onSave = async () => {
    if (saving) return;

    const found = {};
    ORDER.forEach((k) => { found[k] = errorFor(k, form[k]); });
    const firstBad = ORDER.find((k) => found[k]);
    if (firstBad) {
      setErrors(found);
      haptics.error();
      inputs[firstBad].current?.focus();
      return;
    }

    const payload = {
      firstName:   form.firstName.trim(),
      lastName:    form.lastName.trim(),
      phoneNumber: form.phone.trim(),
      email:       form.email.trim(),
    };

    setErrors({});
    setFormError('');
    setSaving(true);
    haptics.press();
    try {
      await updateDriver(userId, payload);
      updateDriverProfile(payload);
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

  /* Leaving with unsaved edits asks first — the fields are small enough to
     re-type but a mistyped phone number is how a dispatcher loses a driver. */
  const attemptLeave = useCallback(() => {
    if (saving) return true;
    if (dirty) { haptics.warning(); setSheet('discard'); return true; }
    haptics.tap();
    router.back();
    return false;
  }, [dirty, saving, router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty && !saving) return false;  // let expo-router pop normally
      attemptLeave();
      return true;
    });
    return () => sub.remove();
  }, [dirty, saving, attemptLeave]);

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
      const res = await launch({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        // allowsEditing already forces a re-encode on iOS, so this is belt and
        // braces — but it keeps every library picker in the app consistent.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (uri) await savePhoto(uri);
    } catch {
      Alert.alert(t('editProfile.couldntOpenTitle'), t('editProfile.couldntOpenBody'));
    }
  };

  const openPhotoSheet = () => {
    if (photoBusy) return;
    haptics.tap();
    setSheet('photo');
  };

  /* Not Alert.alert: with a photo already set this is three options plus
     Cancel, and Android's dialog renders at most three buttons — one would
     silently vanish. Web has no Alert at all. The sheet also stands down
     before the native picker is launched (see MODAL_HANDOFF_MS). */
  const photoActions = useMemo(() => ([
    { key: 'camera',  icon: 'camera', label: t('editProfile.takePhoto') },
    { key: 'library', icon: 'image',  label: t('editProfile.chooseFromLibrary') },
    photoUrl ? { key: 'remove', icon: 'trash-2', label: t('editProfile.removePhoto'), tone: 'danger' } : null,
  ]), [t, photoUrl]);

  const onPhotoAction = (key) => {
    setSheet(null);
    setTimeout(() => {
      if (key === 'remove') removePhoto();
      else pickFrom(key);
    }, MODAL_HANDOFF_MS);
  };

  const discardActions = useMemo(() => ([
    { key: 'save',    icon: 'check',   label: t('editProfile.saveChanges') },
    { key: 'discard', icon: 'trash-2', label: t('editProfile.discardChanges'), tone: 'danger' },
  ]), [t]);

  const onDiscardAction = (key) => {
    setSheet(null);
    if (key === 'discard') { router.back(); return; }
    setTimeout(onSave, MODAL_HANDOFF_MS);
  };

  const fieldProps = (key) => ({
    inputRef: inputs[key],
    value: form[key],
    onChangeText: (v) => setField(key, v),
    onFocus: () => {
      setFocused(key);
      focusedRef.current = key;
      // Moving between fields with the keyboard already up fires no keyboard
      // event, so nothing else would bring the new one into view.
      if (keyboardY.current) requestAnimationFrame(() => ensureVisible(keyboardY.current));
    },
    onBlur: () => onBlurField(key),
    focused: focused === key,
    error: errors[key],
    colors,
    styles,
  });

  const next = (key) => {
    const i = ORDER.indexOf(key);
    return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
  };
  const chain = (key) => {
    const n = next(key);
    return n
      ? { returnKeyType: 'next', submitBehavior: 'submit', onSubmitEditing: () => inputs[n].current?.focus() }
      : { returnKeyType: 'done', onSubmitEditing: onSave };
  };

  const initialLetter = (form.firstName || t('more.driver')).slice(0, 1).toUpperCase();

  return (
    <View style={styles.screen}>
      {/* The KAV has to be the full-height child, with the top inset applied
          INSIDE it — not to a padded parent. `padding` mode works out the
          overlap from its own onLayout frame, and that frame's y is relative
          to its parent's content box, so any padding above it is invisible to
          the calculation: it under-shifts by exactly the inset + header and
          the keyboard covers the bottom fields. Same arrangement as sign-in. */}
      <KeyboardAvoidingView behavior="padding" style={styles.kav}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + callInset + space[3] }]}>
          <Pressable
            onPress={attemptLeave}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: colors.surface, borderColor: colors.border, transform: [{ scale: pressed ? motion.press : 1 }] },
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Icon name="chevron-left" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t('editProfile.editProfileTitle')}</Text>
          {/* Balances the back button so the title stays optically centred.
              Save lives at the bottom, as a full-size action. */}
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.y; }}
        >
          {/* Avatar */}
          <FadeInView style={styles.avatarWrap}>
            <Pressable
              onPress={openPhotoSheet}
              style={({ pressed }) => [styles.avatarPress, { transform: [{ scale: pressed ? motion.press : 1 }] }]}
              accessibilityRole="button"
              accessibilityLabel={t('editProfile.changePhotoA11y')}
            >
              <View style={[styles.avatarRing, { borderColor: colors.border, backgroundColor: colors.surface }, elevation[2]]}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.avatar} />
                ) : (
                  <LinearGradient colors={colors.gradients.brand} style={styles.avatar}>
                    <Text style={styles.avatarText}>{initialLetter}</Text>
                  </LinearGradient>
                )}
                {photoBusy ? (
                  <View style={styles.avatarBusy}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <View style={[styles.avatarBadge, { backgroundColor: colors.teal, borderColor: colors.bg }]}>
                <Icon name="camera" size={15} color={colors.onAccent} />
              </View>
            </Pressable>

            {/* The badge alone reads as decoration to plenty of drivers — spell
                out that the avatar is tappable. */}
            <Pressable onPress={openPhotoSheet} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.photoLink, { color: colors.teal }]}>
                {photoUrl ? t('editProfile.changePhoto') : t('editProfile.addPhoto')}
              </Text>
            </Pressable>
          </FadeInView>

          {/* Name */}
          <FadeInView delay={motion.stagger}>
            <SectionLabel>{t('editProfile.sectionName')}</SectionLabel>
            <View style={styles.group}>
              <ProfileField
                {...fieldProps('firstName')}
                {...chain('firstName')}
                label={t('editProfile.firstName')}
                icon="user"
                placeholder={t('editProfile.firstNamePlaceholder')}
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
              />
              <ProfileField
                {...fieldProps('lastName')}
                {...chain('lastName')}
                label={t('editProfile.lastName')}
                icon="user"
                placeholder={t('editProfile.lastNamePlaceholder')}
                autoCapitalize="words"
                autoComplete="family-name"
                textContentType="familyName"
              />
            </View>
          </FadeInView>

          {/* Contact */}
          <FadeInView delay={motion.stagger * 2}>
            <SectionLabel>{t('editProfile.sectionContact')}</SectionLabel>
            <View style={styles.group}>
              <ProfileField
                {...fieldProps('phone')}
                {...chain('phone')}
                label={t('editProfile.phone')}
                icon="phone"
                placeholder={t('editProfile.phoneNumberPlaceholder')}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
              <ProfileField
                {...fieldProps('email')}
                {...chain('email')}
                label={t('editProfile.email')}
                icon="mail"
                placeholder={t('editProfile.emailAddressPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
              />
            </View>
          </FadeInView>

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {t('editProfile.managedByDispatcher')}
          </Text>
        </ScrollView>

        {/* Save rides above the keyboard — inside the KAV, outside the scroll.
            Its measured height is what ensureVisible has to clear as well. */}
        <View
          onLayout={(e) => { footerRef.current = e.nativeEvent.layout.height; }}
          style={[
            styles.footer,
            {
              backgroundColor: colors.bg,
              borderTopColor: colors.border,
              // The home-indicator inset is the keyboard's problem while it's
              // up — keeping it would float the button on a band of empty bg.
              paddingBottom: (kbUp ? 0 : insets.bottom) + space[3],
            },
          ]}
        >
          {formError ? (
            <View style={[styles.errorBanner, { backgroundColor: colors.dangerFill }]}>
              <Icon name="alert-circle" size={16} color={colors.danger} />
              <Text style={[styles.errorBannerText, { color: colors.danger }]}>{formError}</Text>
            </View>
          ) : null}
          <PrimaryAction
            label={t('editProfile.saveChanges')}
            icon="check"
            onPress={onSave}
            loading={saving}
            disabled={!dirty}
          />
        </View>
      </KeyboardAvoidingView>

      {sheet === 'photo' && (
        <ActionSheet
          title={t('editProfile.profilePhoto')}
          subtitle={t('editProfile.photoSourceSub')}
          actions={photoActions}
          onSelect={onPhotoAction}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'discard' && (
        <ActionSheet
          title={t('editProfile.discardTitle')}
          subtitle={t('editProfile.discardSub')}
          actions={discardActions}
          onSelect={onDiscardAction}
          onClose={() => setSheet(null)}
        />
      )}
    </View>
  );
}

/* One field = one block. The whole block is a press target that focuses the
   input, so the tappable area is the 68px card rather than the width of the
   text inside it. The label doubles as the focus indicator (it turns teal), so
   nothing has to move or resize when the keyboard opens. */
function ProfileField({
  label, icon, inputRef, value, onChangeText, onFocus, onBlur,
  focused, error, placeholder, colors, styles, ...inputProps
}) {
  const t = useT();
  const accent = error ? colors.danger : focused ? colors.teal : null;

  return (
    <View>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessible={false}
        style={[
          styles.field,
          {
            backgroundColor: error ? colors.dangerFill : focused ? colors.surface2 : colors.surface,
            borderColor: accent || colors.border,
          },
          focused && elevation[1],
        ]}
      >
        <Icon name={icon} size={20} color={accent || colors.textMuted} />

        <View style={styles.fieldBody}>
          <Text style={[styles.fieldLabel, { color: accent || colors.textMuted }]} numberOfLines={1}>
            {label}
          </Text>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={[styles.fieldInput, { color: colors.textPrimary }]}
            underlineColorAndroid="transparent"
            accessibilityLabel={label}
            {...inputProps}
          />
        </View>

        {focused && value ? (
          <Pressable
            onPress={() => { haptics.tap(); onChangeText(''); inputRef.current?.focus(); }}
            hitSlop={10}
            style={[styles.clearBtn, { backgroundColor: colors.surfaceHi }]}
            accessibilityRole="button"
            accessibilityLabel={t('editProfile.clearFieldA11y', { field: label })}
          >
            <Icon name="x" size={13} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>

      {error ? (
        <View style={styles.fieldError}>
          <Icon name="alert-circle" size={13} color={colors.danger} />
          <Text style={[styles.fieldErrorText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const AVATAR = 104;

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  backBtn: {
    width: tap.icon, height: tap.icon, borderRadius: radius.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...type.title, letterSpacing: -0.2 },
  headerSpacer: { width: tap.icon, height: tap.icon },

  kav: { flex: 1 },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  avatarWrap: { alignItems: 'center', marginTop: space[2], marginBottom: space[4], gap: space[3] },
  avatarPress: { padding: 3 },
  avatarRing: {
    width: AVATAR + 8, height: AVATAR + 8, borderRadius: radius.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 40, fontFamily: FONT.black, color: '#FFFFFF' },
  avatarBusy: {
    ...StyleSheet.absoluteFillObject, borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 34, height: 34, borderRadius: radius.pill, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  photoLink: { fontSize: 15, fontFamily: FONT.bold, letterSpacing: -0.2 },

  group: { gap: space[3] },

  field: {
    minHeight: 68, borderRadius: radius.lg, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingHorizontal: space[4], paddingVertical: space[2],
  },
  fieldBody: { flex: 1, gap: 2 },
  fieldLabel: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.7, textTransform: 'uppercase' },
  fieldInput: {
    fontSize: 17, fontFamily: FONT.semibold, letterSpacing: -0.2,
    padding: 0, margin: 0, minHeight: 24,
    ...(Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : null),
  },
  clearBtn: { width: 26, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },

  fieldError: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[3], paddingTop: 6 },
  fieldErrorText: { ...type.caption, fontFamily: FONT.bold, flex: 1 },

  hint: {
    ...type.caption, textAlign: 'center', lineHeight: 19,
    paddingHorizontal: space[4], marginTop: space[5],
  },

  footer: { paddingHorizontal: space[5], paddingTop: space[3], borderTopWidth: 1, gap: space[3] },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10,
  },
  errorBannerText: { ...type.caption, fontFamily: FONT.bold, flex: 1 },
});
