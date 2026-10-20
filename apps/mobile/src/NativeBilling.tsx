import { Action } from './Action';
import { AccountDeletion } from './AccountDeletion';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { PurchasesPackage } from 'react-native-purchases';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { api as requestApi, supabase } from './client';
import {
  getOfferings,
  identifyPurchaser,
  purchaseError,
  purchasePackage,
  restorePurchases,
} from './native-billing';
type Organization = {
  organization_id: string;
  role: string;
  organizations: { id: string; name: string; slug: string };
};
type Dashboard = {
  purchasesEnabled?: boolean;
  trial?: { eligible: boolean; startsAt: string | null; expiresAt: string | null };
  tryouts?: { id: string; name: string }[];
  access: { plan: string; source: string; features: Record<string, boolean> };
  subscriptions: {
    tryout_id: string | null;
    provider: 'stripe' | 'apple' | 'google';
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    pending_product_key: string | null;
    downgrade_effective_at: string | null;
  }[];
};
const nativeProvider = Platform.OS === 'ios' ? 'apple' : 'google';
export default function NativeBilling({
  embeddedSession,
  onReturn,
  initialWorkspaceSlug,
}: {
  embeddedSession?: { user: { id: string } };
  onReturn?: () => void;
  initialWorkspaceSlug?: string;
} = {}) {
  const { width } = useWindowDimensions();
  const wideSignIn = width >= 800;
  const [session, setSession] = useState<Session | { user: { id: string } } | null>(
      embeddedSession ?? null,
    ),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]),
    [organization, setOrganization] = useState<Organization | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [packages, setPackages] = useState<PurchasesPackage[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState(false);
  const [organizationRetry, setOrganizationRetry] = useState(0);
  const [selectedTryout, setSelectedTryout] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (embeddedSession) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, value) => {
      setSession(value);
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      setOrganizations([]);
      setDashboard(null);
      setOrganization(null);
      setPackages([]);
    });
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      subscription.unsubscribe();
      listener.remove();
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (session?.user.id) {
      setOrganizationsLoading(true);
      setOrganizationsError(false);
      api<{ organizations: Organization[] }>('/api/billing/organizations')
        .then((data) => {
          if (current) {
            setOrganizations(data.organizations);
            setOrganizationsLoading(false);
          }
        })
        .catch(() => {
          if (current) {
            setOrganizationsLoading(false);
            setOrganizationsError(true);
            setMessage('Unable to load your organizations. Check your connection and retry.');
          }
        });
    }
    return () => {
      current = false;
    };
  }, [session?.user.id, organizationRetry]);
  function api<T>(path: string, body?: unknown, expectedUserId = session?.user.id) {
    return requestApi<T>(path, body, expectedUserId);
  }
  async function task(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await run();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh(selected = organization) {
    if (!selected) return null;
    const result = await api<Dashboard>(
      `/api/organizations/${selected.organization_id}/${selected.role === 'owner' ? 'billing/actions' : 'entitlements'}`,
    );
    setDashboard(result);
    return result;
  }
  async function choose(selected: Organization) {
    await task(async () => {
      setOrganization(selected);
      setDashboard(null);
      setSelectedTryout('');
      setPackages([]);
      const current = await refresh(selected);
      if (selected.role === 'owner' && session && current?.purchasesEnabled !== false) {
        await identifyPurchaser(session.user.id);
        setPackages(await getOfferings());
      }
    });
  }
  useEffect(() => {
    if (initialWorkspaceSlug && !organization && !busy) {
      const selected = organizations.find(
        (value) => value.organizations.slug === initialWorkspaceSlug,
      );
      if (selected) void choose(selected);
    }
  }, [initialWorkspaceSlug, organizations]);
  async function buy(selected: PurchasesPackage) {
    await task(async () => {
      if (!organization || !session) return;
      await identifyPurchaser(session.user.id);
      // RevenueCat package identifiers are configured to the same product keys as the backend catalog.
      const product = selected.identifier;
      if (
        ![
          'pro_monthly',
          'pro_annual',
          'organization_monthly',
          'organization_annual',
          'single_tryout_pro',
        ].includes(product)
      )
        throw new Error('This purchase option is unavailable.');
      if (product === 'single_tryout_pro' && !selectedTryout)
        throw new Error('Select a tryout first.');
      const storageKey = `purchase-${session.user.id}-${organization.organization_id}-${product}-${selectedTryout}`;
      let attemptId = await SecureStore.getItemAsync(storageKey);
      if (!attemptId) {
        attemptId = randomUUID();
        await SecureStore.setItemAsync(storageKey, attemptId);
      }
      const intent = await api<{ productId: string }>(
        `/api/organizations/${organization.organization_id}/billing/actions`,
        {
          action: 'purchase',
          product,
          provider: nativeProvider,
          attemptId,
          tryoutId: product === 'single_tryout_pro' ? selectedTryout : null,
        },
      ).catch(async (error: Error) => {
        if (error.name === 'IntentExpired') await SecureStore.deleteItemAsync(storageKey);
        throw error;
      });
      if (intent.productId !== selected.product.identifier)
        throw new Error('The store product configuration needs attention.');
      try {
        await purchasePackage(selected);
      } catch (error) {
        throw new Error(purchaseError(error));
      }
      await api(`/api/organizations/${organization.organization_id}/billing/actions`, {
        action: 'reconcile',
      });
      await refresh();
      await SecureStore.deleteItemAsync(storageKey);
      setMessage(
        'Purchase received. Access updates after secure confirmation; refresh if it is still pending.',
      );
    });
  }
  const active = dashboard?.subscriptions?.find(
    (s) =>
      !s.tryout_id &&
      ['active', 'trialing', 'grace_period', 'past_due', 'cancelled'].includes(s.status) &&
      ((!!s.current_period_end && Date.parse(s.current_period_end) > Date.now()) ||
        dashboard?.access.source === 'organization_subscription'),
  );
  return (
    <SafeAreaView style={styles.safe}>
      {onReturn ? (
        <Action title="Back to dashboard" variant="secondary" onPress={onReturn} disabled={busy} />
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, wideSignIn && styles.wideContent]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.intro, wideSignIn && !session && styles.wideIntro]}>
          <View style={[styles.header, wideSignIn && !session && styles.wideHeader]}>
            {wideSignIn && !session ? (
              <Image source={require('../assets/icon.png')} style={styles.brandIcon} />
            ) : null}
            <Text style={[styles.eyebrow, wideSignIn && !session && styles.wideEyebrow]}>
              TRYOUTFLOW
            </Text>
            <Text style={[styles.title, wideSignIn && !session && styles.wideTitle]}>
              {session ? 'Billing & access' : 'Welcome back.'}
            </Text>
            <Text style={[styles.copy, wideSignIn && !session && styles.wideCopy]}>
              {session
                ? 'Review your workspace plan and purchases.'
                : 'Sign in to your TryOutFlow account to manage your organization on this device.'}
            </Text>
          </View>
          {!session ? (
            <View style={[styles.card, wideSignIn && styles.wideSignInCard]}>
              <Text style={styles.heading}>Sign in</Text>
              <Text style={styles.copy}>Use the account you already use for TryOutFlow.</Text>
              <Text style={styles.label}>Email</Text>
              <TextInput
                accessibilityLabel="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                style={styles.input}
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                style={styles.input}
              />
              <Action
                title="Forgot password?"
                variant="link"
                onPress={() =>
                  task(() => Linking.openURL('https://www.tryout.agency/forgot-password'))
                }
              />
              <Action
                title="Sign in"
                disabled={busy}
                onPress={() =>
                  task(async () => {
                    const { error } = await supabase.auth.signInWithPassword({ email, password });
                    if (error) throw new Error('Unable to sign in. Check your email and password.');
                  })
                }
              />
            </View>
          ) : null}
        </View>
        {busy ? (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            Working…
          </Text>
        ) : null}
        {message ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
            {message}
          </Text>
        ) : null}
        {session ? (
          <View style={[styles.workspaceLayout, wideSignIn && styles.wideWorkspaceLayout]}>
            <View style={styles.workspaceSidebar}>
              <Text style={styles.sidebarLabel}>WORKSPACES</Text>
              {organizationsLoading ? (
                <Text accessibilityLiveRegion="polite">Loading workspaces…</Text>
              ) : null}
              {organizationsError ? (
                <Action
                  title="Retry workspaces"
                  onPress={() => setOrganizationRetry((v) => v + 1)}
                />
              ) : null}
              {!organizationsLoading && !organizationsError && organizations.length === 0 ? (
                <Text style={styles.sidebarCopy}>
                  No organization is available for this account.
                </Text>
              ) : null}
              {organizations.map((org) => {
                const selected = organization?.organization_id === org.organization_id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    key={org.organization_id}
                    onPress={() => choose(org)}
                    style={({ pressed }) => [
                      styles.workspaceChoice,
                      selected && styles.workspaceChoiceSelected,
                      pressed && { opacity: 0.72 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.workspaceChoiceName,
                        selected && styles.workspaceChoiceNameSelected,
                      ]}
                    >
                      {org.organizations.name}
                    </Text>
                    <Text style={[styles.workspaceRole, selected && styles.workspaceRoleSelected]}>
                      {org.role === 'owner' ? 'Owner' : 'Member'} · Select workspace
                    </Text>
                  </Pressable>
                );
              })}
              {!embeddedSession ? (
                <Action
                  title="Sign out"
                  variant="secondary"
                  disabled={busy}
                  onPress={() =>
                    task(async () => {
                      const { error } = await supabase.auth.signOut();
                      if (error) throw new Error('Unable to sign out. Please try again.');
                      setPassword('');
                      setOrganizations([]);
                    })
                  }
                />
              ) : null}
            </View>
            <View style={styles.workspaceMain}>
              {organization && dashboard ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.eyebrow}>COACHING WORKSPACE</Text>
                    <Text style={styles.heading}>{organization.organizations.name}</Text>
                    <Text style={styles.copy}>
                      Your tryouts, athletes, evaluations and reports are available in the
                      dashboard.
                    </Text>
                    <Action
                      title="Open coaching workspace"
                      disabled={busy}
                      onPress={() =>
                        onReturn
                          ? onReturn()
                          : task(() =>
                              Linking.openURL(
                                `https://www.tryout.agency/app/${encodeURIComponent(organization.organizations.slug)}/home`,
                              ),
                            )
                      }
                    />
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.eyebrow}>
                      CURRENT PLAN · {organization.organizations.name}
                    </Text>
                    <Text style={styles.heading}>
                      TryOutFlow{' '}
                      {dashboard.access.plan === 'organization'
                        ? 'Organization'
                        : dashboard.access.plan === 'pro'
                          ? 'Pro'
                          : 'Free'}
                    </Text>
                    {organization.role === 'owner' && dashboard.trial?.eligible ? (
                      <View style={styles.offer}>
                        <Text style={styles.heading}>Try Pro free for 7 days</Text>
                        <Text style={styles.copy}>
                          No payment method or automatic charge. Your trial follows this
                          organization across iPhone, iPad, Android and web. Then choose Pro Monthly
                          or Pro Annual.
                        </Text>
                        <Action
                          title="Start my 7-day Pro trial"
                          disabled={busy}
                          onPress={() =>
                            task(async () => {
                              await api(
                                `/api/organizations/${organization.organization_id}/billing/actions`,
                                { action: 'start_trial' },
                              );
                              await refresh();
                              setMessage('Your 7-day Pro trial has started.');
                            })
                          }
                        />
                      </View>
                    ) : null}
                    {dashboard.trial?.expiresAt ? (
                      <Text style={styles.copy}>
                        Pro trial ends {new Date(dashboard.trial.expiresAt).toLocaleString()}. No
                        automatic charge.
                      </Text>
                    ) : null}
                    {dashboard.purchasesEnabled === false ? (
                      <Text style={styles.copy}>
                        Paid plans are coming soon. You can still start an eligible free trial.
                      </Text>
                    ) : null}
                    {active ? (
                      <>
                        <Text style={styles.copy}>
                          {active.status === 'past_due' || active.status === 'grace_period'
                            ? "There's a problem with your subscription payment. Update your billing information to avoid losing access."
                            : 'Your organization has access across supported devices.'}
                        </Text>
                        {active.current_period_end ? (
                          <Text style={styles.copy}>
                            {active.cancel_at_period_end
                              ? 'Cancelled · access until'
                              : 'Current period ends'}{' '}
                            {new Date(active.current_period_end).toLocaleDateString()}
                          </Text>
                        ) : null}
                        {active.pending_product_key && active.downgrade_effective_at ? (
                          <Text style={styles.copy}>
                            Your plan changes on{' '}
                            {new Date(active.downgrade_effective_at).toLocaleDateString()}.
                          </Text>
                        ) : null}
                        <Action
                          title="Manage subscription"
                          disabled={busy}
                          onPress={() =>
                            task(async () => {
                              const result = await api<{ url: string }>(
                                `/api/organizations/${organization.organization_id}/billing/actions`,
                                { action: 'manage' },
                              );
                              const url = new URL(result.url);
                              if (!['apps.apple.com', 'play.google.com'].includes(url.hostname))
                                throw new Error('Manage this subscription from your web account.');
                              await Linking.openURL(result.url);
                            })
                          }
                        />
                      </>
                    ) : null}
                    {dashboard.subscriptions
                      ?.filter((s) => s.tryout_id)
                      .map((license, index) => (
                        <View style={styles.offer} key={`${license.tryout_id}-${index}`}>
                          <Text style={styles.heading}>
                            {dashboard.tryouts?.find((t) => t.id === license.tryout_id)?.name ??
                              'Tryout license'}
                          </Text>
                          <Text style={styles.copy}>
                            Pro · {license.status.replaceAll('_', ' ')} · One-time purchase
                          </Text>
                        </View>
                      ))}
                    {!active &&
                    dashboard.purchasesEnabled !== false &&
                    organization.role === 'owner'
                      ? packages.map((item) => (
                          <View key={item.identifier} style={styles.offer}>
                            <Text style={styles.heading}>
                              {item.identifier === 'pro_monthly'
                                ? 'Pro Monthly'
                                : item.identifier === 'pro_annual'
                                  ? 'Pro Annual'
                                  : item.product.title}
                            </Text>
                            <Text style={styles.copy}>{item.product.description}</Text>
                            {item.identifier === 'single_tryout_pro' ? (
                              <View style={{ gap: 8 }}>
                                <Text style={styles.label}>Choose your tryout</Text>
                                {dashboard.tryouts?.map((t) => (
                                  <Action
                                    key={t.id}
                                    title={`${selectedTryout === t.id ? '✓ ' : ''}${t.name}`}
                                    disabled={busy}
                                    onPress={() => setSelectedTryout(t.id)}
                                  />
                                ))}
                              </View>
                            ) : null}
                            <Action
                              title={`${item.product.priceString} · ${item.identifier === 'single_tryout_pro' ? 'one-time' : item.identifier.endsWith('_annual') ? 'year' : 'month'}`}
                              disabled={busy}
                              onPress={() => buy(item)}
                            />
                            <Text style={styles.small}>
                              {item.identifier === 'single_tryout_pro'
                                ? 'One payment unlocks Pro for the selected tryout.'
                                : 'Renews automatically until cancelled in your store settings.'}{' '}
                              Access begins after payment confirmation.
                            </Text>
                          </View>
                        ))
                      : null}
                    <Action
                      title="Restore purchases"
                      variant="secondary"
                      disabled={busy || organization.role !== 'owner'}
                      onPress={() =>
                        task(async () => {
                          if (!session) return;
                          await identifyPurchaser(session.user.id);
                          await restorePurchases();
                          await api(
                            `/api/organizations/${organization.organization_id}/billing/actions`,
                            { action: 'restore' },
                          );
                          await refresh();
                          setMessage(
                            'Purchase records checked. Your current access is shown above.',
                          );
                        })
                      }
                    />
                    <Action
                      title="Refresh access"
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        task(async () => {
                          if (organization.role === 'owner')
                            await api(
                              `/api/organizations/${organization.organization_id}/billing/actions`,
                              { action: 'reconcile' },
                            );
                          await refresh();
                          setMessage('Access refreshed. Your current plan is shown above.');
                        })
                      }
                    />
                    <Text style={styles.small}>
                      Changing plans never deletes athletes, tryouts, evaluations, or historical
                      records.
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.heading}>
                    {organization ? 'Workspace access unavailable' : 'Choose a workspace'}
                  </Text>
                  {organization ? (
                    <Action
                      title="Retry workspace access"
                      onPress={() => choose(organization)}
                      disabled={busy}
                    />
                  ) : null}
                  <Text style={styles.copy}>
                    Select one of your organizations to view its TryOutFlow plan and access.
                  </Text>
                </View>
              )}
              <AccountDeletion key={session.user.id} userId={session.user.id} />
            </View>
          </View>
        ) : null}
        <View style={styles.links}>
          <Action
            title="Privacy"
            variant="link"
            onPress={() => task(() => Linking.openURL('https://www.tryout.agency/privacy'))}
          />
          <Action
            title="Terms"
            variant="link"
            onPress={() => task(() => Linking.openURL('https://www.tryout.agency/terms'))}
          />
          <Action
            title="Support"
            variant="link"
            onPress={() => task(() => Linking.openURL('https://www.tryout.agency/support'))}
          />
          {!session ? (
            <Action
              title="Request account deletion"
              variant="link"
              onPress={() =>
                task(() => Linking.openURL('https://www.tryout.agency/delete-account'))
              }
            />
          ) : null}
          <Image
            source={require('../assets/gameday-sports-light.png')}
            style={{ width: 160, height: 80 }}
            resizeMode="contain"
            accessibilityLabel="Gameday Sports"
          />
          <Text style={styles.small}>TryOutFlow is part of Gameday Sports.</Text>
          <Text style={styles.small}>
            Operated by GameDay Technologies · gamedaysportstech@gmail.com
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  content: {
    padding: 24,
    paddingBottom: 48,
    gap: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  wideContent: { maxWidth: 1200, paddingHorizontal: 36, paddingTop: 36, gap: 26 },
  intro: { gap: 20 },
  wideIntro: { flexDirection: 'row', alignItems: 'stretch', gap: 20 },
  header: { gap: 12, paddingTop: 12, paddingBottom: 4 },
  wideHeader: {
    flex: 1,
    justifyContent: 'center',
    padding: 40,
    borderRadius: 24,
    backgroundColor: '#111e2c',
    minHeight: 540,
  },
  brandIcon: { width: 76, height: 76, borderRadius: 18, marginBottom: 22 },
  wideTitle: { color: '#fff', fontSize: 44, lineHeight: 50 },
  wideCopy: { color: '#dce7f1', fontSize: 18, lineHeight: 27 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2, color: '#294df2' },
  wideEyebrow: { color: '#76aaff' },
  title: { fontSize: 36, fontWeight: '800', color: '#101d32' },
  heading: { fontSize: 23, fontWeight: '700', color: '#101d32' },
  copy: { fontSize: 16, lineHeight: 24, color: '#5b6b80' },
  small: { fontSize: 13, lineHeight: 20, color: '#5b6b80' },
  card: {
    backgroundColor: '#fff',
    padding: 22,
    borderRadius: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#dce3ed',
    shadowColor: '#101d32',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  wideSignInCard: { flex: 1, justifyContent: 'center', padding: 36, minHeight: 540 },
  offer: { borderTopWidth: 1, borderTopColor: '#dce3ed', paddingTop: 18, gap: 10 },
  label: { fontSize: 14, fontWeight: '700', color: '#101d32' },
  input: { borderWidth: 1, borderColor: '#a2b0c2', borderRadius: 10, padding: 14, fontSize: 16 },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#0057ff',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  secondaryButton: { backgroundColor: '#eef2f7' },
  secondaryButtonText: { color: '#101d32' },
  linkButton: {
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 0,
  },
  linkText: { color: '#0057ff', textDecorationLine: 'underline', textAlign: 'left' },
  notice: {
    backgroundColor: '#fff4d8',
    color: '#563900',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    lineHeight: 24,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 20,
    rowGap: 0,
    borderTopWidth: 1,
    borderTopColor: '#dce3ed',
    paddingTop: 12,
  },
  workspaceLayout: { gap: 20 },
  wideWorkspaceLayout: { flexDirection: 'row', alignItems: 'flex-start' },
  workspaceSidebar: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#111e2c',
    minWidth: 260,
    maxWidth: 360,
  },
  workspaceMain: { flex: 1, minWidth: 0 },
  sidebarLabel: { color: '#aab8c5', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  sidebarCopy: { color: '#dce7f1', fontSize: 14, lineHeight: 20 },
  workspaceChoice: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#394750',
    backgroundColor: '#1c2b38',
    gap: 3,
  },
  workspaceChoiceSelected: { backgroundColor: '#dce9ff', borderColor: '#0057ff' },
  workspaceChoiceName: { color: '#f8fbff', fontSize: 16, fontWeight: '700' },
  workspaceChoiceNameSelected: { color: '#142030' },
  workspaceRole: { color: '#aab8c5', fontSize: 12 },
  workspaceRoleSelected: { color: '#34414a' },
});
