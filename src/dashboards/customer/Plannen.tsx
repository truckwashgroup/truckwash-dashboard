import { useMemo, useState } from 'react'
import { CalendarPlus, Clock, Info } from 'lucide-react'
import { jobs as jobRepo } from '../../lib/repo'
import { SERVICES, type ServiceKind } from '../../lib/types'
import { money } from '../../lib/format'
import { Card, Field } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'
import { useSync } from '../../lib/sync'
import { useCompany } from './useCompany'

const SLOTS = ['07:00', '08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00']

export default function Plannen() {
  const user = useAuth((s) => s.user)!
  const online = useSync((s) => s.online)
  const { company, jobs } = useCompany()

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const [plate, setPlate] = useState('')
  const [service, setService] = useState<ServiceKind>('combi')
  const [date, setDate] = useState(tomorrow)
  const [slot, setSlot] = useState('08:00')
  const [notes, setNotes] = useState('')

  const discount = company?.contractDiscountPct ?? 0
  const price = useMemo(
    () => Math.round(SERVICES[service].price * (1 - discount / 100) * 100) / 100,
    [service, discount],
  )

  // welke tijdvakken zijn al bezet op de gekozen dag
  const taken = useMemo(() => {
    const d = new Date(date + 'T00:00:00').getTime()
    return new Set(
      jobs
        .filter((j) => j.scheduledAt >= d && j.scheduledAt < d + 86_400_000 && j.status !== 'geannuleerd')
        .map((j) => new Date(j.scheduledAt).toTimeString().slice(0, 5)),
    )
  }, [jobs, date])

  async function submit() {
    if (!company) return toast.error('Geen klantgegevens gevonden')
    if (!/^[A-Za-z0-9-]{4,12}$/.test(plate.trim())) {
      return toast.error('Vul een geldig kenteken in')
    }
    const scheduledAt = new Date(`${date}T${slot}:00`).getTime()
    if (!Number.isFinite(scheduledAt)) return toast.error('Ongeldige datum of tijd')

    await jobRepo.create({
      companyId: company.id,
      companyName: company.name,
      plate,
      service,
      scheduledAt,
      notes: notes.trim() || undefined,
      createdBy: user.id,
      discountPct: discount,
    })

    toast.ok(
      online
        ? `Afspraak voor ${plate.toUpperCase()} ingepland`
        : `Afspraak lokaal opgeslagen — wordt verstuurd zodra er verbinding is`,
    )
    setPlate('')
    setNotes('')
  }

  return (
    <div className="grid sidebar-right">
      <Card title="Wasbeurt inplannen" hint={company?.name}>
        <Field label="Kenteken">
          <input
            className="input"
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="12-BND-4"
            autoCapitalize="characters"
          />
        </Field>

        <Field label="Behandeling">
          <select
            className="select"
            value={service}
            onChange={(e) => setService(e.target.value as ServiceKind)}
          >
            {(Object.keys(SERVICES) as ServiceKind[]).map((k) => (
              <option key={k} value={k}>
                {SERVICES[k].label} — ± {SERVICES[k].minutes} min
              </option>
            ))}
          </select>
        </Field>

        <div className="grid cols-2">
          <Field label="Datum">
            <input
              className="input"
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Tijdvak" help="Grijs = al bezet door een andere wagen">
            <select className="select" value={slot} onChange={(e) => setSlot(e.target.value)}>
              {SLOTS.map((s) => (
                <option key={s} value={s} disabled={taken.has(s)}>
                  {s} {taken.has(s) ? '(bezet)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Opmerking (optioneel)">
          <textarea
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bijv. extra aandacht voor de voorbumper"
          />
        </Field>

        <button className="btn primary block lg" onClick={() => void submit()}>
          <CalendarPlus size={17} /> Afspraak vastleggen
        </button>

        {!online && (
          <div
            className="row"
            style={{ marginTop: 12, fontSize: '.8rem', color: 'var(--warn)', gap: 7 }}
          >
            <Info size={14} />
            Je bent offline. De afspraak wordt bewaard en automatisch verstuurd.
          </div>
        )}
      </Card>

      <Card title="Wat je krijgt">
        <div
          style={{
            padding: 16, borderRadius: 'var(--radius)', background: 'var(--bg-2)',
            border: '1px solid var(--line-soft)', marginBottom: 14,
          }}
        >
          <div style={{ fontSize: '.78rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Prijs excl. btw
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-.03em' }}>
            {money(price)}
          </div>
          {discount > 0 && (
            <div style={{ fontSize: '.8rem', color: 'var(--ok)' }}>
              Inclusief {discount}% contractkorting
              <span style={{ color: 'var(--text-3)', textDecoration: 'line-through', marginLeft: 8 }}>
                {money(SERVICES[service].price)}
              </span>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 7, fontSize: '.84rem', color: 'var(--text-2)', marginBottom: 8 }}>
          <Clock size={15} color="var(--brand)" />
          Verwachte duur: ± {SERVICES[service].minutes} minuten
        </div>

        <p style={{ fontSize: '.83rem', color: 'var(--text-3)', lineHeight: 1.55 }}>
          Je wagen komt op de dagplanning te staan. Zodra een medewerker hem
          oppakt zie je de status live veranderen in het overzicht.
        </p>
      </Card>
    </div>
  )
}
