import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, Animated, Alert, RefreshControl, Linking, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenFade from '../../src/components/ui/ScreenFade';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import Icon from '../../src/components/ui/Icon';
import FadeInView from '../../src/components/ui/FadeInView';
import Skeleton from '../../src/components/ui/Skeleton';
import DocumentReviewModal from '../../src/components/driver/DocumentReviewModal';
import { useReduceMotion } from '../../src/lib/useReduceMotion';
import haptics from '../../src/lib/haptics';
import { canPreview, previewAsync } from 'hitchlink-quicklook';
import { useTheme } from '../../src/theme/ThemeContext';
import { useT } from '../../src/i18n/LanguageContext';
import { useAuth } from '../../src/context/AuthContext';
import {
  uploadDocument, deleteDocument, fetchDocumentContent,
  extractDocumentFields, readDocumentBase64, normalizeDocumentImage,
} from '../../src/api/main';
import {
  loadDocuments, syncOfflineCopies, cachedFileFor, cachedIds, ensureCached,
  sortDocuments, CREDENTIAL_TYPES,
} from '../../src/lib/docCache';
import PhotoViewer from '../../src/components/driver/PhotoViewer';
import DocThumb from '../../src/components/driver/DocThumb';
import DocFocusOverlay from '../../src/components/driver/DocFocusOverlay';
import ActionSheet from '../../src/components/driver/ActionSheet';
import { fileKind, baseMime } from '../../src/lib/imageMime';
import { expiryStatus, fmtDate, daysUntil, fileSize } from '../../src/lib/format';
import { scheduleDocumentExpiryReminders } from '../../src/lib/localNotifications';
import { space, type, radius, toneOf, FONT, shadow } from '../../src/theme/tokens';
import { TAB_BAR_CLEARANCE } from './_layout';
import { useCallBannerInset } from '../../src/components/call/CallOverlay';

