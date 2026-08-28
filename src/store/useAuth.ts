import { create } from 'zustand'
import { api, supabaseSignOut, usingSupabase } from '../lib/api'
import { db } from '../lib/db'
import { rememberOfflineLogin, verifyOfflineLogin } from '../lib/offlineAuth'
import { storageGet, storageRemove, storageSet } from '../lib/storage'
import { useSync } from '../lib/sync'
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

export const useAuth = create<AuthStore>((set, get) => ({
  user: null,
  role: null,
  booting: true,
  busy: false,
  error: null,

  restore: async () => {
    try {
      const raw = await storageGet(SESSION_KEY)
      if (!raw) return
      const session = JSON.parse(raw) as Session
      const user = await db.users.get(session.userId)
      if (user && user.active) set({ user })
      else await storageRemove(SESSION_KEY)
    } catch {
      /* corrupte sessie: gewoon opnieuw inloggen */
    } finally {
      set({ booting: false })
    }
  },

  login: async (email, password) => {
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
        await storageSet(SESSION_KEY, JSON.stringify({ ...res, at: Date.now() }))

        // Onthouden zodat deze persoon later ook zonder internet binnenkomt.
        await rememberOfflineLogin(email, password, userId)

        // Eerste keer: de lokale cache vullen.
        await useSync.getState().sync({ silent: true })
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
