import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { useUpdates } from '../lib/updates'

/**
 * Verschijnt onderin zodra er een nieuwe versie klaarstaat.
 * Windows: installeren en herstarten. Mobiel: nieuwe bundel activeren.
 */
export default function UpdateBanner() {
  const { state, newVersion, percent, install } = useUpdates()
  const visible = state === 'downloading' || state === 'ready' || state === 'available'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(20px + var(--safe-bottom))',
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '11px 16px',
            borderRadius: 999,
            background: 'var(--surface-2)',
            border: '1px solid var(--brand)',
            boxShadow: '0 10px 34px rgba(0,0,0,.5)',
            fontSize: '.86rem',
            maxWidth: 'calc(100vw - 28px)',
          }}
        >
          {state === 'ready' ? <Sparkles size={16} color="var(--accent)" />
            : <Download size={16} color="var(--brand)" />}

          <span>
            {state === 'ready'
              ? `Versie ${newVersion ?? 'nieuw'} staat klaar`
              : state === 'downloading'
                ? `Update downloaden… ${percent}%`
                : `Nieuwe versie gevonden${newVersion ? ` (${newVersion})` : ''}`}
          </span>

          {state === 'downloading' && (
            <div className="bar" style={{ width: 90 }}>
              <span style={{ width: `${percent}%` }} />
            </div>
          )}

          {state === 'ready' && (
            <button className="btn primary sm" onClick={() => void install()}>
              <RefreshCw size={14} /> Nu installeren
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
