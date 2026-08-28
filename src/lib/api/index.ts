import type { ApiAdapter } from './types'
import { mockApi } from './mockApi'
import { supabaseApi, supabaseConfigured } from './supabaseApi'

/**
 * Welke backend de app gebruikt.
 *
 * Staan VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY in je .env? Dan praat de
 * app met Supabase. Zo niet, dan valt hij terug op de ingebouwde mock, zodat
 * je altijd iets werkends hebt om in te kijken.
 *
 * De rest van de app kent alleen de ApiAdapter-interface en merkt het verschil
 * niet: dezelfde schermen, dezelfde offline-wachtrij.
 */
export const api: ApiAdapter = supabaseConfigured ? supabaseApi : mockApi

export const usingSupabase = supabaseConfigured

export type { ApiAdapter, PushChange, PullResult } from './types'
export { DEMO_ACCOUNTS, isForcedOffline, setForcedOffline, seedMockServer } from './mockApi'
export { supabase, supabaseSignOut } from './supabaseApi'