// How old the saved copy is, in compact units only. format.relativeMinutes
// would be the obvious reuse, but it returns the words "now" and "Yesterday",
// which don't survive being dropped into "…from {age} ago".
const ageLabel = (ms) => {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

// The AI read is skipped above this — see extractDocumentFields.
const AI_READ_SIZE_CAP = 8 * 1024 * 1024;

// Long enough for a full-screen Modal's slide-out to finish before another is
// presented. See openSourceAfterModal.
const MODAL_HANDOFF_MS = 320;

/* The three ways a document gets onto this screen, normalized to the one shape
   DocumentReviewModal consumes: { uri, name, mimeType, size, base64 }.
   expo-document-picker and expo-image-picker disagree on almost every field
   name, and getting mimeType wrong is not cosmetic — both the AI read and the
   thumbnail are gated on it, so a missing one silently costs the driver the
   auto-filled expiry date and the card its preview.

   THE CAMERA AND LIBRARY ROUTES ARE THE POINT. Calling getDocumentAsync with a
   wildcard type reads as "anything", and on iOS it is not:
   UIDocumentPickerViewController browses Files, which cannot see the photo
   library at all. A driver who photographed their CDL — the ordinary way a
   credential gets into this app — could not add it without first exporting the
   photo to Files by hand. */
async function pickAsset(source, t) {
  // Files is the fallback, not the photo library: an unrecognised source should
  // land on the picker that can open anything, not silently on one that can't.
  if (source !== 'camera' && source !== 'library') {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, base64: true });
    if (res.canceled) return null;
    const a = res.assets?.[0];
    if (!a?.uri) return null;
    return { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size, base64: a.base64 };
  }

  const camera = source === 'camera';
  const perm = camera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      t('documents.permissionNeededTitle'),
      t('documents.permissionNeededBody', {
        source: camera ? t('documents.cameraAccess') : t('documents.libraryAccess'),
      }),
    );
    return null;
  }

  const launch = camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const res = await launch({
    quality: 0.85,
    // iOS hands back HEIC for a camera photo picked out of the library, which no
    // browser can decode — and the dispatcher reads these in one. Ignored on
    // Android and by the camera; normalizeDocumentImage below is the guarantee.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled) return null;
  const a = res.assets?.[0];
  if (!a?.uri) return null;

  return {
    uri: a.uri,
    // The library usually supplies a real filename; the camera never does.
    name: a.fileName || `document-${Date.now()}.jpg`,
    mimeType: a.mimeType || 'image/jpeg',
    size: a.fileSize,
    base64: a.base64,
  };
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  // Extra top padding while a call is minimized to the banner, so the screen
  // header isn't hidden behind it.
  const callInset = useCallBannerInset();
  const { colors } = useTheme();
  const t = useT();
  const { userId } = useAuth();

  const FILTERS = [
    { key: 'all',      label: t('documents.filterAll')      },
    { key: 'valid',    label: t('documents.filterValid')    },
    { key: 'expiring', label: t('documents.filterExpiring') },
    { key: 'expired',  label: t('documents.filterExpired')  },
  ];
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [docs, setDocs]     = useState([]);
  const [open, setOpen]     = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding]   = useState(false);
  // Serving the last-known list because the network is unreachable. Not an
  // error — the whole point of the offline cache — so it gets a banner rather
  // than the error box that used to swallow the entire screen.
  const [stale, setStale]     = useState(null);   // { savedAt } | null
  // Which documents can be opened with no signal, for the card's offline dot.
  const [offline, setOffline] = useState(() => new Set());
  // The fullscreen viewer: { uris, captions }. One mount, two ways in —
  // inspection mode and tapping a single image document. Both are local files.
  const [photoView, setPhotoView] = useState(null);
  const [opening, setOpening]     = useState(false);  // inspection bar
  const [openingId, setOpeningId] = useState(null);   // doc being opened from its card
  const [focus, setFocus]         = useState(null);   // doc under long-press
  const [renewing, setRenewing]   = useState(null);   // doc id mid-renewal
  // Which flow is waiting on a camera/library/files answer: { mode, doc? }.
  const [pickTarget, setPickTarget] = useState(null);

  // Add-document review flow: pick → (maybe) AI-extract → editable review
  // modal → save. The actual POST /documents happens inside the modal.
  const [reviewVisible, setReviewVisible]   = useState(false);
  const [reviewAsset, setReviewAsset]       = useState(null);
  const [reviewExtraction, setReviewExtraction]           = useState(null);
  const [reviewExtractionError, setReviewExtractionError] = useState(null);
  // Seeds the form when the AI read nothing — a renewal already knows its type,
  // label and number, so only the new expiry date is genuinely unknown.
  const [reviewDefaults, setReviewDefaults] = useState(null);
  // Set while the review modal holds the replacement for an existing document.
  const [replacingId, setReplacingId]       = useState(null);

  const refreshOfflineFlags = useCallback(async () => {
    if (!userId) return;
    try { setOffline(await cachedIds(userId)); } catch {}
  }, [userId]);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      // Network first, last good response as the fallback. Only a failure with
      // nothing stored is a real error.
      const { docs: d, fromCache, savedAt } = await loadDocuments(userId);
      setDocs(d || []);
      setStale(fromCache ? { savedAt } : null);
      setError(false);
      await refreshOfflineFlags();
      if (!fromCache) {
        // Bring the offline copies in line in the background. Failures are
        // swallowed inside syncOfflineCopies — it's an optimization, and a
        // driver should never see it fail.
        syncOfflineCopies(userId, d || [], { onChange: refreshOfflineFlags })
          .then((res) => {
            refreshOfflineFlags();
            // A backfilled preview is on the phone already, but a card only
            // looks for one once the list says the document has it. One
            // refetch flips that; it can't loop, because the sync marks each
            // document it filled in and won't offer it again.
            if (res?.backfilled) loadData();
          })
          .catch(() => {});
      }
    } catch {
      // Unreachable AND nothing stored — the only case that's still a hard
      // failure. Drop the banner so it can't sit above the error box.
      setStale(null);
      setError(true);
    }
  }, [userId, refreshOfflineFlags]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [userId, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Expiry only ever surfaced on this screen, which a driver has no reason to
  // open until something has already lapsed. Schedule on-device reminders at
  // 30/7/1 days out so the phone raises it instead. Re-run on every refetch:
  // the helper clears its previous schedule first, so renewing or deleting a
  // document stops its reminders.
  useEffect(() => {
    if (!docs.length) return;
    scheduleDocumentExpiryReminders(docs, (doc, days) => ({
      title: t('reminders.docExpiryTitle', { label: doc.label }),
      body: days === 1
        ? t('reminders.docExpiryBodyTomorrow', { label: doc.label })
        : t('reminders.docExpiryBodyDays', { label: doc.label, days }),
    })).catch(() => {});
  }, [docs, t]);

  const counts = useMemo(() => {
    const c = { valid: 0, expiring: 0, expired: 0 };
    docs.forEach(d => { c[expiryStatus(d.expires).key]++; });
    return c;
  }, [docs]);

  const savedCount = useMemo(
    () => docs.filter(d => offline.has(String(d.id))).length,
    [docs, offline]);

  /* Inspection mode. The real use of this screen is handing the phone to an
     officer at a scale, which today costs a tap into a card, a tap to view, and
     a download. This is that in one tap, off the offline copies, in the order a
     DOT inspection asks for them.

     Only image credentials can go in the viewer — a PDF is a different renderer
     entirely — so readiness is reported HERE rather than as a placeholder slide
     inside it. A driver needs to find out that their registration isn't on the
     phone while they're still parked, not while an officer is waiting. */
  const inspectable = useMemo(() => {
    const creds = CREDENTIAL_TYPES.map(type => docs.find(d => d.type === type)).filter(Boolean);
    const ready = creds.filter(d =>
      offline.has(String(d.id)) && baseMime(d.contentType).startsWith('image/'));
    return { creds, ready };
  }, [docs, offline]);

  const openInspection = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const uris = [];
      const captions = [];
      for (const d of inspectable.ready) {
        // Already offline by construction, so this is a disk read — but go
        // through the same path so a file evicted since the last render still
        // resolves rather than opening a dead uri.
        const file = await cachedFileFor(userId, d.id).catch(() => null);
        if (file?.uri) { uris.push(file.uri); captions.push(d.label); }
      }
      if (!uris.length) {
        Alert.alert(t('documents.inspectionEmptyTitle'), t('documents.inspectionEmptyBody'));
        return;
      }
      haptics.success();
      setPhotoView({ uris, captions });
    } finally {
      setOpening(false);
    }
  };

  /* Tapping a card opens the DOCUMENT, not a page about it.
     The detail sheet it used to open repeated the card almost field for field —
     number, expiry, status, countdown — so the tap bought a driver nothing.
     What they came for is the scan itself: the photo of the CDL, the PDF of the
     registration. Renew and Delete moved to the long press (DocFocusOverlay).

     Three renderers, because a document is not always an image:
       image → PhotoViewer, so it pinches and zooms (an officer reading a small
               number off a scan is the whole point of this screen)
       other → QuickLook on iOS, which renders a PDF in place; everything else,
               and all of Android, falls through to the share sheet, which is
               what the old View button already did
       no file at all → the detail sheet, which is now its only job: it is the
               one thing that can say "no file attached" and offer a fix.

     Prefers the offline copy: it opens instantly and it is the only thing that
     works with no signal. If refreshing it fails we fall back to whatever is
     already on disk — a slightly older CDL beats an error box at a weigh
     station. */
  const openDocument = useCallback(async (doc) => {
    if (!doc || openingId) return;
    if (!(doc.hasContent || doc.url)) { setOpen(doc); return; }

    setOpeningId(String(doc.id));
    try {
      if (doc.url && !doc.hasContent) {
        await Linking.openURL(doc.url);
        return;
      }
      let result = null;
      try {
        result = await ensureCached(userId, doc);
      } catch {
        result = await cachedFileFor(userId, doc.id);
      }
      // Web has no filesystem cache, and neither has a document the caching
      // policy never picked up. Fetch those the old way.
      if (!result) result = await fetchDocumentContent(doc.id, doc.fileName || doc.label);
      if (!result) {
        Alert.alert(t('documents.notAvailableTitle'), t('documents.notAvailableBody'));
        return;
      }
      if (Platform.OS === 'web') {
        window.open(result.uri, '_blank');
      } else if (baseMime(result.contentType).startsWith('image/')) {
        setPhotoView({ uris: [result.uri], captions: [doc.label] });
      } else if (canPreview(result.uri)) {
        await previewAsync(result.uri);
      } else {
        const available = await Sharing.isAvailableAsync();
        if (!available) throw new Error('Sharing unavailable on this device');
        // mimeType is Android-only, UTI is iOS-only — pass both, or the
        // receiving app on one platform gets no idea what it's being handed.
        await Sharing.shareAsync(result.uri, {
          mimeType: result.contentType,
          ...(result.uti ? { UTI: result.uti } : {}),
          dialogTitle: doc.label,
        });
      }
    } catch {
      haptics.error();
      Alert.alert(t('documents.couldNotOpen'), t('documents.pleaseTryAgain'));
    } finally {
      setOpeningId(null);
    }
  }, [openingId, userId, t]);

  const openFocus = useCallback((doc) => { haptics.impact(); setFocus(doc); }, []);

  // Delete from the focus overlay. The overlay owns the confirm, so by the time
  // this runs the driver has said yes twice.
  const removeDocument = useCallback(async (doc) => {
    try {
      await deleteDocument(doc.id);
      setFocus(null);
      await loadData();
    } catch {
      setFocus(null);
      haptics.error();
      Alert.alert(t('documents.couldNotDelete'), t('documents.pleaseTryAgain'));
    }
  }, [loadData, t]);

  // Sorted for the job, not by upload date: what's lapsed, then what's about
  // to, then the credentials in the order an inspection asks for them.
  const visible = useMemo(() => {
    const list = filter === 'all' ? docs : docs.filter(d => expiryStatus(d.expires).key === filter);
    return sortDocuments(list);
  }, [docs, filter]);

  // Picks a file, tries an AI read of it (images only, size-capped — see
  // extractDocumentFields), then always opens the review modal so the driver
  // confirms/corrects before anything is saved. Extraction failing is
  // expected (no quota left, AI not configured, non-image file) — it just
  // means the review modal opens on `defaults` instead of on read fields.
  //
  // Shared by "Add" and by a card's "Renew": the two differ only in what the
  // form starts from and whether an old document is retired afterwards.
  const pickForReview = useCallback(async (defaults, replaceId, onBusy, source) => {
    const picked = await pickAsset(source, t);
    if (!picked) return false;

    onBusy(true);
    try {
      // A photo is re-encoded to a web-safe JPEG and downscaled before anything
      // else reads it, so the AI, the thumbnail and the stored bytes all describe
      // the same file. Throws rather than falling back when it can't transcode —
      // a document the dispatcher can't open is worse than a failed add.
      const norm = await normalizeDocumentImage(picked.uri, picked.mimeType);
      const asset = norm
        ? {
            ...picked,
            uri: norm.uri,
            mimeType: norm.mimeType,
            size: norm.sizeBytes,
            // Only discard the picker's base64 when the bytes were actually
            // rewritten; a small web-safe photo passes through untouched and
            // re-reading it would be pure waste.
            base64: norm.uri === picked.uri ? picked.base64 : undefined,
          }
        : picked;

      const base64 = await readDocumentBase64(asset.uri, asset.base64);

      let extraction = null;
      let extractionError = null;
      const isImage = asset.mimeType?.startsWith('image/');
      const underSizeCap = !asset.size || asset.size <= AI_READ_SIZE_CAP;
      if (isImage && underSizeCap) {
        try {
          extraction = await extractDocumentFields({ base64, mediaType: asset.mimeType });
        } catch (e) {
          extractionError = e;
        }
      }

      setReviewAsset({ ...asset, base64 });
      setReviewExtraction(extraction);
      setReviewExtractionError(extractionError);
      setReviewDefaults(defaults || null);
      setReplacingId(replaceId || null);
      setReviewVisible(true);
      return true;
    } finally {
      onBusy(false);
    }
  }, [t]);

  const addDoc = useCallback(async (source) => {
    if (adding) return;
    try {
      await pickForReview(null, null, setAdding, source);
    } catch {
      setAdding(false);
      haptics.error();
      Alert.alert(t('documents.couldNotAdd'), t('documents.pleaseTryAgain'));
    }
  }, [adding, pickForReview, t]);

  /* Renewing a lapsed credential. Lives here rather than in the viewer so the
     card can offer it directly — an expired document used to be a red card with
     no way forward from it, and the only route to fixing it was buried a tap
     deeper. Resolves true when a replacement was picked.

     It goes through the SAME review flow as adding a document, rather than
     uploading straight off the picker, and that is the point: a renewal's whole
     purpose is a new expiry date. The old code carried `expiresAt: doc.expires`
     forward, so a "renewed" CDL was saved still expired. Reading the new date
     off the photo and letting the driver confirm it is exactly what the review
     modal already does.

     RENEWAL REPLACES: once the new document saves, the old one is retired (see
     handleReviewSaved). Without that a driver ends up with two CDL cards, and
     since the list now leads with what's expired, the stale one would sit at the
     top of the screen immediately after they'd just fixed it. */
  const renewDocument = useCallback(async (doc, source) => {
    if (!doc || renewing) return false;
    try {
      return await pickForReview(
        { type: doc.type, label: doc.label, documentNumber: doc.documentNumber || '' },
        String(doc.id),
        (busy) => setRenewing(busy ? String(doc.id) : null),
        source,
      );
    } catch {
      setRenewing(null);
      haptics.error();
      Alert.alert(t('documents.couldNotAdd'), t('documents.pleaseTryAgain'));
      return false;
    }
  }, [renewing, pickForReview, t]);

  /* Where a document comes from is asked BEFORE the picker opens, because there
     are three answers and no way to ask afterwards. Add and Renew share the
     sheet; `pickTarget` remembers which of them asked.

     The sheet stands down before the picker launches: presenting a native picker
     over a Modal that is about to unmount is the iOS presentation race this app
     has been bitten by more than once. */
  const chooseSource = useCallback((key) => {
    const target = pickTarget;
    setPickTarget(null);
    if (!target) return;
    if (target.mode === 'renew') renewDocument(target.doc, key);
    else addDoc(key);
  }, [pickTarget, addDoc, renewDocument]);

  /* Opening the sheet from INSIDE another Modal — the detail sheet, the focus
     overlay — has to wait for that one to actually go, for the same reason.
     MODAL_HANDOFF_MS covers the detail sheet's slide-out; the focus overlay has
     no animation and would be fine with a tick, but one constant is easier to
     keep right than two. */
  const openSourceAfterModal = useCallback((target) => {
    setTimeout(() => setPickTarget(target), MODAL_HANDOFF_MS);
  }, []);

  const sourceActions = useMemo(() => ([
    { key: 'camera',  icon: 'camera', label: t('documents.sourceCamera') },
    { key: 'library', icon: 'image',  label: t('documents.sourceLibrary') },
    { key: 'files',   icon: 'folder', label: t('documents.sourceFiles') },
  ]), [t]);

  const closeReview = () => {
    setReviewVisible(false);
    setReviewAsset(null);
    setReviewExtraction(null);
    setReviewExtractionError(null);
    setReviewDefaults(null);
    setReplacingId(null);
  };

  const handleReviewSaved = async () => {
    // Read it before closing — closeReview() clears it.
    const retiring = replacingId;
    // Dismiss first, so the modal doesn't sit there through a network round
    // trip after the driver has already tapped Save.
    closeReview();
    // Retire the document this one replaces. DELETE /documents/{id} is a
    // per-document soft delete (IsActive = false), so the old row survives for
    // the dispatcher's records — it is NOT the global load delete that
    // lib/hiddenLoads.js warns about.
    //
    // Best-effort on purpose: the replacement has already saved by this point,
    // and failing here would tell the driver their new CDL didn't upload when
    // it did. The worst case is the old card lingering until they remove it.
    if (retiring) await deleteDocument(retiring).catch(() => {});
    await loadData();
  };

  return (
    <ScreenFade style={[styles.screen, { paddingTop: insets.top + callInset }]}>

      {/* ── Header ── */}
      <View style={styles.head}>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t('documents.title')}</Text>
          <Text style={[styles.headSub, { color: colors.textMuted }]}>
            {t('documents.onFile', { count: docs.length })}
            {counts.expiring > 0 ? ` · ${t('documents.expiringSoonCount', { count: counts.expiring })}` : ''}
            {counts.expired  > 0 ? ` · ${t('documents.expiredCount', { count: counts.expired })}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => setPickTarget({ mode: 'add' })}
          disabled={adding}
          style={[styles.addBtn, { backgroundColor: colors.teal, opacity: adding ? 0.7 : 1 }, shadow.glow(colors.teal)]}
          accessibilityLabel={t('documents.addA11y')}
        >
          <Icon name={adding ? 'loader' : 'plus'} size={18} color={colors.onAccent} />
          <Text style={[styles.addBtnText, { color: colors.onAccent }]}>{adding ? t('documents.adding') : t('documents.add')}</Text>
        </Pressable>
      </View>

      {/* ── Filter chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={{ flexShrink: 0 }}
      >
        {FILTERS.map(f => {
          const active = filter === f.key;
          const count  = f.key === 'all' ? docs.length : counts[f.key];
          const tone   = f.key === 'expiring' ? colors.caution : f.key === 'expired' ? colors.danger : colors.teal;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.filterChip,
                { borderColor: active ? tone : colors.border,
                  backgroundColor: active ? tone + '22' : colors.surface },
              ]}
            >
              <Text style={[styles.filterText, { color: active ? tone : colors.textMuted }]}>
                {f.label}
              </Text>
              {count > 0 && (
                <View style={[styles.filterBadge, { backgroundColor: active ? tone : colors.surfaceHi }]}>
                  <Text style={[styles.filterBadgeText, { color: active ? colors.onAccent : colors.textMuted }]}>
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Inspection mode ── */}
      {inspectable.ready.length > 0 && (
        <Pressable
          onPress={openInspection}
          disabled={opening}
          style={({ pressed }) => [
            styles.inspectionBar,
            { backgroundColor: colors.tealFill, borderColor: colors.teal + '55', opacity: pressed || opening ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('documents.inspectionA11y')}
        >
          <View style={[styles.alertIcon, { backgroundColor: colors.tealFill }]}>
            <Icon name="shield" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.inspectionTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {t('documents.inspectionTitle')}
            </Text>
            <Text style={[styles.inspectionSub, { color: colors.textMuted }]} numberOfLines={1}>
              {t('documents.inspectionReady', {
                n: inspectable.ready.length,
                total: inspectable.creds.length,
              })}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.teal} />
        </Pressable>
      )}

      {/* ── Offline banner ── */}
      {/* Serving the stored list. Deliberately quiet: the driver has everything
          they came for, so this reports provenance rather than raising alarm. */}
      {stale && (
        <View style={[styles.alertBanner, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <View style={[styles.alertIcon, { backgroundColor: colors.surfaceHi }]}>
            <Icon name="wifi-off" size={16} color={colors.textMuted} />
          </View>
          <Text style={[styles.alertText, { color: colors.textSecondary }]} numberOfLines={2}>
            {t('documents.showingSaved', { age: ageLabel(Date.now() - stale.savedAt) })}
          </Text>
        </View>
      )}

      {/* ── Alert banner (expiring docs only) ── */}
      {counts.expiring > 0 && (
        <View style={[styles.alertBanner, { backgroundColor: colors.cautionFill, borderColor: colors.caution + '66' }]}>
          <View style={[styles.alertIcon, { backgroundColor: colors.cautionFill }]}>
            <Icon name="alert-triangle" size={16} color={colors.caution} />
          </View>
          <Text style={[styles.alertText, { color: colors.textPrimary }]} numberOfLines={2}>
            {counts.expiring === 1
              ? t('documents.oneExpiresSoon', { label: docs.find(d => expiryStatus(d.expires).key === 'expiring')?.label })
              : t('documents.manyExpireSoon', { count: counts.expiring })}
          </Text>
        </View>
      )}

      {/* ── Doc list ── */}
      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + TAB_BAR_CLEARANCE, gap: space[3] }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
      >
        {loading ? (
          [0, 1, 2, 3].map((i) => <DocCardSkeleton key={i} colors={colors} styles={styles} />)
        ) : error ? (
          <View style={styles.errorBox}>
            <View style={[styles.errorIcon, { backgroundColor: colors.cautionFill }]}>
              <Icon name="wifi-off" size={26} color={colors.caution} />
            </View>
            <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>{t('documents.couldntLoad')}</Text>
            <Text style={[styles.errorSub, { color: colors.textSecondary }]}>{t('documents.couldntLoadSub')}</Text>
            <Pressable
              onPress={onRefresh}
              style={[styles.retryBtn, { borderColor: colors.teal }]}
              accessibilityRole="button"
              accessibilityLabel={t('documents.tryAgainA11y')}
            >
              <Icon name="refresh-cw" size={15} color={colors.teal} />
              <Text style={[styles.retryText, { color: colors.teal }]}>{t('load.tryAgain')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {visible.map((doc, i) => (
              <FadeInView key={doc.id} delay={i * 70}>
                <DocCard
                  doc={doc}
                  offline={offline.has(String(doc.id))}
                  renewing={renewing === String(doc.id)}
                  opening={openingId === String(doc.id)}
                  onRenew={() => setPickTarget({ mode: 'renew', doc })}
                  onPress={() => openDocument(doc)}
                  onLongPress={() => openFocus(doc)}
                  colors={colors}
                  styles={styles}
                />
              </FadeInView>
            ))}
            {/* Two different nothings. A driver who has uploaded nothing at all
                was being told "No all documents", which reads as a bug and
                offers no way forward — they get an actual first-run prompt. */}
            {visible.length === 0 && (docs.length === 0 ? (
              <View style={styles.empty}>
                <Icon name="folder-plus" size={40} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                  {t('documents.emptyTitle')}
                </Text>
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('documents.emptyBody')}
                </Text>
                <Pressable
                  onPress={() => setPickTarget({ mode: 'add' })}
                  disabled={adding}
                  style={[styles.retryBtn, { borderColor: colors.teal, opacity: adding ? 0.7 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('documents.addA11y')}
                >
                  <Icon name={adding ? 'loader' : 'plus'} size={15} color={colors.teal} />
                  <Text style={[styles.retryText, { color: colors.teal }]}>
                    {adding ? t('documents.adding') : t('documents.emptyAction')}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <Icon name="folder" size={40} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {t('documents.noFilteredDocs', { filter: FILTERS.find(f => f.key === filter)?.label.toLowerCase() })}
                </Text>
              </View>
            ))}
            {/* Reports what is actually on the phone. This line used to claim
                "Documents are cached offline" while nothing was cached at all,
                which is the kind of promise a driver only discovers is false
                at the scale house. */}
            {docs.length > 0 && (
              <Text style={[styles.hint, { color: colors.textMuted }]}>
                {savedCount === 0
                  ? t('documents.offlineNone')
                  : savedCount >= docs.length
                    ? t('documents.offlineAll')
                    : t('documents.offlineSome', { n: savedCount, total: docs.length })}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Now only reached by a document with no file attached — everything else
          opens its own bytes. Kept because that case still needs somewhere to
          say so, and somewhere to fix it from. */}
      <DocViewer
        doc={open}
        onClose={() => setOpen(null)}
        colors={colors}
        styles={styles}
        insets={insets}
        opening={openingId === String(open?.id)}
        onOpenFile={openDocument}
        onDeleted={loadData}
        onRenew={(doc) => openSourceAfterModal({ mode: 'renew', doc })}
      />

      {/* Long press. Renew is also on the card for anything expiring or expired,
          because a gesture nobody can see must not be the only route to fixing a
          lapsed CDL — see the comment at the top of DocFocusOverlay. */}
      {focus && (
        <DocFocusOverlay
          doc={focus}
          offline={offline.has(String(focus.id))}
          onClose={() => setFocus(null)}
          // Stand the overlay down BEFORE the source sheet opens — two Modals
          // swapping inside one commit is the iOS presentation race.
          onRenew={() => { const d = focus; setFocus(null); openSourceAfterModal({ mode: 'renew', doc: d }); }}
          onDelete={() => removeDocument(focus)}
        />
      )}

      {/* Reuses the chat/load-history viewer — pinch, pan and swipe between
          credentials are already solved there. No callbacks means no composer
          and no ⋯ sheet; allowDownload=false drops Save/Share, which target
          remote urls and would fail on these local files. */}
      {photoView && (
        <PhotoViewer
          uris={photoView.uris}
          captions={photoView.captions}
          allowDownload={false}
          onClose={() => setPhotoView(null)}
        />
      )}

      {/* Camera / photos / files. Not Alert.alert: Android renders at most three
          buttons, so Cancel plus these three would silently lose one — and web
          has no Alert at all. */}
      {pickTarget && (
        <ActionSheet
          title={pickTarget.mode === 'renew'
            ? t('documents.renewSourceTitle')
            : t('documents.addSourceTitle')}
          subtitle={pickTarget.mode === 'renew'
            ? t('documents.renewSourceSub', { label: pickTarget.doc?.label })
            : t('documents.addSourceSub')}
          actions={sourceActions}
          onSelect={chooseSource}
          onClose={() => setPickTarget(null)}
        />
      )}

      <DocumentReviewModal
        visible={reviewVisible}
        asset={reviewAsset}
        extraction={reviewExtraction}
        extractionError={reviewExtractionError}
        defaults={reviewDefaults}
        driverId={userId}
        onSaved={handleReviewSaved}
        onCancel={closeReview}
        colors={colors}
      />
    </ScreenFade>
  );
}

/* ─────────── Doc Card ─────────── */

function DocCard({ doc, offline, renewing, opening, onRenew, onPress, onLongPress, colors, styles }) {
  const reduce  = useReduceMotion();
  const t       = useT();
  const status  = expiryStatus(doc.expires);
  const days    = daysUntil(doc.expires);
  const tone    = toneOf(colors, status.tone);
  const kind    = fileKind(doc.contentType);
  const size    = fileSize(doc.sizeBytes);
  const barFill = Math.max(0, Math.min(1, (days ?? 0) / 365));
  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) { barAnim.setValue(barFill); return; }
    Animated.timing(barAnim, {
      toValue: barFill,
      duration: 700,
      delay: 200,
      useNativeDriver: false,
    }).start();
  }, [barFill, reduce]);

  const daysLabel =
    days == null  ? '' :
    days <= 0     ? t('documents.daysLeftExpired') :
    days === 1    ? t('documents.daysLeftOne') :
    days < 30     ? t('documents.daysLeftN', { n: days }) :
    days < 365    ? t('documents.moLeft', { n: Math.round(days / 30) }) :
                    t('documents.yrLeft', { n: Math.round(days / 365 * 10) / 10 });

  const statusLabel = t(status.labelKey, status.labelParams);
  const needsRenewal = status.key === 'expired' || status.key === 'expiring';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.docCard,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.88 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={t('documents.docCardA11y', { label: doc.label, status: statusLabel })}
      accessibilityHint={t('documents.docCardHint')}
      // A long press has no screen-reader equivalent unless it's registered as
      // an action, and Renew/Delete live behind it.
      accessibilityActions={[{ name: 'longpress', label: t('documents.moreActionsA11y') }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
    >
      {/* Status stripe */}
      <View style={[styles.stripe, { backgroundColor: tone.solid }]} />

      <View style={styles.docBody}>
        {/* Top row: icon + label + badge */}
        <View style={styles.docTop}>
          {/* The document's own first look when there is one, the file-type
              glyph when there isn't. Same 44pt tile either way, so cards don't
              jump as previews arrive — and it carries the busy state, since the
              tap now fetches this document rather than pushing a screen.
              `renewing` counts too: a renewal started from the long-press sheet
              on a still-valid document has no Renew button to spin, and the file
              read plus AI pass that follow the picker are not instant. */}
          <DocThumb doc={doc} tone={tone} size={44} busy={!!(opening || renewing)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.docLabel, { color: colors.textPrimary }]} numberOfLines={1}>
              {doc.label}
            </Text>
            <Text style={[styles.docSub, { color: colors.textMuted }]} numberOfLines={1}>
              {doc.sub}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
            <View style={[styles.statusDot, { backgroundColor: tone.solid }]} />
            <Text style={[styles.statusText, { color: tone.solid }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Doc number + what the file actually is. The format and size are the
            only fields that differ between two documents a driver labelled
            similarly, and they were already on the payload, unused. */}
        <View style={styles.metaRow}>
          <View style={[styles.numberRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
            <Icon name="hash" size={12} color={colors.textMuted} />
            <Text style={[styles.docNumber, { color: colors.textSecondary }]}>{doc.number}</Text>
          </View>
          {(kind.ext || size) && (
            <View style={[styles.filePill, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
              <Text style={[styles.fileText, { color: colors.textMuted }]}>
                {[kind.ext, size].filter(Boolean).join(' · ')}
              </Text>
            </View>
          )}
          {offline && (
            <View
              style={[styles.filePill, { backgroundColor: colors.goFill, borderColor: colors.go + '55' }]}
              accessibilityLabel={t('documents.offlineReady')}
            >
              <Icon name="check-circle" size={11} color={colors.go} />
              <Text style={[styles.fileText, { color: colors.go }]}>{t('documents.offlineReady')}</Text>
            </View>
          )}
        </View>

        {/* Expiry bar + meta */}
        <View style={styles.expirySection}>
          <View style={[styles.barTrack, { backgroundColor: colors.surfaceHi }]}>
            <Animated.View
              style={[
                styles.barFill,
                {
                  width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  backgroundColor: tone.solid,
                },
              ]}
            />
          </View>
          <View style={styles.expiryMeta}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="calendar" size={11} color={colors.textMuted} />
              <Text style={[styles.expiryDate, { color: colors.textMuted }]}>
                {t('documents.expiresOn', { date: fmtDate(doc.expires, t('common.monthsShort')) })}
              </Text>
            </View>
            <Text style={[styles.daysLeft, { color: tone.solid }]}>{daysLabel}</Text>
          </View>
        </View>

        {/* A lapsed or lapsing credential used to be a red card and nothing
            else. The fix for it belongs on the card. */}
        {needsRenewal && onRenew && (
          <Pressable
            onPress={onRenew}
            disabled={renewing}
            // A nested pressable swallows the parent's long press, so it has to
            // forward it — otherwise this button is a dead zone for the sheet.
            onLongPress={onLongPress}
            delayLongPress={400}
            style={({ pressed }) => [
              styles.renewBtn,
              { borderColor: tone.solid, backgroundColor: tone.fill, opacity: pressed || renewing ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('documents.renewA11y', { label: doc.label })}
          >
            <Icon name={renewing ? 'loader' : 'upload'} size={14} color={tone.solid} />
            <Text style={[styles.renewText, { color: tone.solid }]}>
              {/* Same phase as the Add button's "Adding…" — reading the file
                  and running the AI over it. Nothing is uploading yet. */}
              {renewing ? t('documents.adding') : t('documents.renewNow')}
            </Text>
          </Pressable>
        )}
      </View>

      {/* No trailing chevron. It means "pushes a screen", and the tap no longer
          does — it opens the document itself. The busy state it used to carry
          moved onto the thumbnail, which is the thing being fetched. */}
    </Pressable>
  );
}

/* ─────────── Loading skeleton ─────────── */

function DocCardSkeleton({ colors, styles }) {
  return (
    <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.stripe, { backgroundColor: colors.surfaceHi }]} />
      <View style={styles.docBody}>
        <View style={styles.docTop}>
          <Skeleton width={44} height={44} radius={radius.md} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={68} height={22} radius={radius.pill} />
        </View>
        <Skeleton width="100%" height={5} radius={999} style={{ marginTop: space[2] }} />
      </View>
    </View>
  );
}

/* ─────────── Doc Viewer ─────────── */

/* The metadata sheet. It used to be what a tap on a card opened, and it
 * repeated that card almost field for field — number, expiry, status, a
 * countdown of the same days the card already counts. Tapping now opens the
 * document itself, so this is reached only by a document with NO file: the one
 * case that has nothing to render and genuinely needs to say why.
 *
 * Opening still routes through the screen's own opener rather than a second
 * copy of it, and stands this Modal down first — presenting the viewer over a
 * Modal that is about to unmount is the iOS race this app keeps hitting. */
function DocViewer({ doc, onClose, colors, styles, insets, opening, onOpenFile, onDeleted, onRenew }) {
  const [deleting, setDeleting] = useState(false);
  const t = useT();
  if (!doc) return null;
  const status = expiryStatus(doc.expires);
  const days   = daysUntil(doc.expires);
  const tone   = toneOf(colors, status.tone);
  const hasFile = !!(doc.hasContent || doc.url);

  const viewFile = () => {
    if (opening || !hasFile) return;
    const d = doc;
    onClose();
    onOpenFile?.(d);
  };

  const doDelete = () => {
    Alert.alert(t('documents.deleteDocQ'), t('documents.deleteDocBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteDocument(doc.id);
            await onDeleted?.();
            onClose();
          } catch {
            Alert.alert(t('documents.couldNotDelete'), t('documents.pleaseTryAgain'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  // Shares one implementation with the card's Renew button (the screen owns it)
  // so the two can't drift.
  //
  // This Modal is stood down BEFORE the picker and the review modal open, not
  // after. Presenting a second Modal over one that is about to unmount is the
  // iOS presentation race this app has already been bitten by more than once —
  // and the review modal is where the rest of the renewal now happens anyway.
  const uploadRenewal = () => {
    onClose();
    onRenew?.(doc);
  };

  const daysLabel =
    days == null ? '' :
    days <= 0    ? t('documents.expiredNote') :
    days === 1   ? t('documents.remainingOne') :
                   t('documents.remainingN', { n: days });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.viewer, { backgroundColor: colors.bg }]}>

        {/* Gradient header */}
        <LinearGradient
          colors={tone.grad}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.viewerHeader, { paddingTop: insets.top + space[3] }]}
        >
          <Pressable onPress={onClose} style={styles.backBtn} accessibilityLabel={t('documents.closeA11y')}>
            <Icon name="arrow-left" size={22} color="rgba(255,255,255,0.9)" />
          </Pressable>
          <View style={styles.viewerIconWrap}>
            <View style={styles.viewerIconCircle}>
              <Icon name={doc.icon || 'file-text'} size={40} color={tone.solid} />
            </View>
          </View>
          <Text style={styles.viewerDocName}>{doc.label}</Text>
          <Text style={styles.viewerDocSub}>{doc.sub}</Text>
        </LinearGradient>

        {/* Detail card */}
        <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3], paddingBottom: 40 }}>
          <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            <DetailRow icon="hash"     label={t('documents.documentNumber')} value={doc.number}          colors={colors} styles={styles} mono />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
            <DetailRow icon="calendar" label={t('documents.expiryDate')}     value={fmtDate(doc.expires, t('common.monthsShort'))} colors={colors} styles={styles} />
            <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

            {/* Status row */}
            <View style={styles.detailRow}>
              <View style={styles.detailLeft}>
                <Icon name="shield" size={15} color={colors.textMuted} />
                <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{t('documents.status')}</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: tone.fill, borderColor: tone.solid + '55' }]}>
                <View style={[styles.statusDot, { backgroundColor: tone.solid }]} />
                <Text style={[styles.statusText, { color: tone.solid }]}>{t(status.labelKey, status.labelParams)}</Text>
              </View>
            </View>

            {/* Countdown */}
            {days != null && (
              <>
                <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                <View style={styles.countdownSection}>
                  <View style={[styles.barTrack, { backgroundColor: colors.surfaceHi, height: 8 }]}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(0, Math.min(100, (days / 365) * 100))}%`,
                          backgroundColor: tone.solid, borderRadius: 999 },
                      ]}
                    />
                  </View>
                  <Text style={[styles.countdownText, { color: tone.solid }]}>{daysLabel}</Text>
                </View>
              </>
            )}
          </View>

          {/* Action buttons */}
          <Pressable
            onPress={uploadRenewal}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: tone.solid, opacity: pressed ? 0.85 : 1 },
              shadow.glow(tone.solid),
            ]}
          >
            <Icon name="upload" size={18} color={colors.onAccent} />
            <Text style={[styles.actionBtnText, { color: colors.onAccent }]}>
              {t('documents.uploadRenewal')}
            </Text>
          </Pressable>

          <Pressable
            onPress={viewFile}
            disabled={opening || !hasFile}
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed || opening ? 0.85 : hasFile ? 1 : 0.5 },
            ]}
          >
            <Icon name={opening ? 'loader' : 'eye'} size={18} color={colors.textSecondary} />
            <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>
              {opening ? t('documents.opening') : hasFile ? t('documents.viewDocument') : t('documents.noFileAttached')}
            </Text>
          </Pressable>

          <Pressable
            onPress={doDelete}
            disabled={deleting}
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: colors.danger + '55', backgroundColor: colors.dangerFill, opacity: pressed || deleting ? 0.85 : 1 },
            ]}
          >
            <Icon name={deleting ? 'loader' : 'trash-2'} size={18} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>
              {deleting ? t('documents.deleting') : t('documents.deleteDocument')}
            </Text>
          </Pressable>
        </ScrollView>

      </View>
    </Modal>
  );
}

