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
import type { Grootboek, KostenTag, Location } from '../../lib/types'
import { Badge, Card, Empty, Field, Modal } from '../../components/ui'
import { toast } from '../../store/useToasts'

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
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let levend = true
    leesInstellingen().then((alle) => {
      if (!levend) return
      setDomein(alle[SLEUTELS.inkoopDomein] ?? '')
      setVoorvoegsel(alle[SLEUTELS.inkoopVoorvoegsel] || 'inkoop')
      setAutomatisch((alle[SLEUTELS.factuurAutomatisch] || 'ja') !== 'nee')
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
          {foutDomein && <span className="help danger">{foutDomein}</span>}
        </Field>

        <Field label="Voorvoegsel" help="Het stuk voor de punt: inkoop.oss@…">
          <input
            className="input"
            value={voorvoegsel}
            onChange={(e) => setVoorvoegsel(e.target.value)}
            placeholder="inkoop"
            spellCheck={false}
          />
          {foutVoorvoegsel && <span className="help danger">{foutVoorvoegsel}</span>}
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
          {codeFout && <span className="help danger">{codeFout}</span>}
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
