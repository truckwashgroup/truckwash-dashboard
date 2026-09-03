import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Check, CheckCheck, Clock, Euro, Loader2, Mail, Paperclip,
  History, Receipt, RotateCcw, ScanText, Sparkles, Wallet, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { expenses as expRepo } from '../../lib/repo'
import type {
  Expense, FactuurLezing, Grootboek, KostenTag, MailBericht,
} from '../../lib/types'
import {
  bedragExcl, btwPercentage, heeftIetsTeLezen, leesFactuur, regelsKloppen,
  voorstellen, type Voorstel,
} from '../../lib/facturen'
import { dateShort, money } from '../../lib/format'
import {
  BRON_TEKST, onthoudBoeking, rekeningNaam, vraagtAandacht, zetBoeking,
} from '../../lib/boeking'
import { historieVan } from '../../lib/factuurhistorie'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { magOpenen, postbus } from '../../lib/postbus'
import Bekijker from '../../components/Bekijker'
import type { Bekijkbaar } from '../../lib/bekijken'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Kostenposten
 *
 *  Stond bij Financieel, tussen de omzetgrafieken. Dat was de verkeerde
 *  plek: cijfers bekijk je, bonnen beoordeel je, en dat is ander werk met
 *  een ander ritme. Hier staat alleen het beoordelen.
 *
 *  Wat erbij is gekomen: de factuur wordt voorgelezen. Uit de PDF of de foto
 *  komen de leverancier, het factuurnummer, de regels en de bedragen, en die
 *  worden naast de bon gelegd.
 *
 *  Het belangrijkste aan dat lezen is wat het níét doet. Er wordt niets
 *  overgenomen. Wat eruit komt staat in een eigen veld, met erbij waar het
 *  model over twijfelde, en pas als jij op overnemen drukt verandert er iets
 *  aan de kostenpost. Een bedrag dat half is geraden is gevaarlijker dan een
 *  leeg veld: dat laatste vul je in, het eerste keur je goed.
 * ------------------------------------------------------------------ */

type Tab = 'open' | 'goedgekeurd' | 'afgekeurd' | 'alles'

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Te valideren' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'afgekeurd', label: 'Afgekeurd' },
  { key: 'alles', label: 'Alles' },
]

