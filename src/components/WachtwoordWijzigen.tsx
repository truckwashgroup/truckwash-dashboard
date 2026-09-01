import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle, Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck,
} from 'lucide-react'
import { supabase, supabaseConfigured } from '../lib/api/supabaseApi'
import { users as userRepo } from '../lib/repo'
import { setMeta } from '../lib/db'
import { WELKOM_KLAAR } from '../lib/welkom'
import { passwordProblem } from '../lib/signups'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'
import Logo from './Logo'

/* ------------------------------------------------------------------ *
 *  Zelf een wachtwoord kiezen
 *
 *  Voor wie is uitgenodigd door een werkgever: die kreeg een tijdelijk
 *  wachtwoord per mail, en dat is precies wat het is -- tijdelijk.
 *
 *  Een wachtwoord dat per mail is verstuurd staat in het postvak van de
 *  ontvanger, in dat van de afzender, en op elke server ertussenin. Het is
 *  goed genoeg om één keer binnen te komen en verder niets.
 *
 *  Dit scherm is niet weg te klikken. Overslaan zou betekenen dat het bij
 *  een deel van de mensen blijft staan, en juist bij dat deel gaat het mis.
 * ------------------------------------------------------------------ */

export default function WachtwoordWijzigen() {
  const { user, logout, herlaadProfiel } = useAuth()
  const [nieuw, setNieuw] = useState('')
  const [nogmaals, setNogmaals] = useState('')
  const [toon, setToon] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const probleem = nieuw ? passwordProblem(nieuw) : null

  async function opslaan(e: FormEvent) {
    e.preventDefault()
    setFout(null)

    if (probleem) return setFout(probleem)
    if (nieuw !== nogmaals) return setFout('De twee wachtwoorden zijn niet gelijk.')
    if (!supabaseConfigured) return setFout('Er is geen verbinding met de database.')

    setBezig(true)
    try {
      const { error } = await supabase().auth.updateUser({ password: nieuw })
      if (error) {
        // Supabase weigert een wachtwoord dat gelijk is aan het oude.
        setFout(/same.*password|should be different/i.test(error.message)
          ? 'Kies een ander wachtwoord dan het tijdelijke dat je hebt gekregen.'
          : error.message)
        return
      }

      if (user) await userRepo.update(user.id, { mustChangePassword: false })

      /*
       * Dit is het enige moment waarop we zeker weten dat iemand nieuw is:
       * uitgenodigd, binnengekomen met een tijdelijk wachtwoord en nu zijn
       * eigen gekozen. Dat leggen we vast en houden we niet in het geheugen
       * van dit scherm -- ververst hij halverwege, dan hoort het welkom er
       * daarna nog te zijn.
       */
      if (user) await setMeta(WELKOM_KLAAR, user.id)

      await herlaadProfiel()

      toast.ok('Je wachtwoord is gewijzigd')
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Wijzigen mislukt')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="auth-screen">
      <motion.form
        className="auth-card"
        onSubmit={opslaan}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
      >
        <div className="auth-logo">
          <Logo width={190} />
          <div className="sub">Kies je wachtwoord</div>
        </div>

        <div className="signup-note">
          <ShieldCheck size={16} />
          <span>
            Je bent binnengekomen met een tijdelijk wachtwoord uit een mail.
            Dat werkt precies één keer — kies hier je eigen wachtwoord, dan is
            het van jou en van niemand anders.
          </span>
        </div>

        {fout && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{fout}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="ww-nieuw">Nieuw wachtwoord</label>
          <div style={{ position: 'relative' }}>
            <input
              id="ww-nieuw"
              className={`input ${nieuw && probleem ? 'fout' : ''}`}
              type={toon ? 'text' : 'password'}
              autoComplete="new-password"
              value={nieuw}
              onChange={(e) => setNieuw(e.target.value)}
              disabled={bezig}
              autoFocus
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setToon((v) => !v)}
              style={{ position: 'absolute', right: 4, top: 4 }}
              aria-label={toon ? 'Verbergen' : 'Tonen'}
            >
              {toon ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <span className="help">
            {probleem ?? 'Minstens tien tekens, met letters en cijfers.'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="ww-nogmaals">Nog een keer</label>
          <input
            id="ww-nogmaals"
            className="input"
            type={toon ? 'text' : 'password'}
            autoComplete="new-password"
            value={nogmaals}
            onChange={(e) => setNogmaals(e.target.value)}
            disabled={bezig}
          />
        </div>

        <button
          className="btn primary block lg"
          type="submit"
          disabled={bezig || !nieuw || !nogmaals}
        >
          {bezig ? <Loader2 size={17} className="spin" /> : <KeyRound size={17} />}
          {bezig ? 'Bezig…' : 'Wachtwoord instellen'}
        </button>

        <div className="auth-alt">
          <span>{user?.email}</span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void logout()}
            disabled={bezig}
          >
            <LogOut size={14} /> Uitloggen
          </button>
        </div>
      </motion.form>
    </div>
  )
}
