import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Megaphone, Send, Users } from 'lucide-react'
import { db } from '../lib/db'
import { notifications as notifyRepo } from '../lib/repo'
import { ROLE_LABELS, type NotificationKind, type Role, type User } from '../lib/types'
import { initials } from '../lib/format'
import { Badge, Field, Modal } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

const KINDS: { key: NotificationKind; label: string }[] = [
  { key: 'info', label: 'Mededeling' },
  { key: 'taak', label: 'Taak' },
  { key: 'waarschuwing', label: 'Waarschuwing' },
  { key: 'rooster', label: 'Rooster' },
  { key: 'opleiding', label: 'Opleiding' },
]

const MAX_TITLE = 80
const MAX_BODY = 400

/**
 * Bericht sturen naar losse medewerkers of naar een hele rol.
 * Zonder het recht notify.send is dit venster niet te openen.
 */
export default function BerichtVersturen({
  open,
  onClose,
  team,
  preset,
}: {
  open: boolean
  onClose: () => void
  /** Beperk de ontvangers, bijvoorbeeld tot het eigen team */
  team?: User[]
  preset?: { title?: string; body?: string; kind?: NotificationKind }
}) {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()

  const allUsers = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const kandidaten = (team ?? allUsers).filter((u) => u.active && u.id !== me.id)

  const [mode, setMode] = useState<'personen' | 'groep'>('personen')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [role, setRole] = useState<Role>('employee')
  const [kind, setKind] = useState<NotificationKind>(preset?.kind ?? 'info')
  const [title, setTitle] = useState(preset?.title ?? '')
  const [body, setBody] = useState(preset?.body ?? '')
  const [sending, setSending] = useState(false)

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function send() {
    if (!title.trim()) return toast.error('Geef het bericht een onderwerp')
    if (!body.trim()) return toast.error('Schrijf een bericht')

    setSending(true)
    try {
      if (mode === 'groep') {
        if (!perms.can('notify.broadcast')) {
          return toast.error('Je mag geen groepsbericht sturen')
        }
        await notifyRepo.broadcast({
          role, from: { id: me.id, name: me.name }, kind,
          title: title.slice(0, MAX_TITLE), body: body.slice(0, MAX_BODY),
        })
        toast.ok(`Bericht verstuurd naar alle ${ROLE_LABELS[role].toLowerCase()}s`)
      } else {
        if (selected.size === 0) return toast.error('Kies minstens één ontvanger')
        for (const id of selected) {
          const person = kandidaten.find((u) => u.id === id)
          if (!person) continue
          await notifyRepo.send({
            to: { id: person.id, name: person.name },
            from: { id: me.id, name: me.name },
            kind,
            title: title.slice(0, MAX_TITLE),
            body: body.slice(0, MAX_BODY),
          })
        }
        toast.ok(`Bericht verstuurd naar ${selected.size} ${selected.size === 1 ? 'persoon' : 'personen'}`)
      }

      setTitle('')
      setBody('')
      setSelected(new Set())
      onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} title="Bericht sturen" onClose={onClose} width={580}>
      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button
          className={`btn sm ${mode === 'personen' ? 'primary' : ''}`}
          onClick={() => setMode('personen')}
        >
          <Users size={14} /> Losse personen
        </button>
        {perms.can('notify.broadcast') && (
          <button
            className={`btn sm ${mode === 'groep' ? 'primary' : ''}`}
            onClick={() => setMode('groep')}
          >
            <Megaphone size={14} /> Hele groep
          </button>
        )}
      </div>

      {mode === 'personen' ? (
        <Field label={`Ontvangers${selected.size ? ` (${selected.size})` : ''}`}>
          <div className="recipient-list">
            {kandidaten.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: '.84rem', padding: 8 }}>
                Geen medewerkers om aan te schrijven.
              </div>
            )}
            {kandidaten.map((u) => {
              const on = selected.has(u.id)
              return (
                <button
                  key={u.id}
                  className={`recipient ${on ? 'on' : ''}`}
                  onClick={() => toggle(u.id)}
                  type="button"
                >
                  <span className="av">{initials(u.name)}</span>
                  <span className="who">
                    <span className="n">{u.name}</span>
                    <span className="f">{u.function ?? u.email}</span>
                  </span>
                  {on && <Badge tone="brand">Gekozen</Badge>}
                </button>
              )
            })}
          </div>
        </Field>
      ) : (
        <Field label="Naar welke groep" help="Iedereen met deze rol krijgt het bericht.">
          <div className="row" style={{ gap: 6 }}>
            {(['employee', 'supervisor', 'management'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`btn sm ${role === r ? 'primary' : ''}`}
                onClick={() => setRole(r)}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Soort">
        <div className="row" style={{ gap: 6 }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={`btn sm ${kind === k.key ? 'primary' : ''}`}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Onderwerp" help={`${title.length}/${MAX_TITLE}`}>
        <input
          className="input"
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bijv. Rooster volgende week staat klaar"
        />
      </Field>

      <Field label="Bericht" help={`${body.length}/${MAX_BODY}`}>
        <textarea
          className="textarea"
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Wat moeten ze weten?"
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void send()} disabled={sending}>
          <Send size={15} /> Versturen
        </button>
      </div>
    </Modal>
  )
}
