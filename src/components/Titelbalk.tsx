import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import Logo from './Logo'
import { useUpdates } from '../lib/updates'

/* ------------------------------------------------------------------ *
 *  De titelbalk
 *
 *  Het venster heeft geen rand meer van Windows. Wat je bovenaan ziet is
 *  deze balk, in de kleuren van de app zelf.
 *
 *  Waarom dat de moeite waard was: de grijze balk met het kleine icoontje en
 *  het menu "Bestand / Beeld" was het enige stuk van het scherm dat er niet
 *  uitzag alsof het bij Truckwash1 hoorde. Op een tablet aan de balie viel
 *  dat meteen op -- daar heeft niets anders een titelbalk.
 *
 *  Twee dingen zijn hierbij belangrijk en onzichtbaar. Het slepen gebeurt
 *  met -webkit-app-region, en dat is een eigenschap die alles wat eronder
 *  valt ook onklikbaar maakt -- dus staan de knoppen er expliciet weer uit.
 *  En dubbelklikken op de balk hoort te maximaliseren, want dat is wat
 *  iedereen bij een titelbalk gewend is.
 * ------------------------------------------------------------------ */

export default function Titelbalk() {
  const [er, setEr] = useState(false)
  const [max, setMax] = useState(false)
  const versie = useUpdates((s) => s.version)

  useEffect(() => {
    const brug = window.desktop
    if (!brug?.venster) return

    setEr(true)
    document.documentElement.classList.add('eigen-titelbalk')

    void brug.venster.isMax().then(setMax)
    const stop = brug.venster.onMax(setMax)

    return () => {
      stop?.()
      document.documentElement.classList.remove('eigen-titelbalk')
    }
  }, [])

  if (!er) return null
  const venster = window.desktop!.venster!

  return (
    <div
      className="titelbalk"
      onDoubleClick={() => void venster.maximaliseren()}
    >
      <Logo width={104} />
      <span className="titelbalk-versie">{versie ? `v${versie}` : ''}</span>

      {/* Het sleepgebied. Alles wat hier niet in zit is klikbaar. */}
      <span className="titelbalk-sleep" />

      <div className="titelbalk-knoppen">
        <button
          onClick={() => void venster.minimaliseren()}
          aria-label="Minimaliseren"
          title="Minimaliseren"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => void venster.maximaliseren()}
          aria-label={max ? 'Verkleinen' : 'Maximaliseren'}
          title={max ? 'Verkleinen' : 'Maximaliseren'}
        >
          {max ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          className="sluit"
          onClick={() => void venster.sluiten()}
          aria-label="Sluiten"
          title="Sluiten"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
