import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Loader2, Mail, MessageSquare, Phone, Plus, Send, Trash2, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { trucky } from '../../lib/trucky'
import { relative } from '../../lib/format'
import type { Instelling, TruckyContact, TruckyVraag } from '../../lib/types'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Trucky
 *
 *  Twee dingen die bij elkaar horen: wat de chatbot op de website zelf
 *  beantwoordt, en wat er binnenkomt als hij dat niet kon.
 *
 *  De vragenlijst is geen bijzaak. Wat hier staat wordt woordelijk aan
 *  bezoekers gegeven, zonder dat er een model aan te pas komt -- goedkoper,
 *  en er staat altijd hetzelfde. Wat hier NIET staat gaat naar het model, en
 *  dat kost geld en formuleert elke keer net anders.
 * ------------------------------------------------------------------ */

export default function Trucky() {
  const [tab, setTab] = useState<'contact' | 'vragen'>('contact')

  const contact = useLiveQuery(
    () => db.truckyContact.orderBy('createdAt').reverse().toArray(), [],
    [] as TruckyContact[])
  const vragen = useLiveQuery(
    () => db.truckyVragen.toArray(), [], [] as TruckyVraag[])

  const nieuw = contact.filter((c) => c.status === 'nieuw').length
  const beantwoord = contact.filter((c) => c.status === 'beantwoord').length
  const uitLijst = vragen.reduce((n, v) => n + (v.gebruikt || 0), 0)

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat
          label="Nieuwe vragen"
          value={nieuw}
          icon={<MessageSquare size={17} />}
          tone={nieuw ? 'warn' : undefined}
        />
        <Stat label="Beantwoord" value={beantwoord} icon={<Check size={17} />} tone="ok" />
        <Stat
          label="Zelf beantwoord"
          value={uitLijst}
          icon={<Send size={17} />}
        />
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <button
          className={`btn sm ${tab === 'contact' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('contact')}
        >
          <Mail size={14} /> Binnengekomen
          {nieuw > 0 && <span className="vest-stip" />}
        </button>
        <button
          className={`btn sm ${tab === 'vragen' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('vragen')}
        >
          <MessageSquare size={14} /> Vragen en antwoorden
        </button>
      </div>

      {tab === 'contact' ? <Binnengekomen rijen={contact} /> : <Vragenlijst rijen={vragen} />}
    </>
  )
}

/* ================================================================== *
 *  Wat er binnenkomt
 * ================================================================== */

