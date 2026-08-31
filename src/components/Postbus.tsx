import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Code2, Eye, EyeOff, Inbox,
  Loader2, Mail, MailOpen, Paperclip, Receipt, Search, Send, ShieldCheck,
  ShieldX, Trash2,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  bijbehorendeBon, controleLabel, filterPost, grootte, magOpenen, onbekeken,
  postbus,
} from '../lib/postbus'
import { MAIL_STATUS, type Expense, type MailBericht, type MailStatus } from '../lib/types'
import { dateTime, money, relative } from '../lib/format'
import { Badge, Card, Empty, Field, Modal, Stat } from './ui'
import { useAuth } from '../store/useAuth'
import { usePerms, useNav } from '../store/useNav'
import Bekijker from './Bekijker'
import type { Bekijkbaar } from '../lib/bekijken'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Postbus
 *
 *  Post die binnenkomt op het adres van het dashboard. Een mail met een
 *  bijlage levert meteen een kostenpost op die bij Financieel klaarstaat om
 *  goedgekeurd te worden -- met de bijlage eraan vast.
 *
 *  Eén ding met opzet: de tekst van een binnengekomen mail wordt nooit als
 *  HTML getoond. Post van buiten is per definitie niet te vertrouwen, en een
 *  mail die zichzelf mag opmaken kan meer dan opmaken.
 * ------------------------------------------------------------------ */

