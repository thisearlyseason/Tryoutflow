import { Action } from './Action';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { api } from './client';
export function AccountDeletion({ userId }: { userId: string }) {
  const lock = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ request: { id: string; dueAt: string } }>(
        '/api/account/deletion',
        { confirm: true },
        userId,
      );
      setMessage(
        `Request saved. Completion is due by ${new Date(result.request.dueAt).toLocaleString()}. Reference: ${result.request.id}. We will email you when deletion is complete. Your account has not been deleted yet.`,
      );
      setConfirming(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Request could not be saved. Please try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.heading}>Account and data</Text>
      <Text style={styles.copy}>
        Request removal of your account and associated personal information. We will confirm the
        request and complete it within seven days.
      </Text>
      {!confirming ? (
        <Action title="Delete account" onPress={() => setConfirming(true)} disabled={busy} />
      ) : null}
      {confirming ? (
        <>
          <Text style={styles.copy}>
            Request deletion of your account and associated personal information within seven days.
            GameDay Technologies will arrange any agreed transfer of shared organization ownership,
            or confirm closure if no member remains. Submitting a request does not immediately
            delete your account or shared records.
          </Text>
          <Text style={styles.copy}>
            Cancel Apple or Google subscriptions in the store. You can request deletion before your
            subscription expires; we will coordinate web billing cancellation.
          </Text>
          <Action
            title="Subscription management and support"
            onPress={() => Linking.openURL('https://www.tryout.agency/support')}
          />
          <Action
            title="Confirm deletion request"
            onPress={submit}
            disabled={busy}
            variant="primary"
          />
          <Action title="Keep account" onPress={() => setConfirming(false)} disabled={busy} />
        </>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.copy}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    padding: 22,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e0e3da',
    backgroundColor: '#fff',
  },
  eyebrow: { color: '#294df2', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  heading: { color: '#101d32', fontSize: 20, fontWeight: '700' },
  copy: { color: '#5b6b80', fontSize: 14, lineHeight: 21 },
  action: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#eef2f7',
  },
  actionText: { color: '#101d32', fontSize: 14, fontWeight: '700' },
  emphasis: { backgroundColor: '#294df2' },
  emphasisText: { color: '#fff' },
  disabled: { opacity: 0.5 },
});
