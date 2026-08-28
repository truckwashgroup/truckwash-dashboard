import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Eye, EyeOff, Loader2, LogIn, WifiOff } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../lib/sync'
import { useUpdates } from '../lib/updates'
import { DEMO_ACCOUNTS, configError } from '../lib/api'
import Logo from './Logo'

export default function Login() {
  const { login, busy, error } = useAuth()
  const online = useSync((s) => s.online)
  const { version, channel } = useUpdates()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    await login(email, password)
  }

  return (
    <div className="auth-screen">
      <motion.form
        className="auth-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
      >
        <div className="auth-logo">
          <Logo width={190} />
          <div className="sub">Dashboard</div>
        </div>

        {!online && (
          <div className="auth-error" style={{ background: 'rgba(245,181,68,.1)', borderColor: 'rgba(245,181,68,.32)', color: '#ffd894' }}>
            <WifiOff size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              Geen verbinding. Je kunt inloggen met een account dat eerder op dit
              apparaat is gebruikt.
            </span>
          </div>
        )}

        {configError && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              <strong>Instellingsfout.</strong> {configError} De app gebruikt
              nu de ingebouwde testgegevens.
            </span>
          </div>
        )}

        {error && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">E-mailadres</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="naam@truckwash1group.nl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <div style={{ position: 'relative' }}>
            <input
              id="password"
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setShow((v) => !v)}
              style={{ position: 'absolute', right: 4, top: 4 }}
              aria-label={show ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <button className="btn primary block lg" type="submit" disabled={busy || !email || !password}>
          {busy ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />}
          {busy ? 'Bezig met inloggen…' : 'Inloggen'}
        </button>

        <div className="auth-foot">
          <div className="title">Testaccounts</div>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              type="button"
              className="demo-account"
              onClick={() => { setEmail(a.email); setPassword(a.password) }}
              disabled={busy}
            >
              <span className="who">{a.email}</span>
              <span className="what">{a.label}</span>
            </button>
          ))}
        </div>

        <div className="auth-meta">
          <span>Versie {version}</span>
          <span>·</span>
          <span>
            {channel === 'windows' ? 'Windows' : channel === 'mobile' ? 'Mobiel' : 'Web'}
          </span>
          <span>·</span>
          <span>{online ? 'Online' : 'Offline'}</span>
        </div>
      </motion.form>
    </div>
  )
}
