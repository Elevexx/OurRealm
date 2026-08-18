// Supabase browser client secured by OurRealm identity.
//
// The public anon key identifies the Supabase PROJECT.
// A short-lived JWT from /api/auth/supabase-token identifies the USER.
// RLS then decides what that user is allowed to access.

import { createClient } from "@supabase/supabase-js";
import apiClient from "@/api/client";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY
);

let cachedAccessToken = null;
let cachedExpiresAt = 0;
let tokenRequest = null;

export function clearSupabaseIdentityCache() {
  cachedAccessToken = null;
  cachedExpiresAt = 0;
}

async function getOurRealmSupabaseAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  // Reuse the token until one minute before expiration.
  if (cachedAccessToken && cachedExpiresAt - now > 60) {
    return cachedAccessToken;
  }

  // Prevent multiple simultaneous requests from minting duplicate tokens.
  if (tokenRequest) return tokenRequest;

  tokenRequest = apiClient
    .get("/auth/supabase-token")
    .then(({ data }) => {
      if (!data?.access_token) return null;

      cachedAccessToken = data.access_token;
      cachedExpiresAt = Number(data.expires_at || 0);

      return cachedAccessToken;
    })
    .catch((error) => {
      clearSupabaseIdentityCache();

      // 401 simply means the user is not logged in.
      if (error?.response?.status !== 401) {
        console.warn(
          "Supabase identity token unavailable:",
          error?.response?.status || error?.message
        );
      }

      return null;
    })
    .finally(() => {
      tokenRequest = null;
    });

  return tokenRequest;
}

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      accessToken: getOurRealmSupabaseAccessToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    })
  : null;
