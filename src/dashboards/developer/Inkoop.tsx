/* ===========================================================================
 *  Inkoop -- waar facturen binnenkomen en hoe ze zichzelf indelen
 *
 *  Drie dingen op één scherm, want ze horen bij elkaar en je stelt ze in
 *  dezelfde tien minuten in:
 *
 *    1. de adressen    inkoop.<vestiging>@<domein>, per vestiging
 *    2. het grootboek  waar een factuur op geboekt wordt
 *    3. de tags        waar hij daarnaast op te filteren is
 *
 *  Waarom hier en niet bij de administratie: dit is instelwerk dat één keer
 *  goed moet staan en daarna met rust gelaten wordt. Het dagelijkse werk --
 *  nakijken en goedkeuren -- staat bij Kostenposten.
 *
 *  Het domein is met opzet geen vaste waarde in de code. Er staat nu een
 *  voorlopig domein, en zodra dat verhuist zou anders de hele factuurstroom
 *  stilvallen tot er iemand een nieuwe versie uitbrengt.
 * =========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check, Copy, Mail, Plus, Save, Tag, TriangleAlert, Wallet, X,
} from 'lucide-react'
import { db } from '../../lib/db'
import { enqueue } from '../../lib/sync'
import {
  SLEUTELS, domeinProbleem, inkoopAdres, leesInstellingen, voorvoegselProbleem,
  zetInstelling,
} from '../../lib/instellingen'
import { relative } from '../../lib/format'
import type { Grootboek, Instelling, KostenTag, Location } from '../../lib/types'
import { Badge, Card, Empty, Field, Modal } from '../../components/ui'
import { toast } from '../../store/useToasts'

/*
 * De drie standen van de factuurlezer (instelling factuur_lezer, 0049). De
 * waarde is wat de post en de functie lezer op de server vergelijken; de
 * tekst is wat Casper leest. Wie hier een stand toevoegt, moet hem ook in
 * ontvang-mail en lezer kennen.
 */
type Lezer = 'claude' | 'lokaal' | 'lokaal-terugval'

const LEZERS: { waarde: Lezer; naam: string; uitleg: string }[] = [
  {
    waarde: 'claude',
    naam: 'Claude (Sonnet 5, in de cloud)',
    uitleg: 'Leest ook foto’s van gekreukte bonnen goed; kost een paar cent per factuur en de factuur gaat naar Anthropic.',
  },
  {
    waarde: 'lokaal',
    naam: 'Lokaal (Ollama op de eigen server)',
    uitleg: 'Gratis per factuur en de factuur verlaat het pand niet. Staat de server uit, dan blijven de bonnen wachten tot hij weer draait.',
  },
  {
    waarde: 'lokaal-terugval',
    naam: 'Lokaal, met Claude als terugval',
    uitleg: 'De veilige middenweg: lokaal lezen, en alleen als het lokale model twijfelt of uitvalt gaat de factuur alsnog naar Claude.',
  },
]

/** Langer dan dit niets gehoord van het lokale programma terwijl het zou moeten draaien: rood. */
const LEZER_STIL_NA_MS = 5 * 60_000

/*
 * Rode hulptekst. De stylesheet kent .btn.danger en .badge.danger, maar geen
 * .help.danger: een span met die klasse kreeg het driehoekje wel en de kleur
 * niet (viel op bij de statusregel van de lezer, maar de foutregels onder de
 * velden hadden hetzelfde). Tot er een regel in theme.css staat, zetten we de
 * kleur hier inline; het token bestaat voor licht en donker.
 */
const ROOD = { color: 'var(--text-danger)' } as const

export default function Inkoop() {
  return (
    <>
      <Adressen />
      <Rekeningen />
      <Etiketten />
    </>
  )
}

/* ================================================================== *
 *  1. De adressen
 * ================================================================== */

