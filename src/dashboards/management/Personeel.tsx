import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft, BadgeCheck, ClipboardCheck, FolderLock, KeyRound, Mail, MapPin,
  Phone, Send, ShieldCheck, SlidersHorizontal,
  Timer, UserCog, UserPlus, Users,
} from 'lucide-react'
import { db } from '../../lib/db'
import { users as userRepo } from '../../lib/repo'
import { ROLE_LABELS, ROLE_ORDER, type Role, type Shift, type TimeEntry, type User, type WashJob } from '../../lib/types'
import { duration, initials, money, number } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import WeekRooster from '../../components/WeekRooster'
import PermissionEditor, { PermissionSummary } from '../../components/PermissionEditor'
import BerichtVersturen from '../../components/BerichtVersturen'
import Dossier from '../../components/Dossier'
import PersoonBeheer from '../../components/PersoonBeheer'
import { OpenWijzigingen, WijzigingAanvragen } from '../../components/Wijzigingen'
import NieuweMedewerker from '../../components/NieuweMedewerker'
import SmartRosterPanel from '../../components/SmartRosterPanel'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'
import { staffPerformance } from '../../lib/analytics'
import { dateInputValue, dayFromDateInput } from '../../lib/roster'
import LocatiesKiezer, { locatieSamenvatting, type LocatieKeuze } from '../../components/LocatiesKiezer'
import type { Location } from '../../lib/types'

const ALL_ROLES: Role[] = ROLE_ORDER