export default function Postbus() {
  const me = useAuth((s) => s.user)!
  const perms = usePerms()
  const goto = useNav((s) => s.goto)

  const [richting, setRichting] = useState<'in' | 'uit'>('in')
  const [status, setStatus] = useState<MailStatus | 'alles'>('alles')
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [opstellen, setOpstellen] = useState(false)

  const alle = useLiveQuery(() => db.mailbox.toArray(), [], [] as MailBericht[])
  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])

  const lijst = useMemo(
    () => filterPost(alle, { richting, status, zoek }),
    [alle, richting, status, zoek],
  )

  const geopend = alle.find((m) => m.id === open) ?? null
  const nieuw = onbekeken(alle)

  if (!perms.can('mail.read')) {
    return <Empty text="Je hebt geen toegang tot de postbus." icon={<Mail size={30} />} />
  }

  if (geopend) {
    return (
      <Bericht
        bericht={geopend}
        bon={bijbehorendeBon(geopend, bonnen)}
        onTerug={() => setOpen(null)}
        onNaarBon={() => goto('financieel')}
        door={me}
      />
    )
  }

  const metBijlage = alle.filter((m) => m.richting === 'in' && m.attachments.length > 0).length
  const bonnenUitMail = bonnen.filter((b) => b.source === 'mail' && b.status === 'open').length

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Nieuw binnengekomen"
          value={nieuw}
          icon={<Inbox size={17} />}
          tone={nieuw ? 'warn' : 'ok'}
        />
        <Stat label="Met bijlage" value={metBijlage} icon={<Paperclip size={17} />} />
        <Stat
          label="Bonnen te valideren"
          value={bonnenUitMail}
          icon={<Receipt size={17} />}
          tone={bonnenUitMail ? 'warn' : undefined}
        />
      </div>

      <Card
        title="Postbus"
        hint="Wat er binnenkomt op het adres van het dashboard"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div className="chat-search" style={{ margin: 0, width: 190 }}>
              <Search size={14} />
              <input
                value={zoek}
                maxLength={64}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Afzender of onderwerp"
              />
            </div>
            {perms.can('mail.send') && (
              <button className="btn primary sm" onClick={() => setOpstellen(true)}>
                <Send size={14} /> Mail opstellen
              </button>
            )}
          </div>
        }
      >
        <div className="live-filters">
          <button
            className={`live-filter ${richting === 'in' ? '' : 'uit'}`}
            onClick={() => setRichting('in')}
          >
            Ontvangen <span>{alle.filter((m) => m.richting === 'in').length}</span>
          </button>
          <button
            className={`live-filter ${richting === 'uit' ? '' : 'uit'}`}
            onClick={() => setRichting('uit')}
          >
            Verstuurd <span>{alle.filter((m) => m.richting === 'uit').length}</span>
          </button>

          <span style={{ flex: 1 }} />

          {(['alles', 'nieuw', 'gelezen', 'verwerkt', 'genegeerd'] as const).map((k) => (
            <button
              key={k}
              className={`live-filter ${status === k ? '' : 'uit'}`}
              onClick={() => setStatus(k)}
            >
              {k === 'alles' ? 'Alles' : MAIL_STATUS[k].label}
            </button>
          ))}
        </div>

        {lijst.length === 0 ? (
          <Empty
            text={alle.length === 0
              ? 'Nog geen post. Zodra er iets binnenkomt op het adres van het dashboard staat het hier.'
              : 'Geen berichten die hierop passen.'}
            icon={<Inbox size={30} />}
          />
        ) : (
          <div className="post-lijst">
            {lijst.map((m) => (
              <button
                key={m.id}
                className={`post-regel ${m.status === 'nieuw' ? 'nieuw' : ''}`}
                onClick={() => { setOpen(m.id); void postbus.markeerGelezen(m.id) }}
              >
                <span className="ico">
                  {m.status === 'nieuw' ? <Mail size={17} /> : <MailOpen size={17} />}
                </span>
                <span className="tekst">
                  <span className="kop">
                    <strong>{m.vanNaam || m.van}</strong>
                    {m.attachments.length > 0 && (
                      <Badge><Paperclip size={11} /> {m.attachments.length}</Badge>
                    )}
                    {m.expenseId && <Badge tone="warn"><Receipt size={11} /> Bon</Badge>}
                    <Badge tone={MAIL_STATUS[m.status].tone as never}>
                      {MAIL_STATUS[m.status].label}
                    </Badge>
                  </span>
                  <span className="onderwerp">{m.onderwerp}</span>
                  <span className="voorbeeld">{m.tekst.slice(0, 120)}</span>
                </span>
                <span className="tijd">{relative(m.at)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Opstellen
        open={opstellen}
        onClose={() => setOpstellen(false)}
        door={me}
      />
    </>
  )
}

/* ================================================================== *
 *  Eén bericht
 * ================================================================== */

function Bericht({
  bericht, bon, onTerug, onNaarBon, door,
}: {
  bericht: MailBericht
  bon?: Expense
  onTerug: () => void
  onNaarBon: () => void
  door: { id: string; name: string }
}) {
  const perms = usePerms()
  const [toonRuw, setToonRuw] = useState(false)
  const [kijkt, setKijkt] = useState<number | null>(null)

  /*
   * Alle bijlagen van dit bericht gaan mee naar de kijker, ook de
   * tegengehouden. Die tonen we niet, maar ze blijven wel staan -- met de
   * reden erbij. Een bijlage die zomaar uit het rijtje verdwijnt is een
   * bijlage waarvan niemand weet dat hij er was.
   */
  const teBekijken: Bekijkbaar[] = bericht.attachments.map((b) => ({
    naam: b.naam,
    mime: b.mime,
    size: b.size,
    geblokkeerd: magOpenen(b)
      ? undefined
      : (b.controleReden || (b.path
          ? 'Deze bijlage kwam niet door de controle.'
          : 'Van deze bijlage staat er niets in de opslag.')),
    haal: () => postbus.openBijlage(b),
  }))

  async function zet(status: MailStatus) {
    await postbus.setStatus(bericht.id, status, door)
    toast.ok(`Gemarkeerd als ${MAIL_STATUS[status].label.toLowerCase()}`)
  }

  return (
    <>
      <button className="btn ghost sm" onClick={onTerug} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar de postbus
      </button>

      <Card>
        <div className="post-kop">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{bericht.onderwerp}</h2>
            <div className="van">
              {bericht.richting === 'in' ? 'Van' : 'Aan'}{' '}
              <strong>{bericht.vanNaam || bericht.van}</strong>
              {bericht.richting === 'in' && bericht.vanNaam && ` <${bericht.van}>`}
              {bericht.richting === 'uit' && ` · ${bericht.aan}`}
              {' · '}{dateTime(bericht.at)}
            </div>
          </div>
          <Badge tone={MAIL_STATUS[bericht.status].tone as never}>
            {MAIL_STATUS[bericht.status].label}
          </Badge>
        </div>

        {bericht.hadHtml && (
          <div className="signup-note" style={{ marginTop: 14 }}>
            <EyeOff size={16} />
            <span>
              Deze mail had ook een opgemaakte versie. Die tonen we niet: post
              van buiten is niet te vertrouwen, en een bericht dat zichzelf
              mag opmaken kan meer dan opmaken. Hieronder staat de tekst.
            </span>
          </div>
        )}

        {/* Bewust als platte tekst. React zet tekst altijd als tekst neer. */}
        <pre className="post-tekst">{bericht.tekst || '(geen tekst)'}</pre>

        {bericht.attachments.length > 0 && (
          <div className="post-bijlagen">
            <div className="kop"><Paperclip size={14} /> Bijlagen</div>
            {bericht.attachments.map((b) => {
              const stempel = controleLabel(b)
              const mag = magOpenen(b)
              return (
                <button
                  key={b.path}
                  className={`bijlage ${mag ? '' : 'geblokkeerd'}`}
                  onClick={() => setKijkt(bericht.attachments.indexOf(b))}
                  title={mag ? 'Bekijken' : b.controleReden}
                >
                  {mag ? <Eye size={15} /> : <ShieldX size={15} />}
                  <span className="n">{b.naam}</span>
                  {stempel
                    ? <Badge tone={stempel.tone as never}>{stempel.label}</Badge>
                    : <Badge tone="ok"><ShieldCheck size={11} /> nagekeken</Badge>}
                  <span className="s">{grootte(b.size)}</span>
                </button>
              )
            })}

            <Bekijker
              bestanden={teBekijken}
              index={kijkt}
              onSluiten={() => setKijkt(null)}
              onWissel={setKijkt}
            />

            {/*
              * Waarom een bijlage er niet is, hoort erbij te staan. Anders
              * zie je een naam waar niets achter zit en weet je niet of het
              * aan de mail lag, aan de controle of aan ons.
              */}
            {bericht.attachments.filter((b) => !b.path && b.controleReden).map((b) => (
              <div className="signup-note" style={{ marginTop: 8 }} key={'r' + b.naam}>
                <AlertTriangle size={16} />
                <span><strong>{b.naam}</strong> — {b.controleReden}</span>
              </div>
            ))}

            {bericht.attachments.some((b) => b.path && !b.controle) && (
              <div className="signup-note" style={{ marginTop: 8 }}>
                <AlertTriangle size={16} />
                <span>
                  Deze bijlage kwam binnen voordat er werd gecontroleerd. Open
                  hem alleen als je de afzender vertrouwt.
                </span>
              </div>
            )}
          </div>
        )}

        {bon && (
          <div className="post-bon">
            <Receipt size={17} />
            <div>
              <strong>Er staat een bon klaar bij Financieel</strong>
              <span>
                {bon.status === 'open'
                  ? `Het bedrag staat nog op ${money(bon.amountExcl)} — dat lezen we niet uit de bijlage, want een gok in de boekhouding is erger dan een leeg veld.`
                  : `Afgehandeld: ${bon.status}.`}
              </span>
            </div>
            <button className="btn sm" onClick={onNaarBon}>Openen</button>
          </div>
        )}

        <div className="row" style={{ gap: 6, marginTop: 16 }}>
          {bericht.status !== 'verwerkt' && (
            <button className="btn ok sm" onClick={() => void zet('verwerkt')}>
              <CheckCircle2 size={14} /> Afgehandeld
            </button>
          )}
          {bericht.status !== 'genegeerd' && (
            <button className="btn sm" onClick={() => void zet('genegeerd')}>
              <Trash2 size={14} /> Negeren
            </button>
          )}
          {bericht.status !== 'nieuw' && (
            <button className="btn ghost sm" onClick={() => void zet('nieuw')}>
              Terug op nieuw
            </button>
          )}

          <span style={{ flex: 1 }} />

          {perms.can('dev.logs') && bericht.raw && (
            <button className="btn ghost sm" onClick={() => setToonRuw((v) => !v)}>
              <Code2 size={14} /> {toonRuw ? 'Verberg' : 'Ruwe inhoud'}
            </button>
          )}
        </div>

        {toonRuw && bericht.raw && (
          <>
            <div className="waarschuwing" style={{ marginTop: 14 }}>
              <AlertTriangle size={17} />
              <span>
                Dit is wat er binnenkwam, ingekort. Handig als een bericht niet
                goed is herkend — dan zie je hier waarom.
              </span>
            </div>
            <pre className="post-ruw">{bericht.raw}</pre>
          </>
        )}
      </Card>
    </>
  )
}

/* ================================================================== *
 *  Zelf een mail opstellen
 * ================================================================== */

function Opstellen({
  open, onClose, door,
}: {
  open: boolean
  onClose: () => void
  door: { id: string; name: string }
}) {
  const [aan, setAan] = useState('')
  const [onderwerp, setOnderwerp] = useState('')
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)

  const adresOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(aan.trim())

  async function versturen() {
    if (!adresOk) return toast.error('Vul een geldig e-mailadres in')
    if (onderwerp.trim().length < 3) return toast.error('Geef de mail een onderwerp')
    if (tekst.trim().length < 5) return toast.error('Schrijf een bericht')

    setBezig(true)
    try {
      await postbus.verstuur({ aan, onderwerp, tekst, door })
      toast.ok(`Verstuurd naar ${aan.trim()}`)
      setAan(''); setOnderwerp(''); setTekst('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Versturen lukte niet')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Mail opstellen"
      subtitle="Gaat uit namens het dashboard, met jouw naam eronder"
      onClose={onClose}
      width={600}
    >
      <Field
        label="Aan"
        help={aan && !adresOk ? 'Dit ziet er niet uit als een e-mailadres.' : undefined}
      >
        <input
          className={`input ${aan && !adresOk ? 'fout' : ''}`}
          type="email"
          value={aan}
          onChange={(e) => setAan(e.target.value)}
          placeholder="naam@bedrijf.nl"
          autoFocus
        />
      </Field>

      <Field label="Onderwerp">
        <input
          className="input" value={onderwerp} maxLength={160}
          onChange={(e) => setOnderwerp(e.target.value)}
        />
      </Field>

      <Field label="Bericht" help="Een lege regel begint een nieuwe alinea.">
        <textarea
          className="textarea" style={{ minHeight: 180 }}
          value={tekst} maxLength={6000}
          onChange={(e) => setTekst(e.target.value)}
        />
      </Field>

      <div className="aanmelding-let-op">
        <Send size={16} />
        <span>
          Dit is de enige plek waar de app een adres meegeeft in plaats van
          een dossier-id. Daarom staat er een rem op — hooguit zes mails per
          uur naar hetzelfde adres — en komt elke verzending in het logboek
          te staan met jouw naam erbij.
        </span>
      </div>

      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={bezig}>Annuleren</button>
        <button className="btn primary" onClick={() => void versturen()} disabled={bezig}>
          {bezig ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          Versturen
        </button>
      </div>
    </Modal>
  )
}
