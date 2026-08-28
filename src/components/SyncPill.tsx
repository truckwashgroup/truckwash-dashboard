import { CloudOff, RefreshCw, Cloud, CloudUpload, AlertTriangle } from 'lucide-react'
import { useSync } from '../lib/sync'
import { relative } from '../lib/format'

/**
 * Toont in één oogopslag of er verbinding is en hoeveel wijzigingen er nog
 * in de wachtrij staan. Klikken forceert een synchronisatie.
 */
export default function SyncPill({ compact = false }: { compact?: boolean }) {
  const { online, syncing, pending, lastSyncAt, lastError, sync } = useSync()

  const cls = syncing ? 'syncing' : !online ? 'offline' : lastError ? 'error' : ''

  const icon = syncing
    ? <RefreshCw size={13} className="spin" />
    : !online
      ? <CloudOff size={13} />
      : pending > 0
        ? <CloudUpload size={13} />
        : lastError
          ? <AlertTriangle size={13} />
          : <Cloud size={13} />

  const label = syncing
    ? 'Synchroniseren…'
    : !online
      ? pending > 0 ? `Offline · ${pending} in wachtrij` : 'Offline'
      : pending > 0
        ? `${pending} te versturen`
        : lastError
          ? 'Sync mislukt'
          : 'Gesynchroniseerd'

  const title = [
    online ? 'Verbonden met de server' : 'Geen verbinding — wijzigingen worden lokaal bewaard',
    pending > 0 ? `${pending} wijziging(en) wachten op verzending` : null,
    lastSyncAt ? `Laatste sync ${relative(lastSyncAt)}` : 'Nog niet gesynchroniseerd',
    lastError ? `Fout: ${lastError}` : null,
  ].filter(Boolean).join('\n')

  return (
    <button
      className={`sync-pill ${cls}`}
      onClick={() => void sync()}
      title={title}
      disabled={syncing}
    >
      <span className="dot" />
      {icon}
      {!compact && <span>{label}</span>}
    </button>
  )
}
