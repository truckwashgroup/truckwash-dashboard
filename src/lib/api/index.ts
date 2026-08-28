import type { ApiAdapter } from './types'
import { mockApi } from './mockApi'
import { supabaseApi, supabaseConfigured, configError } from './supabaseApi'

const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

/**
 * De ingebouwde mock is er alleen nog voor de geautomatiseerde tests. In de
 * app zelf komt hij niet meer voor: die praat met Supabase, en zonder geldige
 * inloggegevens kom je er niet in.
 *
 * Aanzetten kan alleen bewust, met VITE_USE_MOCK=1 (browser) of TW_USE_MOCK=1
 * (Node, voor scripts/selftest.ts).
 */
const useMock =
  ENV.VITE_USE_MOCK === '1' ||
  (typeof process !== 'undefined' && process.env?.TW_USE_MOCK === '1')

export const api: ApiAdapter = useMock ? mockApi : supabaseApi

/** 'supabase' = klaar voor gebruik, 'none' = niet ingesteld, 'mock' = testmodus. */
export const activeBackend: 'supabase' | 'mock' | 'none' =
  useMock ? 'mock' : supabaseConfigured ? 'supabase' : 'none'

export const usingSupabase = activeBackend === 'supabase'

/** Waarom er niet ingelogd kan worden, of null als alles klopt. */
export const backendError: string | null =
  activeBackend === 'none'
    ? configError ??
      'Er is nog geen verbinding met de database ingesteld. Zet VITE_SUPABASE_URL ' +
      'en VITE_SUPABASE_ANON_KEY in het .env-bestand en start de app opnieuw.'
    : null

export type { ApiAdapter, PushChange, PullResult } from './types'
export { isForcedOffline, setForcedOffline } from './mockApi'
export { supabase, supabaseSignOut } from './supabaseApi'
