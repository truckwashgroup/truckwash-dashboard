import { create } from 'zustand'
import { api, backendError, supabaseSignOut, usingSupabase } from '../lib/api'
import { db, getMeta, setMeta } from '../lib/db'
import { rememberOfflineLogin, verifyOfflineLogin } from '../lib/offlineAuth'
import { storageGet, storageRemove, storageSet } from '../lib/storage'
import { ensureBackendMatches, LAST_SYNC, setSyncEnabled, useSync } from '../lib/sync'
import type { Role, User } from '../lib/types'

const SESSION_KEY = 'tw.session'

interface Session {
  userId: string
  token: string
  at: number
}

interface AuthStore {
  user: User | null
  role: Role | null
  booting: boolean
  busy: boolean
  error: string | null

  restore: () => Promise<void>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  chooseRole: (role: Role) => void
  clearRole: () => void
}

const CACHE_OWNER = 'cacheOwner'

/**
 * Zorgt dat de lokale cache bij deze gebruiker hoort.
 *
 * Logt er iemand anders in op hetzelfde apparaat, dan moeten de gegevens van
 * de vorige weg -- een klant hoort de wasbeurten van een collega niet in zijn
 * cache te vinden. En omdat rechten intussen gewijzigd kunnen zijn, halen we
 * na elke inlog alles opnieuw op in plaats van alleen het verschil.
 *
 * De outbox blijft staan: wijzigingen die nog verstuurd moeten worden mogen
 * niet verdwijnen.
 */
async function prepareCacheFor(userId: string) {
  const previous = await getMeta<string | null>(CACHE_OWNER, null)

  if (previous && previous !== userId) {
    await Promise.all([
      db.users.clear(), db.companies.clear(), db.washJobs.clear(),
      db.inventory.clear(), db.stockMovements.clear(),
      db.expenses.clear(), db.timeEntries.clear(),
    ])
  }

  await setMeta(CACHE_OWNER, userId)
  await setMeta(LAST_SYNC, 0)
  useSync.setState({ lastSyncAt: null })
}

export const useAuth = create<AuthStore>((set, get) => ({
  user: null,
  role: null,
  booting: true,
  busy: false,
  error: null,

  restore: async () => {
    try {
      // Van backend gewisseld? Dan is de oude sessie niets meer waard.
      if (await ensureBackendMatches()) {
        await storageRemove(SESSION_KEY)
        return
      }

      const raw = await storageGet(SESSION_KEY)
      if (!raw) return
      const session = JSON.parse(raw) as Session
      const user = await db.users.get(session.userId)
      if (user && user.active) {
        set({ user })
        setSyncEnabled(true)
      } else {
        await storageRemove(SESSION_KEY)
      }
    } catch {
      /* corrupte sessie: gewoon opnieuw inloggen */
    } finally {
      set({ booting: false })
    }
  },

  login: async (email, password) => {
    if (backendError) {
      set({ error: backendError })
      return false
    }

    set({ busy: true, error: null })
    try {
      let userId: string | null = null

      try {
        const res = await api.login(email, password)
        if (!res) {
          set({ error: 'E-mailadres of wachtwoord klopt niet.', busy: false })
          return false
        }
        userId = res.userId
        await storageSet(SESSION_KEY, JSON.stringify({ ...res, profile: undefined, at: Date.now() }))

        // Onthouden zodat deze persoon later ook zonder internet binnenkomt.
        await rememberOfflineLogin(email, password, userId)

        await prepareCacheFor(userId)

        // Het profiel komt met de inlog mee, dus we kunnen meteen door. De
        // rest van de gegevens haalt de synchronisatie op de achtergrond op,
        // terwijl de wasstraat-animatie loopt. Vroeger stond je hier te
        // wachten tot alles binnen was, en dat duurde bij een volle database
        // seconden.
        if (res.profile) {
          await db.users.put(res.profile as unknown as User)
        }

        setSyncEnabled(true)

        if (res.profile) {
          void useSync.getState().sync({ silent: true })
        } else {
          // Geen profiel meegekregen: dan moeten we wel wachten, anders
          // weten we niet wie er binnenkomt.
          await useSync.getState().sync({ silent: true })
        }
      } catch {
        // Geen verbinding: terugvallen op wat dit apparaat eerder leerde.
        userId = await verifyOfflineLogin(email, password)
        if (!userId) {
          set({
            error:
              'Geen verbinding, en dit account is nog niet eerder op dit ' +
              'apparaat gebruikt. Log één keer met internet in.',
            busy: false,
          })
          return false
        }
        await storageSet(
          SESSION_KEY,
          JSON.stringify({ userId, token: 'offline', at: Date.now() }),
        )
        setSyncEnabled(true)
      }

      const user = await db.users.get(userId)
      if (!user) {
        set({
          error: usingSupabase
            ? 'Inloggen lukte, maar er staat geen profiel bij dit account. ' +
              'Voeg een rij toe in de tabel "profiles".'
            : 'Account niet gevonden in de lokale gegevens.',
          busy: false,
        })
        return false
      }
      if (!user.active) {
        set({ error: 'Dit account is geblokkeerd.', busy: false })
        return false
      }

      set({ user, role: null, busy: false, error: null })
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Inloggen mislukt', busy: false })
      return false
    }
  },

  logout: async () => {
    setSyncEnabled(false)
    await storageRemove(SESSION_KEY)
    await supabaseSignOut()
    set({ user: null, role: null, error: null })
  },

  chooseRole: (role) => {
    const user = get().user
    if (user && user.roles.includes(role)) set({ role })
  },

  clearRole: () => set({ role: null }),
}))