function Binnengekomen({ rijen }: { rijen: TruckyContact[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const gekozen = rijen.find((r) => r.id === open) ?? null

  if (!rijen.length) {
    return (
      <Card>
        <Empty
          text="Nog geen vragen binnengekomen via de website."
          icon={<Mail size={22} />}
        />
      </Card>
    )
  }

  return (
    <>
      <Card title="Vragen via de website" hint="Klik om te beantwoorden" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Van</th><th>Vraag</th><th>Binnen</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(r.id)}>
                  <td>
                    <strong>{r.naam}</strong>
                    <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>
                      {r.bedrijf ? `${r.bedrijf} · ` : ''}{r.email}
                    </div>
                  </td>
                  <td style={{ maxWidth: 380 }}>
                    <div className="afgekapt">{r.vraag}</div>
                  </td>
                  <td>{relative(r.createdAt)}</td>
                  <td>
                    <Badge tone={
                      r.status === 'nieuw' ? 'warn'
                        : r.status === 'beantwoord' ? 'ok' : 'default'
                    }>
                      {r.status === 'nieuw' ? 'Nieuw'
                        : r.status === 'opgepakt' ? 'Opgepakt' : 'Beantwoord'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Beantwoorden rij={gekozen} onClose={() => setOpen(null)} />
    </>
  )
}

function Beantwoorden({ rij, onClose }: { rij: TruckyContact | null; onClose: () => void }) {
  const me = useAuth((s) => s.user)!
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)

  async function versturen() {
    if (!rij || !tekst.trim() || bezig) return
    setBezig(true)
    try {
      await trucky.beantwoord(rij, tekst.trim(), me)
      toast.ok(`Antwoord verstuurd naar ${rij.email}`)
      setTekst('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Versturen mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={!!rij}
      title={rij?.naam ?? ''}
      subtitle={rij ? `${rij.email}${rij.telefoon ? ` · ${rij.telefoon}` : ''}` : ''}
      onClose={onClose}
      width={720}
    >
      {rij && (
        <>
          <Field label="De vraag">
            <div className="trucky-blok">{rij.vraag}</div>
          </Field>

          {rij.verloop && (
            <Field
              label="Wat eraan voorafging in de chat"
              help="Zonder dit is een vraag als “ja graag, om 9 uur” niet te plaatsen."
            >
              <div className="trucky-blok trucky-verloop">{rij.verloop}</div>
            </Field>
          )}

          <div className="row" style={{ gap: 14, marginBottom: 12 }}>
            {rij.telefoon && (
              <a className="btn ghost sm" href={`tel:${rij.telefoon.replace(/\s/g, '')}`}>
                <Phone size={14} /> Bellen
              </a>
            )}
            <a className="btn ghost sm" href={`mailto:${rij.email}`}>
              <Mail size={14} /> Zelf mailen
            </a>
          </div>

          {rij.status === 'beantwoord' ? (
            <Field
              label="Verstuurd antwoord"
              help={rij.behandeldDoorNaam
                ? `Door ${rij.behandeldDoorNaam}, ${relative(rij.behandeldAt ?? rij.updatedAt)}`
                : undefined}
            >
              <div className="trucky-blok">{rij.antwoord}</div>
            </Field>
          ) : (
            <>
              <Field
                label="Je antwoord"
                help="Gaat als mail naar deze persoon, en blijft hier staan."
              >
                <textarea
                  rows={6}
                  value={tekst}
                  placeholder={`Hoi ${rij.naam.split(' ')[0]},\n\n`}
                  onChange={(e) => setTekst(e.target.value)}
                />
              </Field>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="spacer" />
                <button
                  className="btn primary"
                  disabled={!tekst.trim() || bezig}
                  onClick={versturen}
                >
                  {bezig ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  Antwoord versturen
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

/* ================================================================== *
 *  De vragenlijst
 * ================================================================== */

function Vragenlijst({ rijen }: { rijen: TruckyVraag[] }) {
  const perms = usePerms()
  const mag = perms.can('admin.settings')
  const [open, setOpen] = useState<TruckyVraag | null>(null)
  const [nieuw, setNieuw] = useState(false)

  const gesorteerd = useMemo(
    () => [...rijen].sort((a, b) =>
      Number(b.actief) - Number(a.actief) || (b.gebruikt || 0) - (a.gebruikt || 0)),
    [rijen],
  )

  return (
    <>
      <Card
        title="Wat Trucky zelf beantwoordt"
        hint="Staat het antwoord hier, dan komt er geen model aan te pas"
        flush
        action={mag ? (
          <button className="btn primary sm" onClick={() => setNieuw(true)}>
            <Plus size={14} /> Vraag toevoegen
          </button>
        ) : undefined}
      >
        {!gesorteerd.length ? (
          <Empty text="Nog geen vragen ingesteld." icon={<MessageSquare size={22} />} />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Vraag</th><th>Antwoord</th><th className="num">Gebruikt</th><th></th></tr>
              </thead>
              <tbody>
                {gesorteerd.map((v) => (
                  <tr
                    key={v.id}
                    style={{ opacity: v.actief ? 1 : .5, cursor: mag ? 'pointer' : 'default' }}
                    onClick={() => mag && setOpen(v)}
                  >
                    <td>
                      <strong>{v.vraag}</strong>
                      {!!v.trefwoorden?.length && (
                        <div style={{ fontSize: '.7rem', color: 'var(--text-3)' }}>
                          ook: {v.trefwoorden.slice(0, 4).join(', ')}
                          {v.trefwoorden.length > 4 ? '…' : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ maxWidth: 360 }}>
                      <div className="afgekapt">{v.antwoord}</div>
                    </td>
                    <td className="num">{v.gebruikt || 0}</td>
                    <td>{!v.actief && <Badge tone="warn">Uit</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <VraagBewerken
        vraag={open}
        open={!!open || nieuw}
        onClose={() => { setOpen(null); setNieuw(false) }}
      />
    </>
  )
}

function VraagBewerken({
  vraag, open, onClose,
}: { vraag: TruckyVraag | null; open: boolean; onClose: () => void }) {
  const leeg: TruckyVraag = {
    id: '', vraag: '', antwoord: '', trefwoorden: [], actief: true,
    gebruikt: 0, updatedAt: 0,
  }
  const [vorm, setVorm] = useState<TruckyVraag>(vraag ?? leeg)
  const [ruw, setRuw] = useState((vraag?.trefwoorden ?? []).join(', '))
  const [bezig, setBezig] = useState(false)

  /* Bij het openen van een andere rij het formulier opnieuw vullen. */
  const sleutel = vraag?.id ?? 'nieuw'
  const [laatste, setLaatste] = useState(sleutel)
  if (laatste !== sleutel) {
    setLaatste(sleutel)
    setVorm(vraag ?? leeg)
    setRuw((vraag?.trefwoorden ?? []).join(', '))
  }

  async function opslaan() {
    if (!vorm.vraag.trim() || !vorm.antwoord.trim() || bezig) return
    setBezig(true)
    try {
      await trucky.bewaar({ ...vorm, trefwoorden: trefwoordenUit(ruw) })
      toast.ok('Opgeslagen.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title={vraag ? 'Vraag wijzigen' : 'Vraag toevoegen'}
      subtitle="Dit antwoord gaat woordelijk naar bezoekers van de website"
      onClose={onClose}
      width={640}
    >
      <Field label="De vraag" help="Zoals een bezoeker hem zou stellen.">
        <input
          value={vorm.vraag}
          placeholder="Moet ik een afspraak maken?"
          onChange={(e) => setVorm((h) => ({ ...h, vraag: e.target.value }))}
        />
      </Field>

      <Field
        label="Het antwoord"
        help="Kort en compleet. Dit is wat het bedrijf zegt, niet wat een model ervan maakt."
      >
        <textarea
          rows={4}
          value={vorm.antwoord}
          onChange={(e) => setVorm((h) => ({ ...h, antwoord: e.target.value }))}
        />
      </Field>

      <Field
        label="Andere manieren waarop mensen het vragen"
        help="Gescheiden door komma's. Hiermee wordt de vraag ook gevonden als iemand het anders formuleert."
      >
        <input
          value={ruw}
          placeholder="afspraak, reserveren, moet ik bellen"
          onChange={(e) => setRuw(e.target.value)}
        />
      </Field>

      <Field
        label="Pagina om naar door te verwijzen"
        help="Mag leeg. Wordt een knop onder het antwoord, bijvoorbeeld /locaties/."
      >
        <input
          value={vorm.pagina ?? ''}
          placeholder="/locaties/"
          onChange={(e) => setVorm((h) => ({ ...h, pagina: e.target.value || undefined }))}
        />
      </Field>

      <label className="row" style={{ gap: 8, marginTop: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={vorm.actief}
          onChange={(e) => setVorm((h) => ({ ...h, actief: e.target.checked }))}
        />
        <span>Actief — Trucky mag dit antwoord geven</span>
      </label>

      <div className="row" style={{ marginTop: 16 }}>
        {vraag && (
          <button
            className="btn ghost sm danger"
            onClick={async () => {
              await trucky.weg(vraag.id)
              toast.ok('Verwijderd.')
              onClose()
            }}
          >
            <Trash2 size={14} /> Verwijderen
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}><X size={14} /> Annuleren</button>
        <button
          className="btn primary"
          disabled={!vorm.vraag.trim() || !vorm.antwoord.trim() || bezig}
          onClick={opslaan}
        >
          {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Opslaan
        </button>
      </div>
    </Modal>
  )
}

/** "afspraak, reserveren ,, bellen" wordt drie trefwoorden, zonder lege. */
function trefwoordenUit(ruw: string): string[] {
  return ruw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
}

/* ================================================================== *
 *  De instelling
 * ================================================================== */

/**
 * Naar welk adres een contactverzoek gaat.
 *
 * Staat apart omdat dit management is en de rest van dit scherm ook voor
 * administratie open staat: wie de vragen behandelt hoeft niet te bepalen waar
 * ze heen gaan.
 */
export function ContactAdres() {
  const rijen = useLiveQuery(() => db.instellingen.toArray(), [], [] as Instelling[])
  const huidig = rijen.find((r) => r.sleutel === 'contact_mail')
  const [waarde, setWaarde] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  const getoond = waarde ?? huidig?.waarde ?? ''
  const veranderd = huidig ? getoond !== huidig.waarde : false

  async function opslaan() {
    setBezig(true)
    try {
      await trucky.zetInstelling('contact_mail', getoond)
      toast.ok('Opgeslagen.')
      setWaarde(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card title="Vragen via de website" hint="Waar een contactverzoek naartoe gaat">
      <Field
        label="E-mailadres"
        help={huidig?.omschrijving ??
          'Meerdere adressen mag, gescheiden door een komma. De vraag komt sowieso in het dashboard te staan; deze mail is de tik op de schouder.'}
      >
        <input
          value={getoond}
          placeholder="casper@truckwash1group.nl"
          onChange={(e) => setWaarde(e.target.value)}
        />
      </Field>
      <AnimatePresence>
        {veranderd && (
          <motion.div
            className="row"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span className="spacer" />
            <button className="btn primary sm" disabled={bezig} onClick={opslaan}>
              {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Opslaan
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}