export default function Kostenposten() {
  const user = useAuth((s) => s.user)!
  const perms = usePerms()
  const [tab, setTab] = useState<Tab>('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [afkeuren, setAfkeuren] = useState<Expense | null>(null)
  const [reden, setReden] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const alle = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])

  const rijen = useMemo(
    () => alle
      .filter((e) => (tab === 'alles' ? true : e.status === tab))
      .sort((a, b) => b.date - a.date),
    [alle, tab],
  )

  const teValideren = alle.filter((e) => e.status === 'open')
  const openBedrag = teValideren.reduce((a, e) => a + e.amountExcl, 0)
  const zonderBedrag = teValideren.filter((e) => e.amountExcl === 0).length
  const gekozen = alle.find((e) => e.id === open) ?? null

  function wissel(id: string) {
    const volgende = new Set(selected)
    if (volgende.has(id)) volgende.delete(id)
    else volgende.add(id)
    setSelected(volgende)
  }

  async function keurGoed(ids: string[]) {
    for (const id of ids) {
      await expRepo.decide(id, 'goedgekeurd', { id: user.id, name: user.name })

      /*
       * En onthouden hoe deze leverancier geboekt is.
       *
       * Dit is het moment waarop het raden ophoudt: iemand heeft ernaar
       * gekeken en gezegd dat het klopt. De volgende factuur van dezelfde
       * partij staat daarmee meteen goed.
       *
       * Achter de goedkeuring langs, en zonder erop te wachten: het bijwerken
       * van het geheugen mag het goedkeuren niet ophouden en al helemaal niet
       * laten mislukken.
       */
      const bon = alle.find((r) => r.id === id)
      if (bon) void onthoudBoeking(bon)
    }
    setSelected(new Set())
    toast.ok(ids.length === 1 ? 'Kostenpost goedgekeurd' : `${ids.length} kostenposten goedgekeurd`)
  }

  async function keurAf() {
    if (!afkeuren) return
    await expRepo.decide(
      afkeuren.id, 'afgekeurd', { id: user.id, name: user.name },
      reden.trim() || 'Geen reden opgegeven')
    toast.warn('Kostenpost afgekeurd')
    setAfkeuren(null)
    setReden('')
  }

  const gekozenRijen = rijen.filter((r) => selected.has(r.id))

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat
          label="Te valideren"
          value={teValideren.length}
          delta={{ text: money(openBedrag), dir: 'flat' }}
          icon={<Clock size={17} />}
          tone={teValideren.length ? 'warn' : 'ok'}
        />
        <Stat
          label="Bedrag nog leeg"
          value={zonderBedrag}
          icon={<Euro size={17} />}
          tone={zonderBedrag ? 'warn' : undefined}
        />
        <Stat
          label="Al voorgelezen"
          value={alle.filter((e) => e.gelezen).length}
          icon={<ScanText size={17} />}
        />
      </div>

      <Card
        title="Kostenposten"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            {gekozenRijen.length > 0 && (
              <button
                className="btn ok sm"
                onClick={() => void keurGoed(gekozenRijen.map((r) => r.id))}
              >
                <CheckCheck size={14} /> {gekozenRijen.length} goedkeuren
              </button>
            )}
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`btn sm ${tab === t.key ? 'primary' : 'ghost'}`}
                onClick={() => { setTab(t.key); setSelected(new Set()) }}
              >
                {t.label}
                {t.key === 'open' && teValideren.length > 0 && ` (${teValideren.length})`}
              </button>
            ))}
          </div>
        }
      >
        {rijen.length === 0 ? (
          <Empty text="Niets in deze lijst." icon={<Receipt size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  {tab === 'open' && (
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === rijen.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(rijen.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                  )}
                  <th>Datum</th>
                  <th>Leverancier</th>
                  <th>Omschrijving</th>
                  <th>Ingediend door</th>
                  <th className="num">Excl.</th>
                  <th className="num">Btw</th>
                  <th className="num">Incl.</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rijen.map((e) => {
                  const btw = (e.amountExcl * e.vatPct) / 100
                  return (
                    <tr key={e.id}>
                      {tab === 'open' && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => wissel(e.id)}
                          />
                        </td>
                      )}
                      <td>{dateShort(e.date)}</td>
                      <td><strong>{e.supplier || <span className="hint">onbekend</span>}</strong></td>
                      <td>
                        <button className="kosten-open" onClick={() => setOpen(e.id)}>
                          {e.description || 'Zonder omschrijving'}
                        </button>
                        <div className="kosten-categorie">{e.category}</div>
                        {e.source === 'mail' && (
                          <div className="bon-uit-mail">
                            <Mail size={12} /> Per mail binnengekomen
                            {e.amountExcl === 0 && ' — bedrag nog invullen'}
                          </div>
                        )}
                        {e.gelezen && (
                          <div className="kosten-gelezen">
                            <ScanText size={12} /> Voorgelezen
                            {(e.gelezen.twijfel?.length ?? 0) > 0
                              && ` · ${e.gelezen.twijfel!.length} punt${e.gelezen.twijfel!.length === 1 ? '' : 'en'} van twijfel`}
                          </div>
                        )}
                        <Bijlage bon={e} />
                        {e.rejectReason && (
                          <div className="kosten-reden">Reden: {e.rejectReason}</div>
                        )}
                      </td>
                      <td>{e.submittedByName}</td>
                      <td className="num">{money(e.amountExcl)}</td>
                      <td className="num" style={{ color: 'var(--text-3)' }}>{money(btw)}</td>
                      <td className="num">{money(e.amountExcl + btw)}</td>
                      <td>
                        {e.status === 'open' && <Badge tone="warn">Open</Badge>}
                        {e.status === 'goedgekeurd' && (
                          <Badge tone="ok"><Check size={11} /> {e.approvedByName ?? 'Akkoord'}</Badge>
                        )}
                        {e.status === 'afgekeurd' && (
                          <Badge tone="danger"><X size={11} /> Afgekeurd</Badge>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {e.status === 'open' ? (
                          <>
                            <button
                              className="btn ok sm"
                              onClick={() => void keurGoed([e.id])}
                              title="Goedkeuren"
                            >
                              <Check size={14} />
                            </button>{' '}
                            <button
                              className="btn danger sm"
                              onClick={() => { setAfkeuren(e); setReden('') }}
                              title="Afkeuren"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn ghost sm"
                            onClick={() => void expRepo.reopen(e.id).then(() => toast.info('Terug naar te valideren'))}
                            title="Heropenen"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BonDetail
        bon={gekozen}
        magLezen={perms.can('expenses.read')}
        onClose={() => setOpen(null)}
      />

      <Modal
        open={!!afkeuren}
        title="Kostenpost afkeuren"
        subtitle={afkeuren ? `${afkeuren.supplier} — ${money(afkeuren.amountExcl)}` : undefined}
        onClose={() => setAfkeuren(null)}
      >
        <Field label="Reden" help="De indiener ziet deze reden bij zijn kostenpost.">
          <textarea
            className="textarea"
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="Bijv. bon ontbreekt, of privé-uitgave"
            autoFocus
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setAfkeuren(null)}>Annuleren</button>
          <button className="btn danger" onClick={() => void keurAf()}>Afkeuren</button>
        </div>
      </Modal>
    </>
  )
}

/* ================================================================== *
 *  De bon van dichtbij, met wat eruit gelezen is
 * ================================================================== */

function BonDetail({
  bon, magLezen, onClose,
}: {
  bon: Expense | null
  magLezen: boolean
  onClose: () => void
}) {
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  async function lees() {
    if (!bon || bezig) return
    setBezig(true)
    setFout(null)
    const uit = await leesFactuur(bon.id)
    setBezig(false)
    if (!uit.ok) return setFout(uit.reden ?? 'Het lezen lukte niet.')
    toast.ok('De factuur is voorgelezen.')
    if (uit.bewaard === false) {
      toast.warn('Het lezen lukte, maar bewaren niet. Probeer het zo nog eens.')
    }
  }

  return (
    <Modal
      open={!!bon}
      title={bon?.supplier || 'Kostenpost'}
      subtitle={bon ? `${dateShort(bon.date)} · ${money(bon.amountExcl)} excl. btw` : undefined}
      onClose={onClose}
      width={760}
    >
      {bon && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <Bijlage bon={bon} />
            <span className="spacer" />
            {magLezen && heeftIetsTeLezen(bon) && (
              <button className="btn primary sm" disabled={bezig} onClick={() => void lees()}>
                {bezig
                  ? <><Loader2 size={14} className="spin" /> Aan het lezen…</>
                  : <><ScanText size={14} /> {bon.gelezen ? 'Opnieuw lezen' : 'Laat de factuur lezen'}</>}
              </button>
            )}
          </div>

          {!heeftIetsTeLezen(bon) && (
            <p className="hint">
              Bij deze kostenpost zit geen bijlage, dus er valt niets voor te lezen.
            </p>
          )}

          {fout && <p className="waarschuwing">{fout}</p>}

          <Boeking bon={bon} />
          <Historie bon={bon} />

          <AnimatePresence mode="wait">
            {bon.gelezen && (
              <motion.div
                key={bon.gelezen.gelezenOp}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: .22 }}
              >
                <Lezing bon={bon} lezing={bon.gelezen} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Modal>
  )
}

/* -------------------------- De historie --------------------------- */

/**
 * Wat deze leverancier eerder stuurde.
 *
 * Een bon los beoordelen is lastiger dan het lijkt: is €1.240 voor Enexis
 * veel? Dat weet je pas als je ziet dat het de vorige vier keer rond de €400
 * was. Dan is dit geen bedrag maar een vraag.
 */
function Historie({ bon }: { bon: Expense }) {
  const alle = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const rekeningen = useLiveQuery(
    () => db.grootboek.toArray(), [], [] as Grootboek[])

  const h = useMemo(() => historieVan(bon, alle), [bon, alle])

  if (!h.eerder.length) return null

  return (
    <Card
      title="Eerder van deze leverancier"
      hint={h.gebruikelijk
        ? `Meestal rond ${money(h.gebruikelijk)} excl. btw`
        : 'Zodat je ziet of dit bedrag in de lijn ligt'}
      className="mb"
    >
      {h.dubbel && (
        <p className="waarschuwing">
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          Factuurnummer <strong>{bon.factuurnummer}</strong> staat er al, van{' '}
          {dateShort(h.dubbel.date)} ({money(h.dubbel.amountExcl)}). Waarschijnlijk
          is dit dezelfde rekening die nog een keer is gestuurd.
        </p>
      )}

      {h.opmerking && !h.dubbel && (
        <p className="hint">
          <History size={14} style={{ verticalAlign: -2 }} /> {h.opmerking}
        </p>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Omschrijving</th>
              <th>Rekening</th>
              <th className="num">Excl. btw</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {h.eerder.map((e) => (
              <tr key={e.id}>
                <td>{dateShort(e.date)}</td>
                <td className="afgekapt">{e.description || '—'}</td>
                <td className="afgekapt">{rekeningNaam(e.grootboekCode, rekeningen) || '—'}</td>
                <td className="num">{e.amountExcl > 0 ? money(e.amountExcl) : '—'}</td>
                <td>
                  {e.status === 'goedgekeurd' && <Badge tone="ok">akkoord</Badge>}
                  {e.status === 'afgekeurd' && <Badge tone="danger">afgekeurd</Badge>}
                  {e.status === 'open' && <Badge>open</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* --------------------------- De boeking --------------------------- */

/**
 * Waar deze bon op geboekt staat, en de mogelijkheid dat te corrigeren.
 *
 * Staat boven de lezing en niet erin, want dit is iets anders. De lezing is
 * wat er op het papier staat; dit is waar het in de boekhouding terechtkomt.
 * Dat tweede is de vraag die de accountant stelt.
 */
function Boeking({ bon }: { bon: Expense }) {
  const rekeningen = useLiveQuery(
    () => db.grootboek.toArray(), [], [] as Grootboek[])
  const tags = useLiveQuery(() => db.kostenTags.toArray(), [], [] as KostenTag[])

  const [bezig, setBezig] = useState(false)

  const bruikbaar = useMemo(
    () => rekeningen
      /*
       * Uitgezette rekeningen zijn niet te kiezen, maar de rekening die er nu
       * op staat wél -- ook als hij uit is. Anders springt een oude boeking
       * bij het openen naar leeg, en dan verander je hem per ongeluk door
       * alleen te kijken.
       */
      .filter((g) => g.actief || g.code === bon.grootboekCode)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [rekeningen, bon.grootboekCode])

  const beschikbaar = useMemo(
    () => [...new Set([...tags.map((t) => t.naam), ...(bon.tags ?? [])])].sort(),
    [tags, bon.tags])

  async function kiesRekening(code: string) {
    setBezig(true)
    try {
      await zetBoeking(bon, { grootboekCode: code || undefined })
    } finally {
      setBezig(false)
    }
  }

  async function wisselTag(naam: string) {
    const huidig = bon.tags ?? []
    const nieuw = huidig.includes(naam)
      ? huidig.filter((t) => t !== naam)
      : [...huidig, naam]
    setBezig(true)
    try {
      await zetBoeking(bon, { tags: nieuw })
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card title="Boeking" hint="Waar deze kosten terechtkomen" className="mb">
      {vraagtAandacht(bon) && (
        <p className="waarschuwing">
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          {bon.grootboekCode
            ? 'Deze rekening is geraden op trefwoorden omdat deze leverancier nog '
              + 'niet bekend was. Klopt hij, dan onthoudt het systeem hem zodra je '
              + 'goedkeurt.'
            : 'Deze bon is nog niet ingedeeld. Kies een rekening; die wordt dan '
              + 'onthouden voor de volgende factuur van deze leverancier.'}
        </p>
      )}

      <div className="grid cols-2 mb">
        <Field
          label="Grootboekrekening"
          help={bon.indelingBron ? BRON_TEKST[bon.indelingBron] : undefined}
        >
          <select
            className="select"
            value={bon.grootboekCode ?? ''}
            disabled={bezig}
            onChange={(e) => void kiesRekening(e.target.value)}
          >
            <option value="">— nog niet ingedeeld —</option>
            {bruikbaar.map((g) => (
              <option key={g.id} value={g.code}>
                {g.code} · {g.naam}{g.actief ? '' : ' (uit)'}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <Veld label="Factuurnummer" waarde={bon.factuurnummer} mono />
          <Veld
            label="Vervaldatum"
            waarde={bon.vervaldatum ? dateShort(bon.vervaldatum) : undefined}
          />
          <Veld
            label="Btw volgens de factuur"
            waarde={bon.btwBedrag != null ? money(bon.btwBedrag) : undefined}
          />
        </div>
      </div>

      {beschikbaar.length > 0 && (
        <Field label="Tags" help="Waar je later op filtert; los van de rekening.">
          <div className="row">
            {beschikbaar.map((naam) => {
              const aan = (bon.tags ?? []).includes(naam)
              return (
                <button
                  key={naam}
                  className={aan ? 'btn sm ok' : 'btn ghost sm'}
                  disabled={bezig}
                  onClick={() => void wisselTag(naam)}
                >
                  {aan && <Check size={12} />} {naam}
                </button>
              )
            })}
          </div>
        </Field>
      )}

      {bruikbaar.length === 0 && (
        <p className="hint">
          <Wallet size={14} style={{ verticalAlign: -2 }} /> Er staan nog geen
          grootboekrekeningen klaar. Die stel je in bij Ontwikkeling → Inkoop.
        </p>
      )}
    </Card>
  )
}

/* --------------------------- De uitkomst -------------------------- */

function Lezing({ bon, lezing }: { bon: Expense; lezing: FactuurLezing }) {
  const voorstel = useMemo(() => voorstellen(bon, lezing), [bon, lezing])
  const optelling = regelsKloppen(lezing)
  const [bezig, setBezig] = useState(false)

  async function neemOver(regels: Voorstel[]) {
    if (!regels.length || bezig) return
    setBezig(true)
    try {
      const patch: Partial<Expense> = {}
      for (const v of regels) {
        if (v.veld === 'supplier') patch.supplier = String(v.waarde)
        if (v.veld === 'description') patch.description = String(v.waarde)
        if (v.veld === 'amountExcl') patch.amountExcl = Number(v.waarde)
        if (v.veld === 'vatPct') patch.vatPct = Number(v.waarde)
        if (v.veld === 'date') patch.date = Number(v.waarde)
        if (v.veld === 'category') patch.category = lezing.voorstelCategorie
      }
      await expRepo.update(bon.id, patch)
      toast.ok(regels.length === 1 ? 'Overgenomen.' : `${regels.length} velden overgenomen.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Overnemen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  const excl = bedragExcl(lezing)
  const btw = btwPercentage(lezing)

  return (
    <div className="lezing">
      <div className="lezing-kop">
        <ScanText size={15} />
        <span>
          Voorgelezen op {dateShort(lezing.gelezenOp)}
          {lezing.bestand ? ` uit ${lezing.bestand}` : ''}
        </span>
        {lezing.soort && lezing.soort !== 'factuur' && (
          <Badge tone="info">{lezing.soort}</Badge>
        )}
      </div>

      {lezing.gemarkeerd && (
        <p className="waarschuwing">
          De bijlagecontrole had dit bestand tegengehouden: {lezing.gemarkeerd} Het is
          wél gelezen — daarbij wordt niets uitgevoerd — maar kijk de bedragen na
          voordat je ze overneemt.
        </p>
      )}

      {/* --- waar het model over twijfelde --- */}
      {(lezing.twijfel?.length ?? 0) > 0 && (
        <div className="lezing-twijfel">
          <div className="kop"><AlertTriangle size={14} /> Hier kwam de app niet uit</div>
          <ul>
            {lezing.twijfel!.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {optelling && !optelling.klopt && (
        <p className="waarschuwing">
          De regels tellen op tot {money((lezing.subtotaalExcl ?? 0) + optelling.verschil)},
          maar er staat {money(lezing.subtotaalExcl ?? 0)} als subtotaal.
          Er staat iets op de factuur dat niet in de regels terecht is gekomen.
        </p>
      )}

      {/* --- de kop van de factuur --- */}
      <div className="lezing-velden">
        <Veld label="Leverancier" waarde={lezing.leverancier} />
        <Veld label="Factuurnummer" waarde={lezing.factuurnummer} />
        <Veld label="Factuurdatum" waarde={lezing.datum ? dateShort(lezing.datum) : undefined} />
        <Veld label="Vervaldatum" waarde={lezing.vervaldatum ? dateShort(lezing.vervaldatum) : undefined} />
        <Veld label="IBAN" waarde={lezing.iban} mono />
        <Veld label="Betalingskenmerk" waarde={lezing.betalingskenmerk} mono />
        <Veld label="Btw-nummer" waarde={lezing.btwNummer} mono />
        <Veld label="KvK" waarde={lezing.kvk} mono />
      </div>

      {/* --- de regels --- */}
      {(lezing.regels?.length ?? 0) > 0 && (
        <div className="table-wrap" style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th className="num">Aantal</th>
                <th className="num">Stukprijs</th>
                <th className="num">Btw</th>
                <th className="num">Excl.</th>
              </tr>
            </thead>
            <tbody>
              {lezing.regels!.map((r, i) => (
                <tr key={i}>
                  <td>{r.omschrijving}</td>
                  <td className="num">
                    {r.aantal != null ? `${r.aantal}${r.eenheid ? ' ' + r.eenheid : ''}` : '—'}
                  </td>
                  <td className="num">{r.stukprijs != null ? money(r.stukprijs) : '—'}</td>
                  <td className="num">{r.btwPct != null ? `${r.btwPct}%` : '—'}</td>
                  <td className="num">{r.bedragExcl != null ? money(r.bedragExcl) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Subtotaal exclusief btw</td>
                <td className="num">{lezing.subtotaalExcl != null ? money(lezing.subtotaalExcl) : '—'}</td>
              </tr>
              <tr>
                <td colSpan={4}>Btw</td>
                <td className="num">{lezing.btwBedrag != null ? money(lezing.btwBedrag) : '—'}</td>
              </tr>
              <tr>
                <td colSpan={4}><strong>Totaal inclusief</strong></td>
                <td className="num"><strong>{lezing.totaalIncl != null ? money(lezing.totaalIncl) : '—'}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* --- wat er over te nemen valt --- */}
      <div className="lezing-overnemen">
        {voorstel.length === 0 ? (
          <p className="hint">
            {excl == null && btw == null
              ? 'Er zijn geen bedragen uit dit stuk te halen om over te nemen.'
              : 'Wat hierboven staat komt overeen met wat er al bij de kostenpost staat.'}
          </p>
        ) : (
          <>
            <div className="kop">
              <Sparkles size={14} /> Overnemen naar de kostenpost
            </div>
            <ul>
              {voorstel.map((v) => (
                <li key={String(v.veld)}>
                  <span className="l">{v.label}</span>
                  {v.huidig != null && (
                    <span className="was">
                      {typeof v.huidig === 'number' && v.veld !== 'date'
                        ? money(v.huidig)
                        : v.veld === 'date' ? dateShort(Number(v.huidig)) : String(v.huidig)}
                    </span>
                  )}
                  <span className="wordt">
                    {typeof v.waarde === 'number' && v.veld !== 'date'
                      ? money(v.waarde)
                      : v.veld === 'date' ? dateShort(Number(v.waarde)) : String(v.waarde)}
                  </span>
                  <button
                    className="btn ghost sm"
                    disabled={bezig}
                    onClick={() => void neemOver([v])}
                  >
                    Overnemen
                  </button>
                </li>
              ))}
            </ul>
            <div className="row end">
              <button
                className="btn primary sm"
                disabled={bezig}
                onClick={() => void neemOver(voorstel)}
              >
                {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Alles overnemen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Veld({ label, waarde, mono }: { label: string; waarde?: string; mono?: boolean }) {
  if (!waarde) return null
  return (
    <div className="lezing-veld">
      <span className="l">{label}</span>
      <span className={mono ? 'w mono' : 'w'}>{waarde}</span>
    </div>
  )
}

/* ---------------------------- De bijlage -------------------------- */

function Bijlage({ bon }: { bon: Expense }) {
  const post = useLiveQuery<MailBericht | undefined>(
    async () => (bon.mailboxId ? db.mailbox.get(bon.mailboxId) : undefined),
    [bon.mailboxId],
  )
  const [kijkt, setKijkt] = useState<number | null>(null)

  /*
   * Een mail met drie bonnen eraan leverde hier één knop op, en de andere
   * twee waren nergens meer te vinden. Kwam deze bon uit de post, dan hangt
   * alles wat er bij die mail zat er nu onder.
   */
  const bijlagen = useMemo<Bekijkbaar[]>(() => {
    const uitPost: Bekijkbaar[] = (post?.attachments ?? []).map((b) => ({
      naam: b.naam,
      mime: b.mime,
      size: b.size,
      geblokkeerd: magOpenen(b)
        ? undefined
        : (b.controleReden || 'Deze bijlage kwam niet door de controle.'),
      haal: () => postbus.openBijlage(b),
    }))

    if (!bon.attachmentPath) return uitPost
    if (uitPost.some((b) => b.naam === bon.attachmentName)) return uitPost
    return [
      {
        naam: bon.attachmentName ?? 'Bijlage',
        haal: () => postbus.openBijlage({ path: bon.attachmentPath! }),
      },
      ...uitPost,
    ]
  }, [post, bon.attachmentPath, bon.attachmentName])

  if (bijlagen.length === 0) return null

  return (
    <>
      {bijlagen.map((b, i) => (
        <button key={b.naam + i} className="bon-bijlage" onClick={() => setKijkt(i)}>
          <Paperclip size={12} /> {b.naam}
        </button>
      ))}
      <Bekijker
        bestanden={bijlagen}
        index={kijkt}
        onSluiten={() => setKijkt(null)}
        onWissel={setKijkt}
      />
    </>
  )
}
