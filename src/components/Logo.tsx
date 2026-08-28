import logoUrl from '../assets/logo.webp'

/**
 * Het merklogo. Het bestand heeft een transparante achtergrond en is bedoeld
 * voor donkere vlakken — precies wat dit thema is.
 */
export default function Logo({
  width = 168,
  className,
}: {
  width?: number
  className?: string
}) {
  return (
    <img
      src={logoUrl}
      alt="Truckwash1 Group"
      width={width}
      height={Math.round((width / 250) * 70)}
      className={className}
      style={{ display: 'block', width, height: 'auto' }}
      draggable={false}
    />
  )
}
