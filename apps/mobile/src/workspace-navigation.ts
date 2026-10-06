export function workspaceNavigation(url: string, origin: string): 'allow' | 'billing' | 'blocked' {
  try {
    const target = new URL(url);
    if (target.origin !== origin || target.username || target.password) return 'blocked';
    if (
      /\/organization\/billing(?:\/|$)/.test(target.pathname) ||
      target.pathname === '/pricing' ||
      /\/billing\/(checkout|portal|plan-change)/.test(target.pathname)
    )
      return 'billing';
    if (
      target.pathname === '/app' ||
      target.pathname.startsWith('/app/') ||
      [
        '/',
        '/how-to',
        '/features',
        '/for/teams',
        '/for/clubs',
        '/for/associations',
        '/demo',
        '/native',
        '/sign-in',
        '/sign-up',
        '/start',
        '/verify-email',
        '/participant',
        '/forgot-password',
        '/reset-password',
        '/delete-account',
        '/privacy',
        '/terms',
        '/support',
      ].includes(target.pathname) ||
      target.pathname.startsWith('/auth/') ||
      target.pathname.startsWith('/register/') ||
      target.pathname.startsWith('/invite/') ||
      target.pathname === '/platform' ||
      target.pathname.startsWith('/platform/')
    )
      return 'allow';
    return 'blocked';
  } catch {
    return 'blocked';
  }
}

export function reportDownload(url: string, origin: string) {
  try {
    const target = new URL(url);
    return (
      target.origin === origin &&
      /^(\/app\/[^/]+\/reports\/(scouting\/export|exports\/[a-f0-9-]{36})|\/api\/organizations\/[a-f0-9-]{36}\/exports\/(athletes|evaluations|roster))$/.test(
        target.pathname,
      )
    );
  } catch {
    return false;
  }
}
