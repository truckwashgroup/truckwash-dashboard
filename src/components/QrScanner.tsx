import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Keyboard, ScanLine, X } from 'lucide-react'
import { Field, Modal } from './ui'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  QR-code scannen
 *
 *  Twee wegen naar hetzelfde resultaat:
 *
 *   1. De camera. Waar de browser BarcodeDetector heeft (Chrome, Edge,
 *      Android) gebruiken we die; dat is de snelste en zuinigste manier.
 *      Anders valt hij terug op ZXing, dat overal werkt maar meer rekent.
 *
 *   2. De code met de hand intypen. Dat klinkt saai, maar in een natte
 *      machinekamer met een vieze telefooncamera is het vaak sneller. De
 *      code staat leesbaar onder de QR op het label gedrukt.
 * ------------------------------------------------------------------ */

interface Props {
  open: boolean
  onClose: () => void
  onScan: (code: string) => void
  title?: string
}

export default function QrScanner({ open, onClose, onScan, title = 'Scan een QR-code' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const [mode, setMode] = useState<'camera' | 'typen'>('camera')
  const [manual, setManual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!open || mode !== 'camera') {
      stop()
      return
    }
    void start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  function stop() {
    stopRef.current?.()
    stopRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  function found(text: string) {
    stop()
    onScan(text.trim().toUpperCase())
  }

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setScanning(true)

      const Detector = (window as any).BarcodeDetector
      if (Detector) {
        // De ingebouwde weg: geen extra rekenwerk, werkt op Android en in Chrome.
        const detector = new Detector({ formats: ['qr_code'] })
        let stopped = false
        stopRef.current = () => { stopped = true }

        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes?.length) return found(String(codes[0].rawValue ?? ''))
          } catch { /* een enkel frame dat mislukt is geen probleem */ }
          if (!stopped) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        return
      }

      // Terugval: ZXing. Werkt overal, ook in de Electron-app.
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader()
      const controls = await reader.decodeFromVideoElement(videoRef.current!, (result) => {
        if (result) found(result.getText())
      })
      stopRef.current = () => controls.stop()
    } catch (e) {
      const name = (e as { name?: string })?.name
      setError(
        name === 'NotAllowedError'
          ? 'Geen toegang tot de camera. Sta dat toe, of typ de code in.'
          : name === 'NotFoundError'
            ? 'Geen camera gevonden op dit apparaat.'
            : 'De camera startte niet. Typ de code in.',
      )
      setMode('typen')
    }
  }

  function submitManual() {
    const code = manual.trim().toUpperCase()
    if (code.length < 3) return toast.error('Vul de code van het label in')
    setManual('')
    onScan(code)
  }

  return (
    <Modal open={open} title={title} onClose={() => { stop(); onClose() }} width={460}>
      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button
          className={`btn sm ${mode === 'camera' ? 'primary' : ''}`}
          onClick={() => setMode('camera')}
        >
          <Camera size={14} /> Camera
        </button>
        <button
          className={`btn sm ${mode === 'typen' ? 'primary' : ''}`}
          onClick={() => { stop(); setMode('typen') }}
        >
          <Keyboard size={14} /> Code intypen
        </button>
      </div>

      {mode === 'camera' ? (
        <div className="qr-stage">
          <video ref={videoRef} playsInline muted />
          <div className="qr-frame">
            <ScanLine size={22} />
            <span>{scanning ? 'Richt op de QR-code' : 'Camera starten…'}</span>
          </div>
        </div>
      ) : (
        <>
          <Field
            label="Code van het label"
            help="Die staat leesbaar onder de QR-code gedrukt, bijvoorbeeld K7M-P2X-9RT of UTR-BOR-01."
          >
            <input
              className="input"
              value={manual}
              maxLength={24}
              autoFocus
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submitManual()}
              placeholder="K7M-P2X-9RT"
              style={{ fontSize: '1.15rem', letterSpacing: '.08em', textAlign: 'center' }}
            />
          </Field>
          <button className="btn primary block" onClick={submitManual}>
            Zoek dit apparaat
          </button>
        </>
      )}

      {error && (
        <div className="row" style={{ gap: 8, marginTop: 12, color: 'var(--warn)', fontSize: '.83rem' }}>
          <CameraOff size={15} />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  QR-labels om af te drukken
 * ------------------------------------------------------------------ */

export function QrLabel({
  token, code, name, locationName, size = 150,
}: {
  token: string
  code: string
  name: string
  locationName?: string
  size?: number
}) {
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const QRCode = await import('qrcode')
      const out = await QRCode.toString(token, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M', // machinekamer: een beetje vuil mag
        color: { dark: '#000000', light: '#ffffff' },
      })
      if (alive) setSvg(out)
    })()
    return () => { alive = false }
  }, [token])

  return (
    <div className="qr-label">
      <div
        className="qr-image"
        style={{ width: size, height: size }}
        // De inhoud komt uit de QR-bibliotheek, niet uit invoer van een
        // gebruiker: het is altijd een <svg> met alleen paden.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="qr-meta">
        <div className="qr-name">{name}</div>
        <div className="qr-code">{code}</div>
        <div className="qr-token">{token}</div>
        {locationName && <div className="qr-loc">{locationName}</div>}
        <div className="qr-brand">Truckwash1 Group</div>
      </div>
    </div>
  )
}
