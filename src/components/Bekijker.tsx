import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Download, FileQuestion, Loader2,
  Minus, Plus, ShieldX, X,
} from 'lucide-react'
import {
  grootteVan, haalBytes, haalTekst, MAX_TONEN, soortVan, TeGroot, watIsDit,
  type Bekijkbaar, type BestandSoort,
} from '../lib/bekijken'
import { laadPdfjs } from '../lib/pdf'

import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  De bestandenkijker
 *
 *  Eén scherm voor alles wat je in deze app kunt openen: bijlagen bij post,
 *  de bon die eraan hangt, en de stukken in een personeelsdossier.
 *
 *  Waarom het zelf tekenen en niet aan het systeem overlaten: een nieuw
 *  venster wordt in de Electron-schil tegengehouden en doet op de tablet
 *  niets. Bovendien is dit veiliger. Een PDF gaat door pdf.js op een canvas
 *  en niet door een lezer die er van alles mee mag; wat we niet herkennen
 *  tonen we helemaal niet, dat bieden we aan om op te slaan.
 * ------------------------------------------------------------------ */

/*
 * Een bestand dat zich voordoet als PDF maar het niet is.
 *
 * Een eigen soort fout, zodat de melding die erbij hoort niet wordt
 * overschreven door het algemene "deze PDF is niet te openen".
 */
class GeenPdf extends Error {}

interface Props {
  bestanden: Bekijkbaar[]
  /** Welke er open staat; null is dicht. */
  index: number | null
  onSluiten: () => void
  onWissel: (index: number) => void
}