export default function Personeel({ days }: { days: number }) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const users = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])

  /* De uurtarieven staan in het afgeschermde deel van het dossier. Wie daar
     niet bij mag krijgt niets binnen, en ziet dus loonkosten van nul. */
  const tarieven = useLiveQuery(async () => {
    const rijen = await db.personnelPrivate.toArray()
    return new Map(rijen.filter((r) => r.hourlyRate).map((r) => [r.userId, r.hourlyRate!]))
  }, [], new Map<string, number>())

  const rows = useMemo(
    () => staffPerformance(users, jobs, entries, days, tarieven),
    [users, jobs, entries, days, tarieven],
  )

  const selected = users.find((u) => u.id === selectedId) ?? null

  if (selected) {
    return (
      <PersonDetail
        person={selected}
        days={days}
        onBack={() => setSelectedId(null)}
        canEdit={perms.can('staff.edit')}
        canPermissions={perms.can('staff.permissions')}
        meId={me.id}
      />
    )
  }

  const totaalUren = rows.reduce((a, r) => a + r.minuten, 0)
  const totaalLoon = rows.reduce((a, r) => a + r.loonkosten, 0)
  const totaalOmzet = rows.reduce((a, r) => a + r.omzet, 0)
  const zonderAccount = users.filter((u) => u.roles.includes('employee') && !u.authId).length

  return (
    <>
      <OpenWijzigingen />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Medewerkers" value={rows.length} icon={<Users size={17} />} />
        <Stat label={`Uren (${days}d)`} value={duration(totaalUren * 60000)} icon={<Timer size={17} />} />
        <Stat label="Loonkosten" value={money(totaalLoon)} icon={<UserCog size={17} />} tone="warn" />
        <Stat
          label={zonderAccount ? 'Zonder inlogaccount' : 'Omzet per loon-euro'}
          value={zonderAccount ? zonderAccount : totaalLoon > 0 ? (totaalOmzet / totaalLoon).toFixed(2) + '×' : '—'}
          icon={zonderAccount ? <KeyRound size={17} /> : <BadgeCheck size={17} />}
          tone={zonderAccount ? 'warn' : 'ok'}
        />
      </div>

      <Card
        title="Personeel"
        hint={`Prestaties over ${days} dagen · klik voor het dossier`}
        flush
        action={
          perms.can('staff.create') ? (
            <button className="btn primary sm" onClick={() => setAdding(true)}>
              <UserPlus size={15} /> Medewerker toevoegen
            </button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <Empty text="Nog geen medewerkers." icon={<Users size={30} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Medewerker</th>
                  <th>Nummer</th>
                  <th>Functie</th>
                  <th className="num">Wasbeurten</th>
                  <th className="num">Uren</th>
                  <th className="num">Omzet</th>
                  <th>Rollen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user: u, ...r }) => (
                  <tr
                    key={u.id}
                    style={{ opacity: u.active ? 1 : 0.5, cursor: 'pointer' }}
                    onClick={() => setSelectedId(u.id)}
                  >
                    <td>
                      <div className="row" style={{ gap: 9, flexWrap: 'nowrap' }}>
                        <div
                          style={{
                            width: 30, height: 30, borderRadius: 9, flex: 'none',
                            display: 'grid', placeItems: 'center',
                            background: 'var(--surface-3)', fontSize: '.7rem', fontWeight: 700,
                          }}
                        >
                          {initials(u.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <strong>{u.name}</strong>
                          <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{u.personnelNumber ?? '—'}</td>
                    <td>{u.function ?? '—'}</td>
                    <td className="num">{number(r.jobs)}</td>
                    <td className="num">{duration(r.minuten * 60000)}</td>
                    <td className="num">{money(r.omzet)}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {u.roles.map((role) => (
                          <Badge key={role} tone={role === 'management' ? 'brand' : 'default'}>
                            {role === 'management' && <ShieldCheck size={11} />}
                            {ROLE_LABELS[role]}
                          </Badge>
                        ))}
                        {!u.active && <Badge tone="danger">Inactief</Badge>}
                        {!u.authId && <Badge tone="warn"><KeyRound size={11} /> Geen login</Badge>}
                      </div>
                      <PermissionSummary user={u} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NieuweMedewerker
        open={adding}
        onClose={() => setAdding(false)}
        onKlaar={setSelectedId}
      />
    </>
  )
}

/* ================================================================== *
 *  Dossier van één medewerker
 * ================================================================== */

function PersonDetail({
  person, days, onBack, canEdit, canPermissions, meId,
}: {
  person: User
  days: number
  onBack: () => void
  canEdit: boolean
  canPermissions: boolean
  meId: string
}) {
  const [editing, setEditing] = useState(false)
  const [permissions, setPermissions] = useState(false)
  const [berichten, setBerichten] = useState(false)
  const [aanvragen, setAanvragen] = useState(false)
  const [tab, setTab] = useState<'overzicht' | 'dossier'>('overzicht')
  const perms = usePerms()

  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])
  const entries = useLiveQuery(() => db.timeEntries.toArray(), [], [] as TimeEntry[])
  const allShifts = useLiveQuery(
    () => db.shifts.where('userId').equals(person.id).toArray(),
    [person.id],
    [] as Shift[],
  )
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const prive = useLiveQuery(
    () => db.personnelPrivate.get(person.id), [person.id], undefined)

  const stats = useMemo(
    () => staffPerformance([person], jobs, entries, days)[0],
    [person, jobs, entries, days],
  )

  const komend = allShifts.filter((s) => s.startAt >= Date.now()).length

  async function toggleActive() {
    if (person.id === meId) return toast.warn('Je kunt jezelf niet blokkeren')
    await userRepo.setActive(person.id, !person.active)
    toast.info(`${person.name} is nu ${person.active ? 'inactief' : 'actief'}`)
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar het overzicht
      </button>

      <Card>
        <div className="person-head">
          <div className="person-avatar">{initials(person.name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ marginBottom: 3 }}>{person.name}</h2>
            <div className="row" style={{ gap: 6 }}>
              {person.personnelNumber && <Badge>{person.personnelNumber}</Badge>}
              {person.roles.map((r) => (
                <Badge key={r} tone={r === 'management' ? 'brand' : 'default'}>{ROLE_LABELS[r]}</Badge>
              ))}
              {!person.active && <Badge tone="danger">Inactief</Badge>}
              {!person.authId && <Badge tone="warn"><KeyRound size={11} /> Nog geen inlogaccount</Badge>}
            </div>
          </div>
          {canEdit && (
            <div className="row" style={{ gap: 6 }}>
              <button
                className={`btn sm ${tab === 'dossier' ? 'primary' : ''}`}
                onClick={() => setTab(tab === 'dossier' ? 'overzicht' : 'dossier')}
              >
                <FolderLock size={14} /> Dossier
              </button>
              <button className="btn sm" onClick={() => setBerichten(true)}>
                <Send size={14} /> Bericht
              </button>
              {perms.can('staff.request') && !perms.can('staff.edit') && (
                <button className="btn primary sm" onClick={() => setAanvragen(true)}>
                  <ClipboardCheck size={14} /> Wijziging aanvragen
                </button>
              )}
              <button className="btn sm" onClick={() => setEditing(true)}>
                <UserCog size={14} /> Gegevens
              </button>
              {canPermissions && (
                <button className="btn sm" onClick={() => setPermissions(true)}>
                  <SlidersHorizontal size={14} /> Rechten
                </button>
              )}
              <button
                className={`btn sm ${person.active ? 'ghost' : 'ok'}`}
                onClick={() => void toggleActive()}
                disabled={person.id === meId}
              >
                {person.active ? 'Blokkeren' : 'Activeren'}
              </button>
            </div>
          )}
        </div>

        <div className="person-fields">
          <Info label="E-mail" value={person.email} icon={<Mail size={13} />} />
          <Info label="Telefoon" value={person.phone ?? '—'} icon={<Phone size={13} />} />
          <Info label="Functie" value={person.function ?? '—'} />
          <Info label="Contracturen" value={person.contractHours ? `${person.contractHours} u/week` : '—'} />
          <Info
            label="In dienst sinds"
            value={person.startDate
              ? new Date(person.startDate).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
              : '—'}
          />
          <Info
            label="Vestiging"
            value={locatieSamenvatting(
              {
                locationId: person.locationId,
                manages: person.manages ?? [],
                allLocations: !!person.allLocations,
              },
              locaties,
            )}
            icon={<MapPin size={13} />}
          />
        </div>

        {(person.manages?.length ?? 0) > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="person-field">
              <div className="label">Geeft leiding op</div>
              <div className="row" style={{ gap: 5, marginTop: 4 }}>
                {(person.manages ?? []).map((id) => (
                  <Badge key={id} tone="info">
                    {locaties.find((l) => l.id === id)?.name ?? id}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {person.notes && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
            <div className="person-field">
              <div className="label">Notitie</div>
              <div className="value" style={{ color: 'var(--text-2)' }}>{person.notes}</div>
            </div>
          </div>
        )}

        {!person.authId && (
          <div
            style={{
              marginTop: 14, padding: '11px 13px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(245,181,68,.08)', border: '1px solid rgba(245,181,68,.3)',
              fontSize: '.83rem', color: '#ffd894',
            }}
          >
            <strong>Nog geen toegang tot de app.</strong> Laat {person.name.split(' ')[0]} zich
            aanmelden op het inlogscherm met exact dit adres: {person.email}. Dit dossier
            wordt dan vanzelf gekoppeld — mét de rollen die hier staan, dus zonder dat
            de aanmelding nog beoordeeld hoeft te worden.
          </div>
        )}
      </Card>

      <div className="row" style={{ gap: 6, margin: '16px 0 0' }}>
        <button
          className={`btn sm ${tab === 'overzicht' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('overzicht')}
        >
          Overzicht en rooster
        </button>
        <button
          className={`btn sm ${tab === 'dossier' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('dossier')}
        >
          <FolderLock size={14} /> Dossier
        </button>
      </div>

      {tab === 'dossier' && (
        <div className="mt">
          <Dossier person={person} />
        </div>
      )}

      {tab === 'overzicht' && <>
      <div className="grid cols-4" style={{ margin: '16px 0' }}>
        <Stat label={`Wasbeurten (${days}d)`} value={number(stats?.jobs ?? 0)} />
        <Stat label="Gewerkte uren" value={duration((stats?.minuten ?? 0) * 60000)} />
        <Stat label="Omzet" value={money(stats?.omzet ?? 0)} tone="ok" />
        <Stat label="Diensten ingepland" value={komend} tone="warn" />
      </div>

      <Card title="Rooster" hint={canEdit ? 'Klik op een dienst of op + om te wijzigen' : undefined}>
        <WeekRooster person={person} editable={canEdit} />
      </Card>

      {canEdit && person.id !== meId && (
        <PersoonBeheer person={person} onWeg={onBack} />
      )}
      </>}

      <EditPersonDialog
        open={editing}
        person={person}
        onClose={() => setEditing(false)}
      />

      <BerichtVersturen
        open={berichten}
        onClose={() => setBerichten(false)}
        team={[person]}
      />

      <WijzigingAanvragen
        open={aanvragen}
        person={person}
        prive={prive}
        onClose={() => setAanvragen(false)}
      />

      <Modal
        open={permissions}
        title="Rechten"
        subtitle={`Precies bepalen wat ${person.name.split(' ')[0]} wel en niet mag`}
        onClose={() => setPermissions(false)}
        width={720}
      >
        <PermissionEditor person={person} onClose={() => setPermissions(false)} />
      </Modal>
    </>
  )
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="person-field">
      <div className="label">{label}</div>
      <div className="value row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {icon && <span style={{ color: 'var(--text-3)' }}>{icon}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      </div>
    </div>
  )
}

/* ================================================================== *
 *  Gegevens en rechten wijzigen
 * ================================================================== */

function EditPersonDialog({
  open, person, onClose,
}: {
  open: boolean
  person: User
  onClose: () => void
}) {
  const leeg = () => ({
    name: person.name,
    phone: person.phone ?? '',
    function: person.function ?? '',
    personnelNumber: person.personnelNumber ?? '',
    hourlyRate: String(person.hourlyRate ?? ''),
    contractHours: String(person.contractHours ?? ''),
    notes: person.notes ?? '',
    roles: [...person.roles],
  })
  const legeLocatie = (): LocatieKeuze => ({
    locationId: person.locationId,
    manages: person.manages ?? [],
    allLocations: !!person.allLocations,
  })

  const [form, setForm] = useState(leeg)
  const [loc, setLoc] = useState<LocatieKeuze>(legeLocatie)
  const [key, setKey] = useState(person.id)

  if (open && key !== person.id) {
    setKey(person.id)
    setForm(leeg())
    setLoc(legeLocatie())
  }

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })

  async function save() {
    if (!form.name.trim()) return toast.error('Vul een naam in')
    if (form.roles.length === 0) return toast.error('Kies minimaal één rol')

    await userRepo.update(person.id, {
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      function: form.function.trim() || undefined,
      personnelNumber: form.personnelNumber.trim() || undefined,
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate.replace(',', '.')) : undefined,
      contractHours: form.contractHours ? Number(form.contractHours.replace(',', '.')) : undefined,
      notes: form.notes.trim() || undefined,
      roles: form.roles,
      locationId: loc.locationId,
      // Leeg opslaan als niets: een lege lijst leest als "nergens leiding".
      manages: loc.manages.length ? loc.manages : undefined,
      allLocations: loc.allLocations || undefined,
    })
    toast.ok('Gegevens bijgewerkt')
    onClose()
  }

  return (
    <Modal open={open} title="Gegevens en vestigingen" subtitle={person.email} onClose={onClose} width={600}>
      <div className="grid cols-2">
        <Field label="Naam">
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Personeelsnummer">
          <input className="input" value={form.personnelNumber} onChange={(e) => set({ personnelNumber: e.target.value })} />
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Telefoon">
          <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Functie">
          <input className="input" value={form.function} onChange={(e) => set({ function: e.target.value })} />
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Contracturen per week">
          <input className="input" inputMode="decimal" value={form.contractHours} onChange={(e) => set({ contractHours: e.target.value })} />
        </Field>
        <Field label="Uurtarief (€)">
          <input className="input" inputMode="decimal" value={form.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value })} />
        </Field>
      </div>

      <Field label="Toegang tot welke dashboards">
        <div className="row" style={{ gap: 6 }}>
          {ALL_ROLES.map((role) => {
            const on = form.roles.includes(role)
            return (
              <button
                key={role}
                type="button"
                className={`btn sm ${on ? 'primary' : ''}`}
                onClick={() => set({ roles: on ? form.roles.filter((r) => r !== role) : [...form.roles, role] })}
              >
                {role === 'management' && <ShieldCheck size={13} />}
                {ROLE_LABELS[role]}
              </button>
            )
          })}
        </div>
      </Field>

      <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14, marginTop: 4 }}>
        <LocatiesKiezer
          waarde={loc}
          onChange={setLoc}
          toonLeiding={form.roles.includes('supervisor') || form.roles.includes('management')}
        />
      </div>

      <Field label="Notitie">
        <textarea className="textarea" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void save()}>Opslaan</button>
      </div>
    </Modal>
  )
}
