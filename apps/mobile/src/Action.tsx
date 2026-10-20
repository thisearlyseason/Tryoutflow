import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
export function Action({
  title,
  onPress,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'link';
}) {
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    AccessibilityInfo?.isReduceMotionEnabled().then(setReduceMotion);
    const listener = AccessibilityInfo?.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => listener?.remove();
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function press() {
    if (lock.current || disabled) return;
    lock.current = true;
    setError('');
    setPending(true);
    try {
      await onPress();
    } catch {
      setError('This action could not be completed. Please try again.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || pending, busy: pending }}
        disabled={disabled || pending}
        onPress={press}
        style={({ pressed }) => [
          styles.button,
          variant === 'secondary' && styles.secondary,
          variant === 'link' && styles.link,
          (disabled || pending) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {pending ? (
          <ActivityIndicator
            accessibilityLabel={`${title} in progress`}
            animating={!reduceMotion}
            color={variant === 'primary' ? '#fff' : '#075945'}
          />
        ) : null}
        <Text style={[styles.text, variant !== 'primary' && styles.darkText]}>
          {pending ? `${title}…` : title}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: '#075945',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  text: { color: '#fff', fontSize: 15, fontWeight: '700' },
  darkText: { color: '#075945' },
  secondary: { backgroundColor: '#eef2f7' },
  link: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.72 },
  error: { color: '#a52828', fontSize: 14, marginTop: 6 },
});
