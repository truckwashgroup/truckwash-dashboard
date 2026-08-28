import { useLiveQuery } from 'dexie-react-hooks'
import { create } from 'zustand'
import { db } from '../../lib/db'
import type { Company, WashJob } from '../../lib/types'
import { useAuth } from '../../store/useAuth'

/** Gedeeld tussen alle klantpagina's, zodat de keuze bovenin doorwerkt. */
const useOverride = create<{ id: string | null; set: (id: string) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}))

/**
 * Bepaalt welk klantaccount getoond wordt. Een klantgebruiker zit vast aan
 * zijn eigen bedrijf; iemand van Truckwash1 met de klantrol mag wisselen
 * om mee te kijken.
 */
export function useCompany() {
  const user = useAuth((s) => s.user)!
  const override = useOverride((s) => s.id)
  const setOverride = useOverride((s) => s.set)

  const companies = useLiveQuery(
    () => db.companies.orderBy('name').toArray(),
    [],
    [] as Company[],
  )

  const locked = !!user.companyId
  const companyId = user.companyId ?? override ?? companies[0]?.id ?? null
  const company = companies.find((c) => c.id === companyId) ?? null

  const jobs = useLiveQuery(
    async () => {
      if (!companyId) return [] as WashJob[]
      const rows = await db.washJobs.where('companyId').equals(companyId).toArray()
      return rows.sort((a, b) => b.scheduledAt - a.scheduledAt)
    },
    [companyId],
    [] as WashJob[],
  )

  return { company, companies, companyId, jobs, locked, setOverride }
}