function DetailRow({ icon, label, value, mono, colors, styles }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLeft}>
        <Icon name={icon} size={15} color={colors.textMuted} />
        <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
      </View>
      <Text style={[styles.detailValue, { color: colors.textPrimary }, mono && styles.mono]}>
        {value}
      </Text>
    </View>
  );
}

/* ─────────── Styles ─────────── */

const makeStyles = (c) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },

  /* Header */
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[1],
  },
  title: { ...type.h1 },
  headSub: { ...type.caption, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[4], paddingVertical: 10,
    borderRadius: radius.pill,
  },
  addBtnText: { fontSize: 13, fontFamily: FONT.bold },

  /* Filter row */
  filterRow: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2], flexDirection: 'row' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space[3], height: 36,
    borderRadius: radius.pill, borderWidth: 1,
  },
  filterText: { fontSize: 13, fontFamily: FONT.bold, lineHeight: 16 },
  filterBadge: { borderRadius: radius.pill, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 11, fontFamily: FONT.black, lineHeight: 14 },

  /* Alert banner */
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    marginHorizontal: space[4], marginBottom: space[3],
    borderWidth: 1, borderRadius: radius.md,
    padding: space[3],
  },
  alertIcon: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  alertText: { ...type.caption, fontFamily: FONT.bold, flex: 1, lineHeight: 19 },

  /* Doc card */
  docCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden',
  },
  stripe: { width: 5, alignSelf: 'stretch', flexShrink: 0 },
  docBody: { flex: 1, padding: space[4], gap: space[3] },
  docTop: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  docLabel: { ...type.bodyStrong, fontSize: 15 },
  docSub: { ...type.caption, marginTop: 1 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, flexShrink: 0,
  },
  statusDot: { width: 6, height: 6, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: FONT.black },

  inspectionBar: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    marginHorizontal: space[4], marginBottom: space[3],
    padding: space[3], borderRadius: radius.lg, borderWidth: 1,
  },
  inspectionTitle: { ...type.bodyStrong, fontSize: 14 },
  inspectionSub: { ...type.caption, marginTop: 1 },

  renewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.md, borderWidth: 1, paddingVertical: 10,
  },
  renewText: { fontSize: 13, fontFamily: FONT.bold },

  // Wraps, because a document number, a format badge and the offline pill do
  // not fit on one line on a small phone in Georgian.
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  numberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.surface2, borderRadius: radius.md,
    borderWidth: 1, paddingHorizontal: space[3], paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  docNumber: { fontSize: 13, fontFamily: FONT.bold, letterSpacing: 0.5 },
  filePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.md, borderWidth: 1,
    paddingHorizontal: 9, paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  fileText: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 0.3 },

  expirySection: { gap: 7 },
  barTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  expiryMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expiryDate: { fontSize: 11, fontFamily: FONT.medium },
  daysLeft: { fontSize: 11, fontFamily: FONT.black },

  /* Empty state */
  empty: { alignItems: 'center', paddingVertical: space[10], gap: space[3] },
  emptyTitle: { ...type.bodyStrong, fontSize: 16 },
  emptyText: { ...type.body, textAlign: 'center', paddingHorizontal: space[4], lineHeight: 20 },

  hint: { ...type.caption, textAlign: 'center', marginTop: space[3], lineHeight: 19 },

  /* Viewer */
  viewer: { flex: 1 },
  viewerHeader: {
    paddingHorizontal: space[5], paddingBottom: space[6],
    alignItems: 'center', gap: 4,
  },
  backBtn: {
    alignSelf: 'flex-start', width: 42, height: 42,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 999,
    marginBottom: space[4],
  },
  viewerIconWrap: { marginBottom: space[3] },
  viewerIconCircle: {
    width: 88, height: 88, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    ...shadow.float,
  },
  viewerDocName: { fontSize: 26, fontFamily: FONT.black, color: '#FFFFFF', letterSpacing: -0.5 },
  viewerDocSub: { fontSize: 14, fontFamily: FONT.medium, color: 'rgba(255,255,255,0.7)' },

  /* Detail card */
  detailCard: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4], gap: space[3] },
  detailLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { ...type.caption, fontFamily: FONT.bold },
  detailValue: { ...type.bodyStrong, textAlign: 'right' },
  mono: { fontFamily: FONT.bold, letterSpacing: 0.8 },
  detailDivider: { height: 1, marginHorizontal: space[4] },
  countdownSection: { padding: space[4], gap: 8 },
  countdownText: { fontSize: 13, fontFamily: FONT.black, textAlign: 'center' },

  /* Action buttons */
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, paddingVertical: 16,
  },
  actionBtnOutline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: radius.lg, paddingVertical: 16, borderWidth: 1,
  },
  actionBtnText: { fontSize: 15, fontFamily: FONT.bold },

  /* Error / retry */
  errorBox: { alignItems: 'center', justifyContent: 'center', gap: space[3], paddingVertical: space[10], paddingHorizontal: space[4] },
  errorIcon: { width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space[1] },
  errorTitle: { fontSize: 18, fontFamily: FONT.black, textAlign: 'center' },
  errorSub: { ...type.caption, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space[1], paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.pill, borderWidth: 1 },
  retryText: { ...type.bodyStrong, fontSize: 15 },
});
