import { useEffect, useRef, useState } from 'react';
import { Text, Animated, Easing } from 'react-native';
import { useReduceMotion } from '../../lib/useReduceMotion';

/* Animates a number from 0 → value on mount/changes. `format` turns the
   in-flight float into display text (e.g. money, miles). Respects reduce-motion. */
export default function CountUp({ value = 0, duration = 1000, format = (n) => Math.round(n).toLocaleString('en-US'), style, ...rest }) {
  const reduce = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (reduce) { setDisplay(value); return; }
    const id = anim.addListener(({ value: v }) => setDisplay(v));
    anim.setValue(0);
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value, reduce]);

  return <Text style={style} {...rest}>{format(display)}</Text>;
}
