import { useEffect, useState } from 'react';
import { View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../ui/Icon';
import { cachedThumb, ensureThumb, isCredential } from '../../lib/docCache';
import { fileKind } from '../../lib/imageMime';
import { radius } from '../../theme/tokens';

/* The 44pt tile that identifies a document — its own first look when the phone
 * has one, a glyph for what it is when it doesn't.
 *
 * Lives here rather than inside the Documents tab because the long-press focus
 * overlay has to show the SAME tile as the card it lifted out of the list: if
 * the two resolved thumbnails independently the overlay would flash a generic
 * icon while re-fetching a preview the card already had.
 */

// Resolved thumbnails, kept module-level so re-rendering the list doesn't
// re-request them. A stored `null` means "asked, this document has none" — a
// PDF or anything uploaded before thumbnails existed — so it isn't asked again.
const thumbUris = new Map();

export function useDocThumb(doc) {
  const id = String(doc?.id ?? '');
  const has = !!doc?.hasThumbnail;
  // The local copy is checked whatever the list says, because docCache's
  // backfill writes a preview to disk before the list has been refetched to
  // report it. Only the network fetch below is gated on `hasThumbnail`.
  const [uri, setUri] = useState(() => cachedThumb(id) || thumbUris.get(id) || null);

  useEffect(() => {
    if (!has || uri || thumbUris.get(id) === null) return;
    let alive = true;
    ensureThumb(id)
      .then((u) => { thumbUris.set(id, u || null); if (alive && u) setUri(u); })
      .catch(() => {});   // a missing preview is never worth surfacing
    return () => { alive = false; };
  }, [id, has, uri]);

  return uri;
}

// A credential keeps its own meaningful glyph (a licence looks like a card, a
// medical card like a pulse). Everything else used to fall back to one shared
// file-text icon, which is what made a list of driver-added documents
// indistinguishable — those get an icon for the actual file format instead.
export function docGlyph(doc) {
  if (isCredential(doc)) return { name: doc?.icon || 'file-text', family: 'feather' };
  const kind = fileKind(doc?.contentType);
  return { name: kind.icon, family: kind.family };
}

/* `busy` scrims the tile and spins on it. That lives HERE rather than in a
 * trailing chevron slot because the tile is the document: a spinner on it reads
 * as "fetching this one", where a spinner at the row's edge reads as "this row
 * is doing something". */
export default function DocThumb({ doc, tone, size = 44, busy = false, style }) {
  const thumb = useDocThumb(doc);
  const glyph = docGlyph(doc);
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, backgroundColor: tone.fill },
        style,
      ]}
    >
      {thumb
        ? <Image source={{ uri: thumb }} style={styles.img} resizeMode="cover" />
        : <Icon name={glyph.name} family={glyph.family} size={Math.round(size * 0.45)} color={tone.solid} />}
      {busy ? (
        <View style={[StyleSheet.absoluteFill, styles.busy]}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  img: { width: '100%', height: '100%' },
  // Same scrim weight as the "+N" overlay on load-history photos, so a covered
  // thumbnail looks the same wherever the app covers one.
  busy: { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
});
