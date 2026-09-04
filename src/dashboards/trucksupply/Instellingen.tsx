import { useEffect, useState } from 'react'
import { BellRing, ExternalLink, Link2, Link2Off, Loader2, Lock, Mail, RefreshCw, Send } from 'lucide-react'
import {
  exactLos, exactStatus, exactVerbindUrl, testMail, trucksupplyInstellingen, type ExactStatus,
} from '../../lib/trucksupply'
import { SLEUTELS, zetInstelling } from '../../lib/instellingen'
import { dateTime } from '../../lib/format'
import type { User } from '../../lib/types'
import { Badge, Card, Field } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Instellingen van de leverancier
 *
 *  Drie kaarten: waar de mail heen gaat en wanneer, de koppeling met Exact,
 *  en een uitleg van hoe de alarmen werken. Die laatste staat hier met
 *  opzet: wie het mailadres of het uur wijzigt, moet kunnen lezen wat dat
 *  doet zonder een collega te bellen.
 * ------------------------------------------------------------------ */

/**
 * Wie de drie instellingen van de leverancier mag lezen en schrijven.
 *
 * Spiegel van de RLS op public.instellingen: het management mag alles (0042),
 * en sinds 0048 mag de rol trucksupply, of wie het losse recht
 * supply.settings kreeg, precies de drie sleutels trucksupply_mail,
 * trucksupply_ochtend_uur en exact_division. heeft_recht() op de server kijkt
 * in profiles.grants; de app kijkt via perms.can, dat de roldefaults meeneemt
 * -- voor de rol trucksupply komt dat op hetzelfde neer, omdat de policy die
 * rol los noemt. Wie hier zonder een van beide komt (een medewerker die het
 * scherm via een zoekopdracht vindt) ziet in Dexie een lege tabel en zou
 * met Opslaan een rij in de wachtrij zetten die de server weigert terwijl de
 * toast "opgeslagen" zegt; daarom dan geen knoppen en een eerlijke regel.
 */
function magInstellingenSchrijven(user: User | null, magSettings: boolean): boolean {
  if (!user) return false
  return user.roles.includes('management') || user.roles.includes('trucksupply') || magSettings
}

/*
 * Het uur van de ochtendmail. De wekker (.github/workflows/voorraad.yml) loopt
 * elk heel uur van 4 tot en met 9 UTC; dat is 6 tot en met 10 Nederlandse
 * tijd, zomer en winter. Een ander uur komt de wekker nooit langs, en dan
 * gaat er stil geen ochtendmail -- dus laten we het hier niet toe.
 */
const OCHTEND_UUR_MIN = 6
const OCHTEND_UUR_MAX = 10

