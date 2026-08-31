import logoUrl from '../assets/logo.webp'
import { useTheme } from '../lib/theme'

/**
 * Het merklogo.
 *
 * Het bestand heeft een transparante achtergrond en is getekend voor een
 * donker vlak: de witte delen erin verdwijnen op wit. In de lichte modus
 * zetten we er daarom een donker vlakje onder, in plaats van het logo te
 * verkleuren -- dat laatste zou het merk aantasten.
 */
export default function Logo({
  width = 168,
  className,
}: {
  width?: number
  className?: string
}) {
  const licht = useTheme((s) => s.actief) === 'licht'

  return (
    <span
      className={`logo-vlak ${licht ? 'op-licht' : ''} ${className ?? ''}`}
      style={{ width, display: 'block' }}
    >
      <img
        src={logoUrl}
        alt="Truckwash1 Group"
        width={width}
        height={Math.round((width / 250) * 70)}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        draggable={false}
      />
    </span>
  )
}
