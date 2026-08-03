import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

const KEYBOARD_GAP = 12;
const SETTLE_MS = 260;

/**
 * Keeps the focused field above the keyboard, by the minimum scroll needed.
 *
 * Extracted from app/edit-profile.js, which paid for every line of this the hard
 * way. The subtleties, all of which have bitten in production:
 *
 *  - Measured in window coordinates against the keyboard's own reported top
 *    edge, so it assumes nothing about insets, header height, or how tall a
 *    given keyboard (or its autofill/emoji bar) happens to be.
 *  - iOS uses `keyboardWillChangeFrame`, not `WillShow`: the frame is reported
 *    before it animates, so the scroll rides along instead of chasing — and
 *    switching to emoji or autofill changes the height without a fresh "show".
 *  - That same iOS event fires on the way OUT, with the frame parked just off
 *    the bottom of the window. That's hidden, not a zero-height keyboard.
 *  - Everything being measured is still moving when the event lands, so a second
 *    pass runs once it settles. It re-measures, so a pass that already landed
 *    computes ~0 and moves nothing.
 *
 * Usage: give the ScrollView `ref={scrollRef}` and
 * `onScroll={e => (offsetRef.current = e.nativeEvent.contentOffset.y)}`, register
 * each field's wrapper in `blocks`, and call `onFocusField(key)` from onFocus.
 *
 * NOTE: edit-profile.js still carries its own copy. Migrating it is a
 * behaviour-preserving refactor of a screen with no test coverage — worth doing,
 * but on its own, not folded into a feature change.
 */
export function useEnsureVisible({ footerHeight = 0 } = {}) {
  const { height: winH } = useWindowDimensions();

  const scrollRef = useRef(null);
  const offsetRef = useRef(0);
  const keyboardY = useRef(0);
  const focusedRef = useRef(null);
  const settleRef = useRef(null);
  const blocksRef = useRef({});

  const [kbUp, setKbUp] = useState(false);

  // Cached per key so the ref callback is stable across renders — returning a
  // fresh closure each time makes React detach and re-attach every field's ref
  // on every keystroke.
  const setters = useRef({});
  const registerBlock = useCallback((key) => {
    if (!setters.current[key]) {
      setters.current[key] = (node) => { blocksRef.current[key] = node; };
    }
    return setters.current[key];
  }, []);

  const onScroll = useCallback((e) => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const ensureVisible = useCallback((kbTop) => {
    const key = focusedRef.current;
    const node = key ? blocksRef.current[key] : null;
    if (!node?.measureInWindow || !kbTop) return;
    node.measureInWindow((x, y, w, h) => {
      if (typeof y !== 'number' || typeof h !== 'number') return;
      const limit = kbTop - footerHeight - KEYBOARD_GAP;
      const delta = (y + h) - limit;
      if (delta > 1) scrollRef.current?.scrollTo({ y: offsetRef.current + delta, animated: true });
    });
  }, [footerHeight]);

  const ensureVisibleSettled = useCallback((kbTop) => {
    ensureVisible(kbTop);
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => ensureVisible(keyboardY.current), SETTLE_MS);
  }, [ensureVisible]);

  const onFocusField = useCallback((key) => {
    focusedRef.current = key;
    if (keyboardY.current) ensureVisibleSettled(keyboardY.current);
  }, [ensureVisibleSettled]);

  const onBlurField = useCallback((key) => {
    if (focusedRef.current === key) focusedRef.current = null;
  }, []);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvt, (e) => {
      const top = e?.endCoordinates?.screenY;
      if (typeof top !== 'number') return;
      const up = top < winH - 1;
      keyboardY.current = up ? top : 0;
      setKbUp(up);
      if (up) ensureVisibleSettled(top);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardY.current = 0;
      setKbUp(false);
    });
    return () => { show.remove(); hide.remove(); };
  }, [ensureVisibleSettled, winH]);

  return { scrollRef, onScroll, registerBlock, onFocusField, onBlurField, kbUp };
}