export default function Instellingen() {
  const user = useAuth((s) => s.user)
  const perms = usePerms()
  const magSchrijven = magInstellingenSchrijven(user, perms.can('supply.settings'))
  const [mail, setMail] = useState('')
  const [uur, setUur] = useState('8')
  const [division, setDivision] = useState('')
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const [exact, setExact] = useState<ExactStatus | null>(null)
  const [exactFout, setExactFout] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const i = await trucksupplyInstellingen()
      setMail(i.mail)
      setUur(String(i.ochtendUur))
      setDivision(i.exactDivision)
      setGeladen(true)
    })()
    void exactOphalen()
  }, [])

  async function exactOphalen() {
    setExactFout(null)
    try {
      setExact(await exactStatus())
    } catch (e) {
      setExact(null)
      setExactFout((e as Error).message)
    }
  }

  async function doe(naam: string, werk: () => Promise<unknown>, melding?: string) {
    setBezig(naam)
    try {
      await werk()
      if (melding) toast.ok(melding)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(null)
    }
  }

  function mailOpslaan() {
    const adres = mail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) return toast.error('Dat is geen geldig mailadres.')
    const u = Number(uur)
    if (!Number.isInteger(u) || u < OCHTEND_UUR_MIN || u > OCHTEND_UUR_MAX) {
      return toast.error(`Het uur is een heel getal van ${OCHTEND_UUR_MIN} tot en met ${OCHTEND_UUR_MAX}; daarbuiten komt de wekker niet langs.`)
    }
    void doe('mail', async () => {
      await zetInstelling(SLEUTELS.trucksupplyMail, adres)
      await zetInstelling(SLEUTELS.trucksupplyOchtendUur, String(u))
    }, 'Mailinstellingen opgeslagen')
  }

  const uurTekst = `${String(Number(uur) || 0).padStart(2, '0')}:00`
  // Zonder leesrecht is wat hier staat de terugval, niet wat er op de server
  // staat; dan noemen we het adres en het uur niet alsof we ze kennen.
  const mailNaam = magSchrijven ? (mail || 'het mailadres hierboven') : 'het ingestelde adres'
  const uurNaam = magSchrijven ? uurTekst : 'het ingestelde uur'

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Mail" hint="Waar de alarmen heen gaan">
          {!magSchrijven && (
            <div className="waarschuwing zacht mb">
              <Lock size={16} />
              <span>
                Deze instellingen mogen alleen Trucksshop en het management lezen en wijzigen.
                Wat hieronder staat is de standaardwaarde, niet per se wat er is ingesteld; de meldingen
                gaan naar het adres dat daar is gezet. Wil je het adres of het uur anders, vraag het aan
                Trucksshop of het management.
              </span>
            </div>
          )}
          <fieldset className="ts-veldset" disabled={!geladen || !magSchrijven}>
            <Field label="Mailadres van Trucksshop" help="Elke directe melding en de ochtendmail gaan hierheen. Eén adres; een groepsadres is prima.">
              <input className="input" type="email" value={mail} onChange={(e) => setMail(e.target.value)} />
            </Field>
            <Field label="Uur van de ochtendmail" help={`Nederlandse tijd, ook in de zomer; van ${OCHTEND_UUR_MIN} tot en met ${OCHTEND_UUR_MAX} uur. De mail vertrekt in het kwartier na het hele uur.`}>
              <div className="row">
                <input className="input" inputMode="numeric" value={uur} onChange={(e) => setUur(e.target.value)} style={{ width: 90 }} />
                <span className="ts-sub">uur, dus rond {uurTekst}</span>
              </div>
            </Field>
          </fieldset>
          <div className="row end">
            <button
              className="btn sm"
              disabled={bezig !== null}
              onClick={() => void doe('proef', testMail, magSchrijven ? `Proefmail gestuurd naar ${mail}` : 'Proefmail gestuurd naar het ingestelde adres')}
            >
              {bezig === 'proef' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Proefmail sturen
            </button>
            {magSchrijven && (
              <button className="btn primary sm" disabled={bezig !== null || !geladen} onClick={mailOpslaan}>
                {bezig === 'mail' ? <Loader2 size={14} className="spin" /> : <Mail size={14} />} Opslaan
              </button>
            )}
          </div>
        </Card>

        <Card title="Hoe de alarmen werken" className="mt">
          <ol className="ts-uitleg">
            <li>
              <BellRing size={15} />
              <span>
                <strong>Een alarm ontstaat in de database</strong> zodra de stand van een artikel onder zijn minimum zakt --
                door de kassa, door verbruik op de vloer, of door een correctie. Komt de stand er weer boven, dan is het alarm opgelost.
              </span>
            </li>
            <li>
              <Send size={15} />
              <span>
                <strong>Direct</strong>: binnen een kwartier gaat er een mail met alle nieuwe alarmen, per vestiging gegroepeerd, naar {mailNaam}.
              </span>
            </li>
            <li>
              <Mail size={15} />
              <span>
                <strong>Ochtendmail</strong>: elke dag rond {uurNaam} één overzicht van alles wat nog openstaat en dat niemand heeft gezien.
              </span>
            </li>
            <li>
              <RefreshCw size={15} />
              <span>
                <strong>Gezien</strong> zet je in de voorraad op een alarm. De stand is dan nog steeds te laag, maar de ochtendmail begint er niet
                nog eens over. Zet je de bestelling op verzonden, dan wordt de voorraad bijgeboekt en gaat het alarm vanzelf uit.
              </span>
            </li>
          </ol>
        </Card>
      </div>

      <div>
        <Card
          title="Exact Online"
          hint="Boekhouding"
          action={
            <button className="btn ghost sm" onClick={() => void exactOphalen()} title="Status opnieuw ophalen"><RefreshCw size={14} /></button>
          }
        >
          <div className="row" style={{ marginBottom: 14 }}>
            {exact === null && !exactFout && <Badge>status ophalen…</Badge>}
            {exactFout && <Badge tone="warn">status onbekend</Badge>}
            {exact && (exact.verbonden ? <Badge tone="ok" dot>gekoppeld</Badge> : <Badge tone="warn" dot>niet gekoppeld</Badge>)}
            {exact?.division && <span className="ts-sub">administratie {exact.division}</span>}
            {exact?.verlooptAt && <span className="ts-sub">token tot {dateTime(exact.verlooptAt)}</span>}
          </div>
          {exactFout && <p className="ts-sub" style={{ marginTop: 0 }}>{exactFout}</p>}
          {exact?.laatsteFout && (
            <div className="waarschuwing zacht mb"><span>Laatste fout: {exact.laatsteFout}</span></div>
          )}

          <Field
            label="Division (administratienummer)"
            help={magSchrijven
              ? 'Het nummer van de administratie in Exact. Staat in Exact onder Administratie > Instellingen.'
              : 'Het nummer van de administratie in Exact. Alleen Trucksshop en het management kunnen dit hier zetten; de status hierboven toont wat de server kent.'}
          >
            <div className="row">
              <input className="input" value={division} onChange={(e) => setDivision(e.target.value)} placeholder="1234567" style={{ flex: 1 }} disabled={!magSchrijven} />
              {magSchrijven && (
                <button className="btn sm" disabled={bezig !== null} onClick={() => void doe('division', () => zetInstelling(SLEUTELS.exactDivision, division.trim()), 'Division opgeslagen')}>
                  Opslaan
                </button>
              )}
            </div>
          </Field>

          <div className="row">
            <button
              className="btn primary sm"
              disabled={bezig !== null}
              onClick={() => void doe('verbind', async () => {
                const url = await exactVerbindUrl()
                const venster = window.open(url, '_blank', 'noopener')
                if (!venster) toast.warn('Het venster werd geblokkeerd. Sta pop-ups toe en probeer opnieuw.')
              })}
            >
              {bezig === 'verbind' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
              {exact?.verbonden ? 'Opnieuw koppelen' : 'Koppelen met Exact'} <ExternalLink size={12} />
            </button>
            {exact?.verbonden && (
              <button
                className="btn danger sm"
                disabled={bezig !== null}
                onClick={() => {
                  if (!confirm('De koppeling met Exact losmaken? De tokens worden gewist.')) return
                  void doe('los', async () => { await exactLos(); await exactOphalen() }, 'Koppeling losgemaakt')
                }}
              >
                {bezig === 'los' ? <Loader2 size={14} className="spin" /> : <Link2Off size={14} />} Loskoppelen
              </button>
            )}
          </div>

          <p className="ts-sub" style={{ marginTop: 14, marginBottom: 0 }}>
            Eerlijk is eerlijk: de koppeling verbindt nu alleen en houdt het token bij. Er worden nog geen artikelen,
            bestellingen of facturen naar Exact gestuurd -- dat komt in een volgende stap. Na het koppelen in het nieuwe
            venster: klik hier op het pijltje om de status te verversen.
          </p>
        </Card>
      </div>
    </div>
  )
}
