import * as Print from 'expo-print';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import NativeBilling from './NativeBilling';
import { Action } from './Action';
import {
  getWorkspaceSession,
  parseWorkspaceSession,
  setWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { cleanupTemporaryReports } from './temporary-reports';
import { reportDownload, workspaceNavigation } from './workspace-navigation';
const origin = new URL(process.env.EXPO_PUBLIC_API_URL ?? 'https://www.tryout.agency').origin;
export default function Workspace() {
  const view = useRef<WebView>(null);
  const lastDashboard = useRef('/app');
  const currentPath = useRef('/app');
  const nonce = useRef(randomUUID());
  const reports = useRef(new Set<string>());
  const sharing = useRef(false);
  const reportCleanup = useRef<Promise<void>>(Promise.resolve());
  const [sourceUri, setSourceUri] = useState(
    `${origin}/native?platform=${Platform.OS === 'ios' ? 'apple' : 'google'}`,
  );
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [requestedSlug, setRequestedSlug] = useState('');
  const [billing, setBilling] = useState(false);
  const [back, setBack] = useState(false);
  const [forward, setForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const cleanup = cleanupTemporaryReports(FileSystem);
    reportCleanup.current = cleanup;
    cleanup.catch(() => {
      if (active)
        setError(
          'Temporary report cleanup could not finish. Restart the app before sharing another report.',
        );
    });
    return () => {
      active = false;
    };
  }, []);
  function clearSession() {
    setWorkspaceSession(null);
    setSession(null);
    setBilling(false);
  }
  useEffect(() => {
    setWorkspaceSession(null);
    function open(url: string | null) {
      if (!url) return;
      try {
        const target = new URL(url);
        const path =
          target.protocol === 'tryoutflow:'
            ? `/${target.hostname}${target.pathname}`
            : target.origin === origin
              ? target.pathname
              : '';
        if (path !== '/app' && !path.startsWith('/app/')) return;
        setSourceUri(
          `${origin}/native?platform=${Platform.OS === 'ios' ? 'apple' : 'google'}&next=${encodeURIComponent(path)}`,
        );
      } catch {
        /* Unsupported links do not cross the app boundary. */
      }
    }
    Linking.getInitialURL().then(open);
    const listener = Linking.addEventListener('url', (event) => open(event.url));
    return () => {
      listener.remove();
      setWorkspaceSession(null);
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(clearSession, Math.max(0, session.expiresAt * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (billing) {
        returnDashboard();
        return true;
      }
      if (back) {
        view.current?.goBack();
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [back, billing]);
  function returnDashboard() {
    setBilling(false);
    if (currentPath.current.endsWith('/organization/billing')) {
      if (back) view.current?.goBack();
      else
        view.current?.injectJavaScript(
          `window.location.replace(${JSON.stringify(`${origin}${lastDashboard.current}`)});true;`,
        );
    }
  }
  function openBilling() {
    const current = getWorkspaceSession();
    if (!current) {
      setError('Sign in to review billing and purchases.');
      return;
    }
    setSession(current);
    setError('');
    setBilling(true);
  }
  function fileResult(requestId: string, message: string) {
    view.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('tryoutflow-file-result',{detail:${JSON.stringify({ nonce: nonce.current, requestId, message })}}));true;`,
    );
  }
  async function message(event: WebViewMessageEvent) {
    try {
      if (
        new URL(event.nativeEvent.url).origin !== origin ||
        event.nativeEvent.data.length > 7 * 1024 * 1024
      )
        return;
      const data = JSON.parse(event.nativeEvent.data);
      if (data.nonce !== nonce.current) return;
      if ((data.type === 'print' || data.type === 'report') && data.userId !== session?.user.id) {
        setError('Your account changed. Open the report again.');
        fileResult(data.requestId, 'Your account changed. Open the report again.');
        return;
      }
      if ((data.type === 'print' || data.type === 'report') && sharing.current) {
        fileResult(
          data.requestId,
          'Another report is still sharing. Retry after closing the share sheet.',
        );
        return;
      }
      if (data.type === 'navigation') {
        const path = new URL(event.nativeEvent.url).pathname;
        if (
          path !== data.pathname ||
          workspaceNavigation(event.nativeEvent.url, origin) !== 'allow' ||
          !path.startsWith('/app/')
        )
          return;
        lastDashboard.current = path;
        const slug = path.split('/')[2];
        if (slug) setRequestedSlug(slug);
        return;
      }
      if (data.type === 'billing') {
        const current = getWorkspaceSession();
        const path = new URL(event.nativeEvent.url).pathname;
        if (
          !current ||
          data.userId !== current.user.id ||
          typeof data.slug !== 'string' ||
          !/^[a-z0-9-]+$/.test(data.slug) ||
          path !== `/app/${data.slug}/organization/billing`
        )
          return;
        currentPath.current = path;
        setRequestedSlug(data.slug);
        openBilling();
        return;
      }
      if (data.type === 'print') {
        if (
          !session ||
          session.expiresAt * 1000 <= Date.now() ||
          sharing.current ||
          typeof data.requestId !== 'string' ||
          reports.current.has(data.requestId) ||
          typeof data.html !== 'string' ||
          /<(script|iframe)\b/i.test(data.html)
        )
          return;
        reports.current.add(data.requestId);
        sharing.current = true;
        setFileBusy(true);
        let file: string | undefined;
        try {
          await reportCleanup.current;
          if (!(await Sharing.isAvailableAsync())) throw new Error();
          const result = await Print.printToFileAsync({ html: data.html });
          if (!FileSystem.cacheDirectory || !result.uri.startsWith(FileSystem.cacheDirectory))
            throw new Error();
          file = result.uri;
          const reportFile = `${FileSystem.cacheDirectory}tryoutflow-report-${randomUUID()}.pdf`;
          await FileSystem.moveAsync({ from: file, to: reportFile });
          file = reportFile;
          if (getWorkspaceSession()?.user.id !== session.user.id) throw new Error();
          await Sharing.shareAsync(file, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
          fileResult(data.requestId, 'PDF prepared. Share sheet closed.');
        } catch {
          setError('PDF preparation or sharing could not finish. Please retry.');
          fileResult(data.requestId, 'PDF preparation or sharing could not finish. Please retry.');
        } finally {
          sharing.current = false;
          setFileBusy(false);
          if (file)
            await FileSystem.deleteAsync(file, { idempotent: true }).catch(() =>
              setError('Temporary report cleanup could not finish. Please restart the app.'),
            );
        }
        return;
      }
      if (data.type === 'report') {
        if (
          !session ||
          session.expiresAt * 1000 <= Date.now() ||
          sharing.current ||
          typeof data.requestId !== 'string' ||
          reports.current.has(data.requestId) ||
          typeof data.data !== 'string' ||
          (data.mime !== 'text/csv' && data.mime !== 'application/json') ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(data.data)
        )
          return;
        reports.current.add(data.requestId);
        sharing.current = true;
        setFileBusy(true);
        const extension = data.mime === 'application/json' ? 'json' : 'csv';
        const file = `${FileSystem.cacheDirectory}tryoutflow-report-${randomUUID()}.${extension}`;
        try {
          await reportCleanup.current;
          if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error();
          await FileSystem.writeAsStringAsync(file, data.data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (getWorkspaceSession()?.user.id !== session.user.id) throw new Error();
          await Sharing.shareAsync(file, {
            mimeType: data.mime,
            UTI:
              data.mime === 'application/json'
                ? 'public.json'
                : 'public.comma-separated-values-text',
          });
          fileResult(data.requestId, 'Report prepared. Share sheet closed.');
        } catch {
          setError('Report sharing could not finish. Retry the report download.');
          fileResult(data.requestId, 'Report sharing could not finish. Retry the report download.');
        } finally {
          sharing.current = false;
          setFileBusy(false);
          await FileSystem.deleteAsync(file, { idempotent: true }).catch(() =>
            setError('Temporary report cleanup could not finish. Please restart the app.'),
          );
        }
        return;
      }
      if (data.type !== 'session' || event.nativeEvent.data.length > 16000) return;
      if (data.session === null) {
        clearSession();
        return;
      }
      const next = parseWorkspaceSession(data.session);
      if (!next) {
        clearSession();
        setError('Your session expired. Sign in again.');
        return;
      }
      if (session?.user.id && session.user.id !== next.user.id) setBilling(false);
      setWorkspaceSession(next);
      setSession(next);
    } catch {
      /* Untrusted/invalid bridge input does not execute actions. */
    }
  }
  return (
    <SafeAreaView
      style={[
        styles.safe,
        Platform.OS === 'android' && { paddingTop: StatusBar.currentHeight ?? 0 },
      ]}
    >
      {Platform.OS === 'android' ? <StatusBar barStyle="dark-content" /> : null}
      {billing && session ? (
        <NativeBilling
          key={`${session.user.id}-${requestedSlug}`}
          initialWorkspaceSlug={requestedSlug}
          embeddedSession={session}
          onReturn={returnDashboard}
        />
      ) : (
        <>
          {fileBusy ? (
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              Preparing report for sharing…
            </Text>
          ) : null}
          {loading ? (
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              Loading your workspace…
            </Text>
          ) : null}
          {error ? (
            <View style={styles.status}>
              <Text accessibilityRole="alert">{error}</Text>
              <Action
                title="Retry workspace"
                onPress={() => {
                  setError('');
                  view.current?.reload();
                }}
              />
            </View>
          ) : null}
        </>
      )}
      {Platform.OS === 'ios' && !billing && (back || forward) ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 4 }}>
          <Action title="Back" disabled={!back} onPress={() => view.current?.goBack()} />
          <Action title="Forward" disabled={!forward} onPress={() => view.current?.goForward()} />
        </View>
      ) : null}
      <WebView
        ref={view}
        style={styles.web}
        containerStyle={billing ? styles.hidden : styles.web}
        source={{ uri: sourceUri }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        onOpenWindow={() => setError('This link cannot open a separate window inside the app.')}
        allowFileAccess={false}
        allowsBackForwardNavigationGestures
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        injectedJavaScriptBeforeContentLoaded={`window.__tryoutflowNonce=${JSON.stringify(nonce.current)};window.dispatchEvent(new Event('tryoutflow-native-ready'));true;`}
        injectedJavaScript={`window.__tryoutflowNonce=${JSON.stringify(nonce.current)};window.dispatchEvent(new Event('tryoutflow-native-ready'));true;`}
        onMessage={message}
        onShouldStartLoadWithRequest={(request) => {
          // Cloudflare's challenge iframe may navigate, but receives no bridge nonce and cannot become the top-level app.
          if (request.isTopFrame === false) {
            try {
              const frame = new URL(request.url);
              return (
                request.url === 'about:blank' ||
                request.url === 'about:srcdoc' ||
                frame.origin === origin ||
                (frame.protocol === 'https:' && frame.hostname === 'challenges.cloudflare.com')
              );
            } catch {
              return false;
            }
          }
          if (reportDownload(request.url, origin)) {
            view.current?.injectJavaScript(
              `(function(){var a=document.createElement('a');a.href=${JSON.stringify(request.url)};document.body.appendChild(a);a.click();a.remove();})();true;`,
            );
            return false;
          }
          const decision = workspaceNavigation(request.url, origin);
          if (decision === 'billing') openBilling();
          if (decision === 'blocked')
            setError('This destination cannot open inside the app. Return to your workspace.');
          return decision === 'allow';
        }}
        onNavigationStateChange={(state) => {
          setBack(state.canGoBack);
          setForward(state.canGoForward);
          try {
            currentPath.current = new URL(state.url).pathname;
            if (currentPath.current === '/sign-in') clearSession();
          } catch {
            clearSession();
          }
        }}
        onLoadStart={() => {
          setLoading(true);
          setError('');
        }}
        onLoadEnd={() => setLoading(false)}
        onFileDownload={(event) => {
          const url = event.nativeEvent.downloadUrl;
          if (reportDownload(url, origin))
            view.current?.injectJavaScript(
              `(function(){var a=document.createElement('a');a.href=${JSON.stringify(url)};document.body.appendChild(a);a.click();a.remove();})();true;`,
            );
          else setError('This file cannot be downloaded inside the app.');
        }}
        onError={() => {
          setLoading(false);
          setError(
            'Workspace could not load. Check your connection and retry. Your saved evaluations are not deleted.',
          );
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 400) {
            setLoading(false);
            setError('Workspace is temporarily unavailable. Please retry.');
          }
        }}
        renderLoading={() => <ActivityIndicator accessibilityLabel="Loading workspace" />}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  web: { flex: 1 },
  // WebView has its own flex wrapper: collapse the wrapper, not only the inner native view.
  hidden: { flex: 0, height: 0, maxHeight: 0, overflow: 'hidden' },
  status: { padding: 12, gap: 8, color: '#101d32' },
});
