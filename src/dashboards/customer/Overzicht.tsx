import { CalendarClock, CheckCircle2, Euro, Loader2, Truck } from 'lucide-react'
import { SERVICES, type WashJob } from '../../lib/types'
import { dateFull, money, time } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'
import { useCompany } from './useCompany'
import { startOfDay } from '../../lib/analytics'

const DAY = 86_400_000

export function statusBadge(j: WashJob) {
  switch (j.status) {
    case 'bezig': return <Badge tone="brand" dot>In de wasstraat</Badge>
    case 'gereed': return <Badge tone="ok">Gereed</Badge>
    case 'wachtrij': return <Badge tone="warn">In de wachtrij</Badge>
    case 'geannuleerd': return <Badge tone="danger">Geannuleerd</Badge>
    default: return <Badge tone="info">Ingepland</Badge>
  }
}

export default function Overzicht() {
  const { company, jobs } = useCompany()

  const now = Date.now()
  const monthFrom = startOfDay(now - 29 * DAY)

  const komend = jobs
    .filter((j) => j.scheduledAt >= startOfDay(now) && (j.status === 'gepland' || j.status === 'wachtrij'))
    .sort((a, b) => a.scheduledAt - b.scheduledAt)

  const actief = jobs.filter((j) => j.status === 'bezig')

  const maandGereed = jobs.filter((j) => j.status === 'gereed' && (j.completedAt ?? 0) >= monthFrom)
  const maandBedrag = maandGereed.reduce((a, j) => a + j.priceExcl, 0)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Nu in behandeling" value={actief.length} icon={<Loader2 size={17} />} />
        <Stat label="Ingepland" value={komend.length} icon={<CalendarClock size={17} />} tone="warn" />
        <Stat label="Wasbeurten (30 dagen)" value={maandGereed.length} icon={<CheckCircle2 size={17} />} tone="ok" />
        <Stat label="Bedrag (30 dagen)" value={money(maandBedrag)} icon={<Euro size={17} />} />
      </div>

      {actief.length > 0 && (
        <Card title="Op dit moment in de wasstraat" className="mb">
          <div className="grid cols-2">
            {actief.map((j) => {
              const meta = SERVICES[j.service]
              const elapsed = j.startedAt ? now - j.startedAt : 0
              const pct = Math.min(100, (elapsed / (meta.minutes * 60000)) * 100)
              return (
                <div
                  key={j.id}
                  style={{
                    border: '1px solid var(--line)', borderRadius: 'var(--radius)',
                    padding: 16, background: 'var(--bg-2)',
                  }}
                >
                  <div className="row" style={{ marginBottom: 8 }}>
                    <Truck size={17} color="var(--brand)" />
                    <strong>{j.plate}</strong>
                    <span style={{ flex: 1 }} />
                    {statusBadge(j)}
                  </div>
                  <div style={{ fontSize: '.82rem', color: 'var(--text-3)', marginBottom: 10 }}>
                    {meta.label} · verwacht klaar rond{' '}
                    {j.startedAt ? time(j.startedAt + meta.minutes * 60000) : '—'}
                  </div>
                  <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div className="grid sidebar-right" style={{ marginTop: 16 }}>
        <Card title="Komende afspraken" hint={company?.name} flush>
          {komend.length === 0 ? (
            <Empty text="Geen afspraken ingepland." icon={<CalendarClock size={30} />} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Tijd</th>
                    <th>Kenteken</th>
                    <th>Behandeling</th>
                    <th className="num">Prijs excl.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {komend.map((j) => (
                    <tr key={j.id}>
                      <td>{dateFull(j.scheduledAt).replace(/^\w+ /, '')}</td>
                      <td className="mono">{time(j.scheduledAt)}</td>
                      <td><strong>{j.plate}</strong></td>
                      <td>{SERVICES[j.service].label}</td>
                      <td className="num">{money(j.priceExcl)}</td>
                      <td>{statusBadge(j)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Contract" hint={company ? `${company.city}` : undefined}>
          {!company ? (
            <Empty text="Geen klantgegevens gevonden." />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <Row label="Bedrijf" value={company.name} />
              <Row label="Contactpersoon" value={company.contact} />
              <Row label="E-mail" value={company.email} />
              <Row label="Telefoon" value={company.phone} />
              <Row
                label="Contractkorting"
                value={
                  company.contractDiscountPct > 0
                    ? `${company.contractDiscountPct}% op alle behandelingen`
                    : 'Geen korting'
                }
              />
              <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
                <div style={{ fontSize: '.75rem', color: 'var(--text-3)', marginBottom: 8 }}>
                  TARIEVEN (NA KORTING)
                </div>
                {Object.entries(SERVICES).map(([key, s]) => (
                  <div
                    key={key}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.83rem', padding: '3px 0' }}
                  >
                    <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                    <span className="mono">
                      {money(s.price * (1 - company.contractDiscountPct / 100))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '.85rem' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  )
}
