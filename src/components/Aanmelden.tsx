import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle, ArrowLeft, Building2, CheckCircle2, Eye, EyeOff, HardHat,
  Loader2, MailCheck, UserPlus,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { emailLooksValid, passwordProblem, register } from '../lib/signups'
import { SIGNUP_KINDS, type Location, type SignupKind } from '../lib/types'
import Logo from './Logo'

/* ------------------------------------------------------------------ *
 *  Zelf aanmelden
 *
 *  Wat hier gebeurt is precies één ding: een inlogaccount aanmaken. Dat is
 *  het enige wat iemand zonder toegang mag, en het levert nog geen toegang
 *  op. Het management ziet de aanmelding en bepaalt wat diegene wordt.
 *
 *  Daarom staat dat hier ook zo op het scherm. Wie denkt dat hij er na het
 *  aanmelden meteen in kan, meldt zich morgen opnieuw aan.
 * ------------------------------------------------------------------ */

const KIND_ICON: Record<SignupKind, typeof HardHat> = {
  werknemer: HardHat,
  klant: Building2,
}

export default function Aanmelden({ onBack }: { onBack: () => void }) {
  const locations = useLiveQuery(
    async () => (await db.locations.toArray()).filter((l) => l.active),
    [],
    [] as Location[],
  )

  const [kind, setKind] = useState<SignupKind>('werknemer')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<null | { confirm: boolean }>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (name.trim().split(/\s+/).length < 2) {
      return setError('Vul je voor- en achternaam in.')
    }
    if (!emailLooksValid(email)) {
      return setError('Vul een geldig e-mailadres in.')
    }
    if (kind === 'klant' && !companyName.trim()) {
      return setError('Vul de naam van je bedrijf in.')
    }
    const wachtwoord = passwordProblem(password)
    if (wachtwoord) return setError(wachtwoord)
    if (password !== again) return setError('De twee wachtwoorden zijn niet gelijk.')

    setBusy(true)
    try {
      const res = await register({
        name, email, password, phone,
        kind,
        companyName: kind === 'klant' ? companyName : undefined,
        locationId: kind === 'werknemer' ? locationId || undefined : undefined,
        message,
      })
      if (!res.ok) return setError(res.error ?? 'Aanmelden mislukt.')
      setKlaar({ confirm: res.needsConfirmation })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------- gelukt ---------------------------- */

  if (klaar) {
    return (
      <div className="auth-screen">
        <motion.div
          className="auth-card"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
        >
          <div className="auth-logo">
            <Logo width={190} />
            <div className="sub">Aanmelding verstuurd</div>
          </div>

          <div className="signup-done">
            <CheckCircle2 size={40} />
            <h2>Dank je wel, {name.trim().split(' ')[0]}</h2>
            <p>
              Je aanmelding staat klaar bij het kantoor. Zodra iemand je heeft
              toegelaten krijg je bericht op <strong>{email.trim().toLowerCase()}</strong> en
              kun je inloggen met het wachtwoord dat je net hebt gekozen.
            </p>

            {klaar.confirm && (
              <div className="signup-note">
                <MailCheck size={16} />
                <span>
                  We hebben je eerst een mail gestuurd om te controleren of dit
                  adres van jou is. Klik daar op de link; anders kunnen we je
                  niet toelaten.
                </span>
              </div>
            )}

            <p className="signup-fine">
              Tot je bent toegelaten kom je nog niet in de app. Dat is geen fout —
              een account is nog geen toegang.
            </p>
          </div>

          <button className="btn block lg" onClick={onBack}>
            <ArrowLeft size={16} /> Terug naar inloggen
          </button>
        </motion.div>
      </div>
    )
  }

  /* ---------------------------- formulier -------------------------- */

  return (
    <div className="auth-screen">
      <motion.form
        className="auth-card wide"
        onSubmit={submit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
      >
        <div className="auth-logo">
          <Logo width={190} />
          <div className="sub">Aanmelden</div>
        </div>

        {error && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label>Wie ben je?</label>
          <div className="kind-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {(Object.keys(SIGNUP_KINDS) as SignupKind[]).map((k) => {
              const Icon = KIND_ICON[k]
              return (
                <button
                  key={k}
                  type="button"
                  className={`kind ${kind === k ? 'on' : ''}`}
                  onClick={() => setKind(k)}
                >
                  <Icon size={18} />
                  <strong>{SIGNUP_KINDS[k].label}</strong>
                  <span>{SIGNUP_KINDS[k].hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
          <div className="field">
            <label htmlFor="su-naam">Voor- en achternaam</label>
            <input
              id="su-naam" className="input" value={name} autoComplete="name"
              onChange={(e) => setName(e.target.value)} disabled={busy}
              placeholder="Jan de Vries"
            />
          </div>
          <div className="field">
            <label htmlFor="su-tel">Telefoon</label>
            <input
              id="su-tel" className="input" value={phone} autoComplete="tel"
              inputMode="tel"
              onChange={(e) => setPhone(e.target.value)} disabled={busy}
              placeholder="06-12345678"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="su-mail">E-mailadres</label>
          <input
            id="su-mail" className="input" type="email" value={email}
            autoComplete="email" inputMode="email"
            onChange={(e) => setEmail(e.target.value)} disabled={busy}
            placeholder={kind === 'werknemer' ? 'naam@truckwash1group.nl' : 'naam@bedrijf.nl'}
          />
          <span className="help">Hierop krijg je bericht en hiermee log je later in.</span>
        </div>

        {kind === 'klant' ? (
          <div className="field">
            <label htmlFor="su-bedrijf">Bedrijfsnaam</label>
            <input
              id="su-bedrijf" className="input" value={companyName}
              autoComplete="organization"
              onChange={(e) => setCompanyName(e.target.value)} disabled={busy}
              placeholder="Transport Jansen BV"
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="su-vestiging">Op welke vestiging werk je?</label>
            <select
              id="su-vestiging" className="select" value={locationId}
              onChange={(e) => setLocationId(e.target.value)} disabled={busy}
            >
              <option value="">Weet ik nog niet</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <span className="help">
              Het kantoor kan dit later aanpassen; je kunt ook op meerdere
              vestigingen worden ingedeeld.
            </span>
          </div>
        )}

        <div className="grid cols-2" style={{ gap: 0, columnGap: 12 }}>
          <div className="field">
            <label htmlFor="su-ww">Wachtwoord</label>
            <div style={{ position: 'relative' }}>
              <input
                id="su-ww" className="input" type={show ? 'text' : 'password'}
                autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} disabled={busy}
                style={{ paddingRight: 42 }}
              />
              <button
                type="button" className="btn ghost sm"
                onClick={() => setShow((v) => !v)}
                style={{ position: 'absolute', right: 4, top: 4 }}
                aria-label={show ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <span className="help">Minstens tien tekens, met letters en cijfers.</span>
          </div>
          <div className="field">
            <label htmlFor="su-ww2">Nog een keer</label>
            <input
              id="su-ww2" className="input" type={show ? 'text' : 'password'}
              autoComplete="new-password" value={again}
              onChange={(e) => setAgain(e.target.value)} disabled={busy}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="su-bericht">Iets wat we moeten weten? (optioneel)</label>
          <textarea
            id="su-bericht" className="textarea" value={message} maxLength={600}
            style={{ minHeight: 74 }}
            onChange={(e) => setMessage(e.target.value)} disabled={busy}
            placeholder="Bijv. wie je contactpersoon is, of vanaf wanneer je begint"
          />
        </div>

        <div className="signup-note">
          <AlertCircle size={16} />
          <span>
            Aanmelden geeft nog geen toegang. Iemand van het kantoor kijkt
            ernaar en bepaalt wat je te zien krijgt.
          </span>
        </div>

        <button className="btn primary block lg" type="submit" disabled={busy}>
          {busy ? <Loader2 size={17} className="spin" /> : <UserPlus size={17} />}
          {busy ? 'Bezig met aanmelden…' : 'Aanmelding versturen'}
        </button>

        <button className="btn ghost block" type="button" onClick={onBack} disabled={busy}>
          <ArrowLeft size={15} /> Ik heb al een account
        </button>
      </motion.form>
    </div>
  )
}
