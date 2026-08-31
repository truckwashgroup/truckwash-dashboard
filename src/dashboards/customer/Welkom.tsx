import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Building2, CheckCircle2, Clock, Loader2, Mail, MapPin, Phone, Send, Truck,
} from 'lucide-react'
import { db } from '../../lib/db'
import { notifications } from '../../lib/repo'
import { SERVICES, type Location, type User } from '../../lib/types'
import { money } from '../../lib/format'
import { Card, Empty, Field } from '../../components/ui'
import { useAuth } from '../../store/useAuth'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Welkom voor een klant zonder gekoppeld bedrijf
 *
 *  Wat er misging: een klant die zojuist was toegelaten kwam in een
 *  dashboard waar alles leeg was. Geen wasbeurten, geen facturen, geen
 *  uitleg -- alsof de app stuk was. Terwijl er niets stuk was: zijn account
 *  hing alleen nog nergens aan.
 *
 *  Dit scherm zegt dat gewoon, en geeft hem meteen iets te doen: zijn
 *  bedrijfsgegevens doorgeven, zodat het kantoor de koppeling kan maken.
 *  Ondertussen ziet hij al wel wat er te krijgen is en waar.
 * ------------------------------------------------------------------ */

export default function Welkom() {
  const me = useAuth((s) => s.user)!

  const locaties = useLiveQuery(
    async () => (await db.locations.toArray())
      .filter((l) => l.active && l.kind === 'vestiging')
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
    [] as Location[],
  )

  const [bedrijf, setBedrijf] = useState('')
  const [plaats, setPlaats] = useState('')
  const [wagens, setWagens] = useState('')
  const [toelichting, setToelichting] = useState('')
  const [bezig, setBezig] = useState(false)
  const [verstuurd, setVerstuurd] = useState(false)

  const bazen = useLiveQuery(
    async () => (await db.users.toArray()).filter(
      (u) => u.active && u.roles.includes('management')),
    [],
    [] as User[],
  )

  async function doorgeven() {
    if (bedrijf.trim().length < 2) return toast.error('Vul de naam van je bedrijf in')

    setBezig(true)
    try {
      const regels = [
        `Bedrijf: ${bedrijf.trim()}`,
        plaats.trim() ? `Plaats: ${plaats.trim()}` : null,
        wagens.trim() ? `Wagens: ${wagens.trim()}` : null,
        toelichting.trim() ? toelichting.trim() : null,
      ].filter(Boolean).join(' · ')

      for (const baas of bazen) {
        await notifications.send({
          to: { id: baas.id, name: baas.name },
          from: me,
          kind: 'taak',
          title: `${me.name} wil gekoppeld worden aan een bedrijf`,
          body: regels,
          link: 'personeel',
          mail: true,
        })
      }

      setVerstuurd(true)
      toast.ok('Doorgegeven — het kantoor neemt contact met je op')
    } finally {
      setBezig(false)
    }
  }

  const diensten = useMemo(
    () => (Object.keys(SERVICES) as (keyof typeof SERVICES)[]).map((k) => ({
      key: k, ...SERVICES[k],
    })),
    [],
  )

  return (
    <>
      <Card>
        <div className="klant-welkom">
          <div className="ico"><CheckCircle2 size={30} /></div>
          <div>
            <h2>Welkom, {me.name.split(' ')[0]}</h2>
            <p>
              Je account werkt. Wat er nog moet gebeuren is dat we je aan je
              bedrijf koppelen — daarna zie je hier je wasbeurten, je historie
              en je facturen.
            </p>
            <p className="klein">
              Dat doet het kantoor; het is geen fout aan jouw kant. Geef hieronder
              door om welk bedrijf het gaat, dan gaat het sneller.
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------ Gegevens doorgeven ----------------- */}

      <Card title="Om welk bedrijf gaat het?" className="mt">
        {verstuurd ? (
          <div className="signup-note">
            <CheckCircle2 size={16} />
            <span>
              Doorgegeven. Zodra iemand van het kantoor de koppeling heeft
              gemaakt verandert dit scherm vanzelf — je hoeft niets te doen.
            </span>
          </div>
        ) : (
          <>
            <div className="grid cols-2">
              <Field label="Bedrijfsnaam">
                <input
                  className="input" value={bedrijf}
                  onChange={(e) => setBedrijf(e.target.value)}
                  placeholder="Transport Jansen BV"
                />
              </Field>
              <Field label="Plaats">
                <input
                  className="input" value={plaats}
                  onChange={(e) => setPlaats(e.target.value)}
                  placeholder="Utrecht"
                />
              </Field>
            </div>

            <Field label="Hoeveel wagens ongeveer?" help="Handig voor een passende afspraak.">
              <input
                className="input" value={wagens} inputMode="numeric"
                onChange={(e) => setWagens(e.target.value)}
                placeholder="12"
              />
            </Field>

            <Field label="Iets wat we moeten weten? (optioneel)">
              <textarea
                className="textarea" style={{ minHeight: 70 }}
                value={toelichting}
                onChange={(e) => setToelichting(e.target.value)}
                placeholder="Bijv. vaste dag, of wie je contactpersoon is"
              />
            </Field>

            <div className="row end">
              <button className="btn primary" onClick={() => void doorgeven()} disabled={bezig}>
                {bezig ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                Doorgeven
              </button>
            </div>
          </>
        )}
      </Card>

      {/* --------------------------- Wat we doen --------------------- */}

      <Card title="Wat we doen" hint="Prijzen zijn exclusief btw" flush className="mt">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Behandeling</th>
                <th className="num">Duur</th>
                <th className="num">Vanaf</th>
              </tr>
            </thead>
            <tbody>
              {diensten.map((d) => (
                <tr key={d.key}>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <Truck size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
                      <strong>{d.label}</strong>
                    </div>
                  </td>
                  <td className="num">
                    <span className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
                      <Clock size={13} style={{ color: 'var(--text-3)' }} />
                      {d.minutes} min
                    </span>
                  </td>
                  <td className="num">{money(d.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* -------------------------- Waar we zitten ------------------- */}

      <Card
        title="Waar we zitten"
        hint={`${locaties.length} vestigingen`}
        flush
        className="mt"
      >
        {locaties.length === 0 ? (
          <Empty text="De vestigingen worden opgehaald…" icon={<MapPin size={30} />} />
        ) : (
          <div className="vestiging-lijst">
            {locaties.map((l) => (
              <div key={l.id} className="vestiging">
                <span className="ico"><MapPin size={16} /></span>
                <span className="tekst">
                  <strong>{l.name}</strong>
                  <span>{l.address}, {l.postcode} {l.city}</span>
                </span>
                {l.phone && (
                  <a className="btn ghost sm" href={`tel:${l.phone.replace(/\s/g, '')}`}>
                    <Phone size={13} /> {l.phone}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <Building2 size={17} style={{ color: 'var(--brand)', flex: 'none', marginTop: 2 }} />
          <div style={{ fontSize: '.85rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            <strong>Liever even bellen of mailen?</strong>
            <div style={{ marginTop: 4 }}>
              Neem contact op met de vestiging waar je normaal komt, of mail naar{' '}
              <span className="mono" style={{ color: 'var(--text)' }}>
                <Mail size={12} style={{ verticalAlign: -2 }} /> info@truckwash1group.nl
              </span>
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}