function Adressen() {
  const vestigingen = useLiveQuery(
    () => db.locations.toArray(), [], [] as Location[])

  const [domein, setDomein] = useState('')
  const [voorvoegsel, setVoorvoegsel] = useState('inkoop')
  const [automatisch, setAutomatisch] = useState(true)
  const [lezer, setLezer] = useState<Lezer>('claude')
  const [autoAan, setAutoAan] = useState(false)
  const [autoVanaf, setAutoVanaf] = useState('3')
  const [autoMarge, setAutoMarge] = useState('2')
  const [autoMax, setAutoMax] = useState('500')
  const [eigenKvk, setEigenKvk] = useState('')
  const [eigenBtw, setEigenBtw] = useState('')
  const [eigenIban, setEigenIban] = useState('')
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let levend = true
    leesInstellingen().then((alle) => {
      if (!levend) return
      setDomein(alle[SLEUTELS.inkoopDomein] ?? '')
      setVoorvoegsel(alle[SLEUTELS.inkoopVoorvoegsel] || 'inkoop')
      setAutomatisch((alle[SLEUTELS.factuurAutomatisch] || 'ja') !== 'nee')
      /*
       * Een onbekende waarde -- een typefout in de SQL-editor -- wordt hier
       * 'claude', net zoals de post hem leest. Anders zou het scherm een stand
       * tonen die de server niet kent.
       */
      const gekozen = alle[SLEUTELS.factuurLezer]
      setLezer(LEZERS.some((l) => l.waarde === gekozen) ? gekozen as Lezer : 'claude')
      setAutoAan((alle[SLEUTELS.autoGoedkeuren] || 'nee') === 'ja')
      setAutoVanaf(alle[SLEUTELS.autoGoedkeurenVanaf] || '3')
      setAutoMarge(alle[SLEUTELS.autoGoedkeurenMarge] || '2')
      setAutoMax(alle[SLEUTELS.autoGoedkeurenMax] || '500')
      setEigenKvk(alle[SLEUTELS.eigenKvk] ?? '')
      setEigenBtw(alle[SLEUTELS.eigenBtw] ?? '')
      setEigenIban(alle[SLEUTELS.eigenIban] ?? '')
      setGeladen(true)
    })
    return () => { levend = false }
  }, [])

  const foutDomein = geladen ? domeinProbleem(domein) : null
  const foutVoorvoegsel = geladen ? voorvoegselProbleem(voorvoegsel) : null

  async function bewaar() {
    if (foutDomein || foutVoorvoegsel) return
    setBezig(true)
    try {
      await zetInstelling(SLEUTELS.inkoopDomein, domein.trim().toLowerCase())
      await zetInstelling(SLEUTELS.inkoopVoorvoegsel, voorvoegsel.trim().toLowerCase())
      await zetInstelling(SLEUTELS.factuurAutomatisch, automatisch ? 'ja' : 'nee')
      await zetInstelling(SLEUTELS.factuurLezer, lezer)
      await zetInstelling(SLEUTELS.eigenKvk, eigenKvk.trim())
      await zetInstelling(SLEUTELS.eigenBtw, eigenBtw.trim().toUpperCase())
      await zetInstelling(SLEUTELS.eigenIban, eigenIban.trim().toUpperCase())
      await zetInstelling(SLEUTELS.autoGoedkeuren, autoAan ? 'ja' : 'nee')
      await zetInstelling(SLEUTELS.autoGoedkeurenVanaf, String(Math.max(2, Number(autoVanaf) || 3)))
      await zetInstelling(SLEUTELS.autoGoedkeurenMarge, String(Math.min(25, Math.max(0, Number(autoMarge) || 0))))
      await zetInstelling(SLEUTELS.autoGoedkeurenMax, String(Math.max(0, Number(autoMax) || 0)))
      toast.ok('Opgeslagen. Nieuwe post komt hier binnen.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  /*
   * Alleen vestigingen met een website-adres. Dat is niet willekeurig: die
   * slug is wat ontvang-mail terugzoekt als er post op inkoop.<iets>@
   * binnenkomt. Een vestiging zonder slug heeft dus geen werkend adres, en
   * dat hoort hier te staan in plaats van een adres te tonen dat nergens
   * aankomt.
   */
  const actief = vestigingen.filter((l) => l.active !== false)
  const metSlug = useMemo(
    () => actief.filter((l) => l.websiteSlug)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [vestigingen]) // eslint-disable-line react-hooks/exhaustive-deps
  const zonderSlug = actief.filter((l) => !l.websiteSlug)

  return (
    <Card
      title="Waar facturen binnenkomen"
      hint="Per vestiging een eigen adres, zodat een bon vanzelf op de goede plek staat"
      className="mb"
    >
      <div className="grid cols-2 mb">
        <Field label="Domein" help="Alleen het domein, dus zonder het stuk voor de @.">
          <input
            className="input"
            value={domein}
            onChange={(e) => setDomein(e.target.value)}
            placeholder="preview.truckwash.cloud"
            spellCheck={false}
          />
          {foutDomein && <span className="help danger" style={ROOD}>{foutDomein}</span>}
        </Field>

        <Field label="Voorvoegsel" help="Het stuk voor de punt: inkoop.oss@…">
          <input
            className="input"
            value={voorvoegsel}
            onChange={(e) => setVoorvoegsel(e.target.value)}
            placeholder="inkoop"
            spellCheck={false}
          />
          {foutVoorvoegsel && <span className="help danger" style={ROOD}>{foutVoorvoegsel}</span>}
        </Field>
      </div>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={automatisch}
          onChange={(e) => setAutomatisch(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Facturen automatisch uitlezen en indelen</strong>
          <br />
          <span className="help">
            Staat dit uit, dan komt een bon nog steeds binnen — alleen met een
            leeg bedrag, zoals vroeger. Je leest hem dan zelf uit bij de
            kostenpost.
          </span>
        </span>
      </label>

      {/* ---- wie leest ---- */}

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Wie leest de facturen</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Alleen het lezen verschilt; wat er daarna gebeurt — opschonen,
        verkoopcontrole, indelen, boeken — doet de server in alle drie de
        standen op dezelfde manier. Werkt alleen als het vinkje hierboven aanstaat.
      </p>
      <div className="grid" style={{ gap: 8 }}>
        {LEZERS.map((l) => (
          <label
            key={l.waarde}
            className="row"
            style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="factuur-lezer"
              value={l.waarde}
              checked={lezer === l.waarde}
              onChange={() => setLezer(l.waarde)}
              disabled={!automatisch}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>{l.naam}</strong>
              <br />
              <span className="help">{l.uitleg}</span>
            </span>
          </label>
        ))}
      </div>
      {/* Zonder het vinkje leest niemand en wacht er dus ook niets: dan geen rode regel. */}
      <LezerStatus lokaalGekozen={automatisch && lezer !== 'claude'} />

      {/* ---- zichzelf goedkeuren ---- */}

      <h4 style={{ marginTop: 24, marginBottom: 4 }}>Zichzelf goedkeuren</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Is dezelfde leverancier al een paar keer <strong>door een mens</strong> voor
        ongeveer hetzelfde bedrag goedgekeurd, dan mag de volgende factuur vanzelf
        door. Wat het systeem zelf goedkeurde telt daarbij niet mee — anders
        bevestigt het na verloop van tijd zijn eigen vergissingen. Een factuur met
        twijfel, een geraden grootboekrekening of een factuurnummer dat al bestaat
        gaat nooit vanzelf door.
      </p>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={autoAan}
          onChange={(e) => setAutoAan(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Facturen mogen zichzelf goedkeuren</strong>
          <br />
          <span className="help">
            Hier gaat geld weg zonder dat iemand keek. Zet dit pas aan als je een
            paar maanden hebt gezien dat de lezer klopt; je krijgt van elke
            automatische goedkeuring een melding, en afkeuren kan altijd nog.
          </span>
        </span>
      </label>

      {autoAan && (
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <Field label="Vanaf hoeveel keer" help="Minimaal 2. Standaard 3.">
            <input
              className="input"
              type="number"
              min={2}
              value={autoVanaf}
              onChange={(e) => setAutoVanaf(e.target.value)}
            />
          </Field>
          <Field label="Marge op het bedrag (%)" help="Hoeveel het mag afwijken van wat gebruikelijk is.">
            <input
              className="input"
              type="number"
              min={0}
              max={25}
              value={autoMarge}
              onChange={(e) => setAutoMarge(e.target.value)}
            />
          </Field>
          <Field label="Plafond (€ excl. btw)" help="Hierboven kijkt altijd iemand mee.">
            <input
              className="input"
              type="number"
              min={0}
              value={autoMax}
              onChange={(e) => setAutoMax(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* ---- de eigen nummers ---- */}

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Onze eigen nummers</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Een factuur die Truckwash zélf stuurde en die iemand doorstuurt naar een
        inkoopadres, mag geen kostenpost worden. De lezer herkent dat aan wie
        bovenaan staat, maar haalt de kostenpost pas weg als één van deze
        nummers ook echt op het stuk staat. Leeg betekent: nooit weghalen, de
        bon blijft dan staan met de twijfel erop. Meerdere nummers mag, met een
        komma ertussen.
      </p>
      <div className="grid cols-3 mb">
        <Field label="KvK-nummer">
          <input
            className="input"
            value={eigenKvk}
            onChange={(e) => setEigenKvk(e.target.value)}
            placeholder="12345678"
            spellCheck={false}
          />
        </Field>
        <Field label="Btw-nummer">
          <input
            className="input"
            value={eigenBtw}
            onChange={(e) => setEigenBtw(e.target.value)}
            placeholder="NL123456789B01"
            spellCheck={false}
          />
        </Field>
        <Field label="IBAN">
          <input
            className="input"
            value={eigenIban}
            onChange={(e) => setEigenIban(e.target.value)}
            placeholder="NL00BANK0123456789"
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn primary"
          onClick={bewaar}
          disabled={bezig || !!foutDomein || !!foutVoorvoegsel}
        >
          <Save size={16} /> Opslaan
        </button>
      </div>

      {/* ---- wat dit oplevert ---- */}

      <h4 style={{ marginTop: 24, marginBottom: 4 }}>De adressen</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Zet deze bij Resend als doorstuuradres naar de webhook. Post op een adres
        dat hier niet bij staat komt gewoon binnen, maar dan zonder vestiging.
      </p>

      {!domein || foutDomein ? (
        <Empty
          text="Vul hierboven een domein in; dan verschijnen de adressen hier."
          icon={<TriangleAlert size={22} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Vestiging</th>
                <th>Adres</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              <AdresRegel
                naam="Algemeen (geen vestiging)"
                adres={inkoopAdres(domein, voorvoegsel)}
              />
              {metSlug.map((l) => (
                <AdresRegel
                  key={l.id}
                  naam={l.name}
                  adres={inkoopAdres(domein, voorvoegsel, l.websiteSlug)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {zonderSlug.length > 0 && (
        <p className="help" style={{ marginTop: 12 }}>
          <TriangleAlert size={13} style={{ verticalAlign: -2 }} />{' '}
          {zonderSlug.length === 1
            ? 'Eén vestiging heeft'
            : `${zonderSlug.length} vestigingen hebben`}{' '}
          nog geen website-adres en dus geen eigen inkoopadres:{' '}
          {zonderSlug.map((l) => l.name).join(', ')}. Dat stel je in bij
          Vestigingen, tabblad Website.
        </p>
      )}
    </Card>
  )
}

/**
 * Leeft het lokale programma nog?
 *
 * De functie lezer zet bij elke ronde lezer_laatst_gezien en lezer_model.
 * Die lezen we live uit de eigen tabel en niet één keer bij het laden: je
 * start het programma op de server en wilt hier binnen een halve minuut zien
 * dat het zich meldt, zonder het scherm te verversen.
 *
 * Rood alleen als lokaal gekozen is. Staat de lezer op Claude, dan is een
 * programma dat al weken niets zegt geen probleem maar de bedoeling.
 */
function LezerStatus({ lokaalGekozen }: { lokaalGekozen: boolean }) {
  const rijen = useLiveQuery(
    () => db.instellingen.toArray(), [], [] as Instelling[])

  /*
   * De klok tikt elke halve minuut, anders blijft er "zojuist" staan terwijl
   * het programma allang stil is.
   */
  const [nu, setNu] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const waarde = (sleutel: string) =>
    (rijen.find((r) => r.sleutel === sleutel)?.waarde ?? '').trim()
  const gezien = Number(waarde(SLEUTELS.lezerLaatstGezien)) || 0
  const model = waarde(SLEUTELS.lezerModel)

  const stil = lokaalGekozen && (!gezien || nu - gezien > LEZER_STIL_NA_MS)

  return (
    // Buiten een <Field> geldt .field .help niet; de maat en kleur dus hier.
    <p
      className={stil ? 'help danger' : 'help'}
      style={{
        marginTop: 10, fontSize: '.76rem', lineHeight: 1.45,
        color: stil ? 'var(--text-danger)' : 'var(--text-3)',
      }}>
      {stil && <TriangleAlert size={13} style={{ verticalAlign: -2 }} />}{' '}
      Lokale lezer{' '}
      {gezien
        ? <>laatst gezien {relative(gezien, nu)}{model && <>, model <code>{model}</code></>}</>
        : 'nog nooit gezien'}
      {stil && (gezien > 0
        ? ' — draait het programma op de server nog?'
        : ' — zonder draaiend programma blijven de bonnen wachten.')}
    </p>
  )
}

function AdresRegel({ naam, adres }: { naam: string; adres: string }) {
  const [gekopieerd, setGekopieerd] = useState(false)

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(adres)
      setGekopieerd(true)
      setTimeout(() => setGekopieerd(false), 1500)
    } catch {
      toast.error('Kopiëren lukte niet; selecteer het adres met de hand.')
    }
  }

  return (
    <tr>
      <td>{naam}</td>
      <td><code>{adres}</code></td>
      <td>
        <button className="btn ghost sm" onClick={kopieer} title="Adres kopiëren">
          {gekopieerd ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </td>
    </tr>
  )
}

/* ================================================================== *
 *  2. Het grootboek
 * ================================================================== */

function Rekeningen() {
  const rijen = useLiveQuery(() => db.grootboek.toArray(), [], [] as Grootboek[])
  const [open, setOpen] = useState<Grootboek | 'nieuw' | null>(null)

  const gesorteerd = useMemo(
    () => [...rijen].sort((a, b) => a.code.localeCompare(b.code)), [rijen])

  return (
    <Card
      title="Grootboekrekeningen"
      hint="Waar een factuur op geboekt wordt, en waaraan hij te herkennen is"
      className="mb"
      action={
        <button className="btn sm" onClick={() => setOpen('nieuw')}>
          <Plus size={15} /> Rekening
        </button>
      }
    >
      {gesorteerd.length === 0 ? (
        <Empty
          text="Nog geen rekeningen. Draai supabase/bijwerken.sql; die zet er twaalf klaar."
          icon={<Wallet size={22} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Naam</th>
                <th>Trefwoorden</th>
                <th style={{ width: 60 }}>Btw</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {gesorteerd.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.code}</code></td>
                  <td>
                    {r.naam}{' '}
                    {!r.actief && <Badge>uit</Badge>}
                  </td>
                  <td className="afgekapt">
                    {r.trefwoorden?.length
                      ? r.trefwoorden.join(', ')
                      : 'geen — deze wordt nooit geraden'}
                  </td>
                  <td className="num">{r.btwPct ?? 21}%</td>
                  <td>
                    <button className="btn ghost sm" onClick={() => setOpen(r)}>
                      Wijzigen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RekeningModal
        open={open !== null}
        rij={open === 'nieuw' || open === null ? null : open}
        bestaandeCodes={rijen.map((r) => r.code)}
        onClose={() => setOpen(null)}
      />
    </Card>
  )
}

function RekeningModal({
  open, rij, bestaandeCodes, onClose,
}: {
  open: boolean
  rij: Grootboek | null
  bestaandeCodes: string[]
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [naam, setNaam] = useState('')
  const [woorden, setWoorden] = useState('')
  const [btw, setBtw] = useState('21')
  const [actief, setActief] = useState(true)
  const [bezig, setBezig] = useState(false)

  /*
   * Bij het openen de velden vullen. Zonder dit houdt het venster de gegevens
   * van de vorige rekening vast, en dan wijzig je 4010 terwijl er 4000 boven
   * staat.
   */
  useEffect(() => {
    if (!open) return
    setCode(rij?.code ?? '')
    setNaam(rij?.naam ?? '')
    setWoorden((rij?.trefwoorden ?? []).join(', '))
    setBtw(String(rij?.btwPct ?? 21))
    setActief(rij?.actief !== false)
  }, [open, rij])

  const codeFout = !code.trim()
    ? 'Een rekening zonder code is niet terug te vinden.'
    : (!rij && bestaandeCodes.includes(code.trim()))
      ? 'Deze code bestaat al.'
      : null

  async function bewaar() {
    if (codeFout || !naam.trim()) return
    setBezig(true)
    try {
      const nieuw: Grootboek = {
        id: rij?.id ?? 'gb_' + code.trim(),
        code: code.trim(),
        naam: naam.trim(),
        /*
         * Trefwoorden in kleine letters. Het indelen in de database zoekt
         * kleingeschreven; een trefwoord met een hoofdletter zou dan nooit
         * raak zijn, en dat is niet te zien aan het scherm.
         */
        trefwoorden: woorden.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean),
        btwPct: Number(btw) || 0,
        actief,
        updatedAt: Date.now(),
      }
      await db.grootboek.put(nieuw)
      await enqueue('grootboek', 'put', nieuw.id, nieuw)
      toast.ok('Rekening opgeslagen.')
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
      title={rij ? `Rekening ${rij.code}` : 'Nieuwe rekening'}
      subtitle="Hierop worden kosten geboekt; de trefwoorden bepalen wanneer"
      onClose={onClose}
      width={620}
    >
      <div className="grid cols-2">
        <Field label="Code">
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4031"
            disabled={!!rij}
          />
          {codeFout && <span className="help danger" style={ROOD}>{codeFout}</span>}
        </Field>
        <Field label="Btw-percentage" help="Vangnet; wat op de factuur staat gaat voor.">
          <input
            className="input"
            type="number"
            value={btw}
            onChange={(e) => setBtw(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Naam">
        <input
          className="input"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Contributies en heffingen"
        />
      </Field>

      <Field
        label="Trefwoorden"
        help="Gescheiden door komma's. Hierop wordt geraden zolang de leverancier nog onbekend is."
      >
        <textarea
          className="textarea"
          rows={3}
          value={woorden}
          onChange={(e) => setWoorden(e.target.value)}
          placeholder="contributie, lidmaatschap, heffing, kvk"
        />
      </Field>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={actief}
          onChange={(e) => setActief(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          In gebruik
          <br />
          <span className="help">
            Uitgezette rekeningen worden niet meer voorgesteld. Wat er al op
            geboekt staat blijft staan — anders zou een oude boeking van
            rekening veranderen omdat iemand een vinkje uitzette.
          </span>
        </span>
      </label>

      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn primary"
          onClick={bewaar}
          disabled={bezig || !!codeFout || !naam.trim()}
        >
          <Save size={16} /> Opslaan
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  3. De tags
 * ================================================================== */

function Etiketten() {
  const rijen = useLiveQuery(() => db.kostenTags.toArray(), [], [] as KostenTag[])
  const [nieuw, setNieuw] = useState('')

  const gesorteerd = useMemo(
    () => [...rijen].sort((a, b) => a.naam.localeCompare(b.naam)), [rijen])

  async function voegToe() {
    const naam = nieuw.trim().toLowerCase()
    if (!naam) return
    if (gesorteerd.some((t) => t.naam === naam)) {
      toast.error('Die tag bestaat al.')
      return
    }
    const rij: KostenTag = { id: 'tag_' + naam, naam, updatedAt: Date.now() }
    await db.kostenTags.put(rij)
    await enqueue('kostenTags', 'put', rij.id, rij)
    setNieuw('')
  }

  async function weg(t: KostenTag) {
    /*
     * Met een waarschuwing en niet stil. Een tag weghalen laat de kostenposten
     * waar hij op staat ongemoeid -- daar blijft dan een etiket staan dat
     * nergens meer in de lijst voorkomt.
     */
    if (!window.confirm(
      `Tag "${t.naam}" weghalen?\n\n`
      + 'Kostenposten waar hij al op staat houden hem; hij is alleen niet meer '
      + 'te kiezen.')) return
    await db.kostenTags.delete(t.id)
    await enqueue('kostenTags', 'delete', t.id, null)
  }

  return (
    <Card
      title="Tags"
      hint="Losse etiketten naast de grootboekrekening: afval, elektra, osmose"
    >
      <div className="row mb">
        <input
          className="input"
          value={nieuw}
          onChange={(e) => setNieuw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }}
          placeholder="nieuwe tag"
          style={{ maxWidth: 240 }}
        />
        <button className="btn" onClick={voegToe} disabled={!nieuw.trim()}>
          <Plus size={15} /> Toevoegen
        </button>
      </div>

      {gesorteerd.length === 0 ? (
        <Empty text="Nog geen tags. Voeg er hierboven een toe." icon={<Tag size={22} />} />
      ) : (
        <div className="row">
          {gesorteerd.map((t) => (
            <span key={t.id} className="badge">
              {t.naam}
              <button
                className="btn ghost sm"
                onClick={() => weg(t)}
                title={`${t.naam} weghalen`}
                style={{ padding: '0 2px', marginLeft: 4 }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