export default function Bekijker({ bestanden, index, onSluiten, onWissel }: Props) {
  const open = index !== null && !!bestanden[index]
  const bestand = open ? bestanden[index] : null

  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [tekst, setTekst] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  const soort: BestandSoort = bestand
    ? soortVan(bestand.naam, bestand.mime)
    : 'onbekend'

  /* ---- ophalen ---------------------------------------------------- */

  useEffect(() => {
    if (!bestand) return
    let weg = false
    let eigenUrl: string | null = null

    setBezig(true); setFout(null); setTekst(null); setZoom(1)
    setBlobUrl((oud) => { if (oud) URL.revokeObjectURL(oud); return null })

    void (async () => {
      try {
        if (bestand.geblokkeerd) throw new Error(bestand.geblokkeerd)
        if (bestand.size !== undefined && bestand.size > MAX_TONEN) {
          throw new TeGroot(bestand.size)
        }

        const adres = await bestand.haal()
        const blob = await haalBytes(adres)
        if (weg) return

        if (soortVan(bestand.naam, bestand.mime) === 'tekst') {
          setTekst(await haalTekst(blob))
        }
        eigenUrl = URL.createObjectURL(blob)
        if (weg) { URL.revokeObjectURL(eigenUrl); return }
        setBlobUrl(eigenUrl)
      } catch (e) {
        if (!weg) setFout(e instanceof Error ? e.message : 'Openen lukte niet')
      } finally {
        if (!weg) setBezig(false)
      }
    })()

    return () => {
      weg = true
      if (eigenUrl) URL.revokeObjectURL(eigenUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestand?.naam, bestand?.mime, bestand?.size, index])

  /* ---- toetsen ---------------------------------------------------- */

  const vorige = useCallback(() => {
    if (index === null || index === 0) return
    onWissel(index - 1)
  }, [index, onWissel])

  const volgende = useCallback(() => {
    if (index === null || index >= bestanden.length - 1) return
    onWissel(index + 1)
  }, [index, bestanden.length, onWissel])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSluiten()
      if (e.key === 'ArrowLeft') vorige()
      if (e.key === 'ArrowRight') volgende()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onSluiten, vorige, volgende])

  /* ---- opslaan ---------------------------------------------------- */

  function opslaan() {
    if (!blobUrl || !bestand) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = bestand.naam
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function opslaanZonderTonen() {
    if (!bestand) return
    try {
      const adres = await bestand.haal()
      const blob = await haalBytes(adres)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = bestand.naam
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan lukte niet')
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && bestand && (
        <motion.div
          className="kijker-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onSluiten()}
        >
          <motion.div
            className="kijker"
            initial={{ opacity: 0, y: 18, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: .99 }}
            transition={{ duration: .22, ease: [.22, .61, .36, 1] }}
          >
            <header className="kijker-kop">
              <div className="wat">
                <strong title={bestand.naam}>{bestand.naam}</strong>
                <span>
                  {grootteVan(bestand.size)}
                  {bestanden.length > 1 && ` · ${index! + 1} van ${bestanden.length}`}
                </span>
              </div>

              {(soort === 'beeld' || soort === 'pdf') && blobUrl && (
                <div className="zoom">
                  <button
                    className="btn ghost sm"
                    onClick={() => setZoom((z) => Math.max(.4, Math.round((z - .2) * 10) / 10))}
                    title="Kleiner"
                  ><Minus size={14} /></button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => setZoom((z) => Math.min(3, Math.round((z + .2) * 10) / 10))}
                    title="Groter"
                  ><Plus size={14} /></button>
                </div>
              )}

              {blobUrl && (
                <button className="btn sm" onClick={opslaan}>
                  <Download size={14} /> Opslaan
                </button>
              )}
              <button className="btn ghost sm" onClick={onSluiten} title="Sluiten (Esc)">
                <X size={16} />
              </button>
            </header>

            <div className="kijker-blad">
              {bestanden.length > 1 && (
                <>
                  <button
                    className="blader links"
                    onClick={vorige}
                    disabled={index === 0}
                    title="Vorige (←)"
                  ><ChevronLeft size={20} /></button>
                  <button
                    className="blader rechts"
                    onClick={volgende}
                    disabled={index! >= bestanden.length - 1}
                    title="Volgende (→)"
                  ><ChevronRight size={20} /></button>
                </>
              )}

              {bezig && (
                <div className="kijker-midden">
                  <Loader2 size={26} className="spin" />
                  <span>Bezig met ophalen…</span>
                </div>
              )}

              {!bezig && fout && (
                <div className="kijker-midden fout">
                  {bestand.geblokkeerd ? <ShieldX size={30} /> : <AlertTriangle size={30} />}
                  <strong>{bestand.geblokkeerdKop ?? (bestand.geblokkeerd ? 'Deze bijlage is tegengehouden' : 'Dit lukte niet')}</strong>
                  <span>{fout}</span>
                  {!bestand.geblokkeerd && (
                    <button className="btn sm" onClick={() => void opslaanZonderTonen()}>
                      <Download size={14} /> Toch opslaan
                    </button>
                  )}
                </div>
              )}

              {!bezig && !fout && blobUrl && soort === 'beeld' && (
                <div className="kijker-beeld">
                  <img
                    src={blobUrl}
                    alt={bestand.naam}
                    style={{ width: `${zoom * 100}%` }}
                    onError={() => setFout(
                      'Dit bestand heet een plaatje te zijn maar is er geen. ' +
                      'Opslaan kan wel, als je de afzender vertrouwt.')}
                  />
                </div>
              )}

              {!bezig && !fout && blobUrl && soort === 'pdf' && (
                <PdfBlad url={blobUrl} zoom={zoom} onFout={setFout} />
              )}

              {!bezig && !fout && tekst !== null && soort === 'tekst' && (
                <pre className="kijker-tekst">{tekst}</pre>
              )}

              {!bezig && !fout && blobUrl && soort === 'onbekend' && (
                <div className="kijker-midden">
                  <FileQuestion size={30} />
                  <strong>Dit soort bestand tonen we niet</strong>
                  <span>
                    Wat we niet herkennen laten we niet zien — dat is precies
                    het soort bestand waarmee het misgaat. Opslaan kan wel, en
                    dan opent het op je eigen computer.
                  </span>
                  <button className="btn sm" onClick={opslaan}>
                    <Download size={14} /> Opslaan
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 *  Een PDF, bladzijde voor bladzijde op een canvas
 * ------------------------------------------------------------------ */

const MAX_BLADZIJDEN = 40

function PdfBlad({
  url, zoom, onFout,
}: {
  url: string
  zoom: number
  onFout: (t: string) => void
}) {
  const houder = useRef<HTMLDivElement>(null)
  const [bladzijden, setBladzijden] = useState(0)
  const [bezig, setBezig] = useState(true)

  useEffect(() => {
    let weg = false
    setBezig(true)

    void (async () => {
      try {
        const lib = await laadPdfjs()
        const data = new Uint8Array(await (await fetch(url)).arrayBuffer())

        /*
         * Eerst kijken wat het is. pdf.js zegt bij van alles hetzelfde, en
         * "deze PDF is niet te openen" bij een bestand dat helemaal geen PDF
         * is stuurt je de verkeerde kant op.
         */
        const anders = watIsDit(data, 'pdf')
        if (anders) throw new GeenPdf(anders)

        const doc = await lib.getDocument({ data }).promise
        if (weg) return

        const aantal = Math.min(doc.numPages, MAX_BLADZIJDEN)
        setBladzijden(doc.numPages)

        const doel = houder.current
        if (!doel) return
        doel.replaceChildren()

        // Scherp genoeg op een scherm met veel punten, maar niet zo groot
        // dat een tablet erop vastloopt.
        const scherpte = Math.min(window.devicePixelRatio || 1, 2)

        for (let i = 1; i <= aantal; i++) {
          if (weg) return
          const bladzijde = await doc.getPage(i)
          const vak = bladzijde.getViewport({ scale: 1.5 * zoom * scherpte })

          const canvas = document.createElement('canvas')
          canvas.width = vak.width
          canvas.height = vak.height
          canvas.style.width = `${vak.width / scherpte}px`
          canvas.className = 'pdf-blad'

          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await bladzijde.render({ canvas, canvasContext: ctx, viewport: vak }).promise
          if (weg) return
          doel.appendChild(canvas)
        }
      } catch (e) {
        if (!weg) {
          onFout(
            e instanceof GeenPdf
              ? e.message
              : e instanceof Error && /password/i.test(e.message)
                ? 'Deze PDF is met een wachtwoord beveiligd.'
                : 'Deze PDF is niet te openen. Opslaan kan wel.',
          )
        }
      } finally {
        if (!weg) setBezig(false)
      }
    })()

    return () => { weg = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, zoom])

  return (
    <div className="kijker-pdf">
      {bezig && (
        <div className="kijker-midden">
          <Loader2 size={26} className="spin" />
          <span>Bezig met tekenen…</span>
        </div>
      )}
      <div ref={houder} />
      {bladzijden > MAX_BLADZIJDEN && (
        <div className="signup-note" style={{ margin: '12px 0 0' }}>
          <AlertTriangle size={16} />
          <span>
            De eerste {MAX_BLADZIJDEN} van {bladzijden} bladzijden staan hier.
            Voor de rest: opslaan.
          </span>
        </div>
      )}
    </div>
  )
}
