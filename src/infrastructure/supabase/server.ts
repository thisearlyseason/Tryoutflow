import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { getClientEnvironment } from '../../lib/env';
import type { Database } from './database.types';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const environment = getClientEnvironment();

  return createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Proxy refreshes session cookies for Server Components that cannot write them.
          }
        },
      },
    },
  );
}

function copyResponseCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach(({ name, value, ...options }) => {
    to.cookies.set(name, value, options);
  });
}

export function createProxySupabaseClient(request: NextRequest) {
  const environment = getClientEnvironment();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });

          const refreshedResponse = NextResponse.next({ request });
          copyResponseCookies(response, refreshedResponse);
          cookiesToSet.forEach(({ name, value, options }) => {
            refreshedResponse.cookies.set(name, value, options);
          });
          response = refreshedResponse;
        },
      },
    },
  );

  return {
    response: () => response,
    supabase,
  };
}
