import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTheme } from '../lib/theme'

/* ------------------------------------------------------------------ *
 *  Wasstraat
 *
 *  Wat er mis was aan de vorige versie: de wagen reed met constante snelheid
 *  door beeld terwijl het bijschrift beweerde dat de borstels draaiden. Hij
 *  was dan allang voorbij. En hij kwam al schoon binnen, waardoor het hele
 *  verhaal nergens over ging.
 *
 *  Nu is de beweging de baas. Eén tijdlijn bepaalt waar de wagen is, en de
 *  fasen hangen daaraan vast:
 *
 *    remmen bij de ingang  ->  stapvoets door de straat  ->  optrekken naar buiten
 *
 *  En hij komt vuil binnen. Die laag pekel en wegvuil verdwijnt gaandeweg,
 *  zodat je aan het eind ziet waar het allemaal om ging.
 *
 *  Alles loopt op de GPU via framer-motion. React tekent alleen bij een
 *  fasewissel opnieuw: zeven keer in totaal.
 * ------------------------------------------------------------------ */

const DURATION = 6.4

/**
 * De tijdlijn van de wagen, als deel van de totale duur.
 *
 * De getallen zijn de x-verschuiving van de hele wagen. Zijn neus zit op
 * +330 daarvan, zijn staart op 0. De straat loopt van 120 tot 540.
 */
const RIT = {
  tijden: [0, 0.13, 0.22, 0.80, 1],
  posities: [-440, -150, -60, 250, 1080],
}

const PHASES = [
  { at: 0.00, label: 'Wasstraat starten',            kort: 'Starten' },
  { at: 0.14, label: 'Voorwas — vuil losweken',      kort: 'Voorwas' },
  { at: 0.28, label: 'Schuim aanbrengen',            kort: 'Schuim' },
  { at: 0.45, label: 'Borstels actief',              kort: 'Borstels' },
  { at: 0.62, label: 'Naspoelen met osmosewater',    kort: 'Naspoelen' },
  { at: 0.76, label: 'Drogen',                       kort: 'Drogen' },
  { at: 0.88, label: 'Klaar — glanzend de deur uit', kort: 'Klaar' },
]

interface Props {
  onDone: () => void
  userName?: string
}

export default function CarwashAnimation({ onDone, userName }: Props) {
  const rustig = useTheme((s) => s.rustig)
  const [phase, setPhase] = useState(0)
  const [weg, setWeg] = useState(false)

  /* Wie minder beweging wil, krijgt geen wasstraat van zes seconden. */
  useEffect(() => {
    if (!rustig) return
    const t = setTimeout(onDone, 250)
    return () => clearTimeout(t)
  }, [rustig, onDone])

  useEffect(() => {
    if (rustig) return
    const timers = PHASES.slice(1).map((p, i) =>
      setTimeout(() => setPhase(i + 1), p.at * DURATION * 1000),
    )
    // Eerst uitvloeien, dan pas doorgeven: een harde knip voelt als haperen.
    const uit = setTimeout(() => setWeg(true), DURATION * 1000 + 150)
    const end = setTimeout(onDone, DURATION * 1000 + 620)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(uit)
      clearTimeout(end)
    }
  }, [onDone, rustig])

  const washing = phase >= 1 && phase <= 5
  const foaming = phase === 2 || phase === 3
  const brushing = phase === 3
  const rinsing = phase === 4
  const drying = phase === 5
  const clean = phase >= 6

  /**
   * Hoe vuil de wagen nog is. Loopt van helemaal grauw naar helemaal weg,
   * en dat is precies wat de kijker moet zien gebeuren.
   */
  const vuil = useMemo(() => {
    if (phase <= 1) return 1
    if (phase === 2) return 0.72
    if (phase === 3) return 0.3
    if (phase === 4) return 0.06
    return 0
  }, [phase])

  /** Wielen draaien snel bij het in- en uitrijden, stapvoets in de straat. */
  const wielTijd = phase === 0 || clean ? 0.42 : 2.6

  if (rustig) {
    return (
      <div className="wash-stage rustig">
        <div className="wash-status">
          <div className="wash-phase"><span className="wash-dot" /> Klaarzetten</div>
          <div className="wash-sub">{userName ? `Welkom terug, ${userName}` : ''}</div>
        </div>
      </div>
    )
  }

  return (
    <AnimatePresence>
      {!weg && (
        <motion.div
          className="wash-stage"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
          transition={{ duration: .45, ease: [.22, .61, .36, 1] }}
        >
          <motion.div
            className="wash-inner"
            initial={{ scale: .96, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: .7, ease: [.16, 1, .3, 1] }}
          >
            <svg
              viewBox="0 0 900 340"
              className="wash-svg"
              role="img"
              aria-label="Vrachtwagen in de wasstraat"
            >
              <Verf />

              {/* ------------------------ decor ----------------------- */}

              <rect width="900" height="340" fill="url(#lucht)" />

              {/* De hal achter de straat, met diepte door de kolommen
                  naar achteren toe donkerder te maken. */}
              <rect x="120" y="40" width="420" height="220" fill="#08111f" />
              {Array.from({ length: 9 }).map((_, i) => (
                <rect
                  key={i}
                  x={130 + i * 46} y="46" width="38" height="208" rx="3"
                  fill="#0c1930"
                  opacity={0.5 + Math.abs(4 - i) * 0.09}
                />
              ))}

              {/* Lichtbundels uit de tunnelverlichting. Subtiel, maar het
                  maakt van een plat plaatje ineens een ruimte. */}
              <g clipPath="url(#tunnelClip)" opacity=".5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <motion.path
                    key={'bundel' + i}
                    d={`M${162 + i * 62} 84 L${140 + i * 62} 262 L${208 + i * 62} 262 L${186 + i * 62} 84 Z`}
                    fill="url(#bundel)"
                    animate={{ opacity: washing ? [0.25, 0.55, 0.25] : 0.18 }}
                    transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </g>

              {/* vloer */}
              <rect x="0" y="258" width="900" height="82" fill="#080f1b" />
              <rect x="0" y="258" width="900" height="3" fill="#16243d" />

              {/* Nat wegdek in de straat: hoe verder in het proces, hoe
                  natter en spiegelender. */}
              <motion.rect
                x="120" y="261" width="420" height="46" fill="url(#natteVloer)"
                animate={{ opacity: washing ? 0.85 : 0.15 }}
                transition={{ duration: .6 }}
              />

              {/* --------------------- de wagen ----------------------- */}

              <motion.g
                initial={{ x: RIT.posities[0] }}
                animate={{ x: RIT.posities }}
                transition={{
                  duration: DURATION,
                  times: RIT.tijden,
                  ease: ['easeOut', 'easeInOut', 'linear', 'easeIn'],
                }}
              >
                {/* De spiegeling op het natte wegdek. Meebewegen doet hij
                    vanzelf; hij zit in dezelfde groep. */}
                <motion.g
                  transform="translate(0, 516) scale(1, -1)"
                  opacity=".14"
                  style={{ filter: 'blur(1px)' }}
                  animate={{ opacity: washing ? 0.2 : 0.08 }}
                  transition={{ duration: .6 }}
                >
                  <Truck vuil={0} spiegel />
                </motion.g>

                <ellipse cx="165" cy="260" rx="178" ry="9" fill="#000" opacity=".5" />

                <Truck vuil={vuil} wielTijd={wielTijd} />

                {/* Watervlies over de lak tijdens het spoelen */}
                <motion.rect
                  x="-4" y="134" width="340" height="94" rx="8"
                  fill="url(#vlies)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: rinsing ? 0.55 : foaming ? 0.3 : 0 }}
                  transition={{ duration: .5 }}
                />

                {/* Druppels die van de wagen lopen, vlak na het spoelen */}
                {(rinsing || drying) && Array.from({ length: 10 }).map((_, i) => (
                  <motion.circle
                    key={'drip' + i}
                    cx={14 + i * 32} cy={224} r={2}
                    fill="#a9e4ff"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, .85, 0], cy: [222, 250] }}
                    transition={{
                      duration: .75, repeat: Infinity, delay: (i % 6) * 0.18,
                    }}
                  />
                ))}

                {/* Glans zodra hij schoon is */}
                {clean && (
                  <>
                    <motion.rect
                      x="-10" y="134" width="350" height="94" rx="8" fill="url(#glans)"
                      initial={{ opacity: 0, x: -80 }}
                      animate={{ opacity: [0, 1, 0], x: [-80, 360] }}
                      transition={{ duration: 1.25, ease: [.4, 0, .2, 1] }}
                    />
                    <Sparkle x={44} y={152} delay={0.05} />
                    <Sparkle x={152} y={198} delay={0.3} />
                    <Sparkle x={274} y={158} delay={0.5} />
                    <Sparkle x={210} y={146} delay={0.72} />
                  </>
                )}
              </motion.g>

              {/* ---------------- water, schuim, lucht ---------------- */}

              <g clipPath="url(#tunnelClip)">
                {washing && Array.from({ length: 22 }).map((_, i) => (
                  <motion.line
                    key={'jet' + i}
                    x1={140 + (i % 11) * 38}
                    y1={i < 11 ? 68 : 252}
                    x2={140 + (i % 11) * 38}
                    y2={i < 11 ? 132 : 198}
                    stroke="#7fd6ff" strokeWidth="2" strokeLinecap="round"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0.1, 0.7, 0.1] }}
                    transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.035 }}
                  />
                ))}

                {foaming && Array.from({ length: 30 }).map((_, i) => (
                  <motion.circle
                    key={'foam' + i}
                    cx={132 + ((i * 71) % 404)}
                    cy={104 + ((i * 53) % 148)}
                    r={4 + (i % 6) * 2.8}
                    fill="#eaf6ff"
                    initial={{ opacity: 0, scale: 0.2 }}
                    animate={{
                      opacity: [0, 0.85, 0],
                      scale: [0.2, 1.2, 0.55],
                      y: [0, 30],
                    }}
                    transition={{
                      duration: 1.6, repeat: Infinity, delay: (i % 10) * 0.15,
                      ease: 'easeOut',
                    }}
                  />
                ))}

                {rinsing && Array.from({ length: 20 }).map((_, i) => (
                  <motion.circle
                    key={'drop' + i}
                    cx={138 + ((i * 97) % 394)}
                    cy={88} r={2.2} fill="#9fe0ff"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.9, 0], y: [0, 168] }}
                    transition={{ duration: 0.78, repeat: Infinity, delay: (i % 9) * 0.08 }}
                  />
                ))}

                {drying && (
                  <>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <motion.path
                        key={'air' + i}
                        d={`M${146 + i * 50} 94 q 26 30 0 60`}
                        stroke="#bfe6ff" strokeWidth="2" fill="none" strokeLinecap="round"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.7, 0], x: [0, 22] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.06 }}
                      />
                    ))}
                    {/* Nevel die opstijgt; die maakt het warm in plaats van kil. */}
                    {Array.from({ length: 6 }).map((_, i) => (
                      <motion.ellipse
                        key={'nevel' + i}
                        cx={170 + i * 66} cy={240} rx={26} ry={12}
                        fill="#cfeaff"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.16, 0], cy: [244, 176], rx: [20, 40] }}
                        transition={{ duration: 2.1, repeat: Infinity, delay: i * 0.3 }}
                      />
                    ))}
                  </>
                )}
              </g>

              {/* ------------------------ machines -------------------- */}

              <Brush cx={185} active={brushing || foaming} draait={brushing} />
              <Brush cx={475} active={brushing || rinsing} draait={brushing} />

              {/* dakborstel */}
              <rect x="200" y="76" width="260" height="10" rx="5" fill="#2a3a57" />
              <motion.g
                style={{ originX: '330px', originY: '99px' }}
                animate={{
                  rotate: brushing ? 360 : 0,
                  y: brushing ? 6 : 0,
                }}
                transition={{
                  rotate: brushing
                    ? { duration: 0.8, repeat: Infinity, ease: 'linear' }
                    : { duration: .4 },
                  y: { duration: .5, ease: 'easeOut' },
                }}
              >
                <circle cx="330" cy="99" r="17" fill="#2d5f86" />
                {Array.from({ length: 14 }).map((_, i) => (
                  <rect
                    key={i}
                    x="328" y="82" width="4" height="17" rx="2"
                    fill={i % 2 ? '#4fb3e0' : '#8de0ff'}
                    transform={`rotate(${(360 / 14) * i} 330 99)`}
                  />
                ))}
              </motion.g>

              {/* tunnelframe */}
              <rect x="120" y="40" width="26" height="222" fill="url(#balk)" />
              <rect x="514" y="40" width="26" height="222" fill="url(#balk)" />
              <rect x="120" y="40" width="420" height="34" rx="4" fill="url(#balk)" />
              <rect x="120" y="40" width="420" height="34" rx="4" fill="none" stroke="#243b5e" />

              {Array.from({ length: 6 }).map((_, i) => (
                <motion.rect
                  key={'lamp' + i}
                  x={160 + i * 62} y="78" width="42" height="5" rx="2.5" fill="#7fd6ff"
                  animate={{ opacity: washing ? [0.4, 1, 0.4] : 0.3 }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.12 }}
                />
              ))}

              <text
                x="330" y="63" textAnchor="middle"
                fontSize="17" fontWeight="700" fill="#8fd4ff" letterSpacing="4"
              >
                TRUCKWASH1 GROUP
              </text>

              {/* stoplicht bij de uitgang */}
              <rect x="556" y="120" width="22" height="52" rx="6" fill="#101c31" stroke="#243b5e" />
              <motion.circle
                cx="567" cy="134" r="6.5" fill="#f4685f"
                animate={{ opacity: clean ? 0.25 : 1 }}
                transition={{ duration: .4 }}
              />
              <motion.circle
                cx="567" cy="157" r="6.5" fill="#35d07f"
                animate={{ opacity: clean ? 1 : 0.2 }}
                transition={{ duration: .4 }}
              />
              {clean && (
                <motion.circle
                  cx="567" cy="157" r="6.5" fill="none" stroke="#35d07f" strokeWidth="2"
                  initial={{ scale: 1, opacity: .9 }}
                  animate={{ scale: 2.6, opacity: 0 }}
                  transition={{ duration: 1, repeat: Infinity }}
                  style={{ originX: '567px', originY: '157px' }}
                />
              )}

              {/* Randverduistering: houdt de aandacht in het midden. */}
              <rect width="900" height="340" fill="url(#vignet)" pointerEvents="none" />
            </svg>

            {/* --------------------- onderschrift ------------------- */}

            <div className="wash-status">
              <div className="wash-stappen">
                {PHASES.map((p, i) => (
                  <span
                    key={p.kort}
                    className={`stap ${i < phase ? 'klaar' : ''} ${i === phase ? 'nu' : ''}`}
                  >
                    {p.kort}
                  </span>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={phase}
                  className="wash-phase"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: .24 }}
                >
                  <span className="wash-dot" />
                  {PHASES[phase].label}
                </motion.div>
              </AnimatePresence>

              <div className="wash-bar">
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: DURATION, ease: 'linear' }}
                />
              </div>

              <div className="wash-sub">
                {userName ? `Welkom terug, ${userName}` : 'Bezig met voorbereiden'}
              </div>
            </div>

            <button className="btn ghost sm wash-skip" onClick={onDone}>
              Overslaan
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ================================================================== *
 *  De wagen
 * ================================================================== */

function Truck({
  vuil, wielTijd = 2.6, spiegel = false,
}: {
  vuil: number
  wielTijd?: number
  spiegel?: boolean
}) {
  return (
    <>
      {/* oplegger */}
      <rect x="0" y="138" width="232" height="86" rx="7" fill="url(#opleggerLak)" />
      <rect x="0" y="138" width="232" height="86" rx="7" fill="none" stroke="#8fa2c0" strokeWidth="1.5" />
      <rect x="10" y="150" width="212" height="26" rx="4" fill="#f8c010" opacity=".95" />
      <text
        x="116" y="169" textAnchor="middle"
        fontSize="15" fontWeight="800" fill="#14202f" letterSpacing="2"
      >
        TRUCKWASH1
      </text>
      <rect x="10" y="186" width="212" height="30" rx="4" fill="#c3cfe4" opacity=".55" />
      <rect x="115" y="140" width="2" height="82" fill="#9aabc6" />

      {/* koppeling */}
      <rect x="232" y="200" width="14" height="14" fill="#4a5a75" />

      {/* cabine */}
      <path
        d="M246 224 L246 152 Q246 142 256 142 L296 142 Q304 142 308 149 L326 186 Q330 192 330 200 L330 224 Z"
        fill="url(#cabineLak)"
      />
      <path d="M300 150 L316 184 L292 184 L292 150 Z" fill="url(#ruit)" />
      <rect x="255" y="152" width="30" height="30" rx="4" fill="url(#ruit)" opacity=".9" />
      <rect x="322" y="206" width="12" height="18" rx="3" fill="#2c3d58" />
      <circle cx="325" cy="196" r="5" fill="#ffe9a8" />
      {!spiegel && <circle cx="325" cy="196" r="24" fill="url(#koplamp)" />}
      <rect x="240" y="150" width="7" height="72" rx="3" fill="#5a6b86" />

      {/* wielen */}
      {[58, 104, 292].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="238" r="21" fill="#141c2b" />
          <circle cx={cx} cy="238" r="21" fill="none" stroke="#2b3a52" strokeWidth="3" />
          <motion.g
            style={{ originX: `${cx}px`, originY: '238px' }}
            animate={{ rotate: 360 }}
            transition={{ duration: wielTijd, repeat: Infinity, ease: 'linear' }}
          >
            <circle cx={cx} cy="238" r="10" fill="#3d4f6d" />
            {[0, 60, 120, 240, 300].map((a) => (
              <rect
                key={a}
                x={cx - 1.5} y={228} width="3" height="9" rx="1.5" fill="#8ea3c4"
                transform={`rotate(${a} ${cx} 238)`}
              />
            ))}
          </motion.g>
        </g>
      ))}

      {/*
        De vuillaag. Onderaan het dikst, want zo ziet een trekker er na een
        rit over een natte snelweg werkelijk uit: pekel en wegvuil slaan van
        onderaf op. Hij ligt over alles heen en verdwijnt gaandeweg.
      */}
      {!spiegel && (
        <motion.g
          initial={{ opacity: 1 }}
          animate={{ opacity: vuil }}
          transition={{ duration: 1.1, ease: 'easeInOut' }}
          pointerEvents="none"
        >
          <rect x="0" y="138" width="330" height="86" rx="7" fill="url(#vuilLaag)" />
          {[18, 62, 128, 178, 214, 262, 300].map((x, i) => (
            <ellipse
              key={x}
              cx={x} cy={210 - (i % 3) * 16} rx={12 + (i % 4) * 5} ry={5 + (i % 3) * 2}
              fill="#6b6152" opacity=".5"
            />
          ))}
          {/* Spatstrepen achter de wielen */}
          {[58, 104, 292].map((cx) => (
            <path
              key={'spat' + cx}
              d={`M${cx - 26} 224 q 26 -14 52 0`}
              stroke="#6b6152" strokeWidth="7" fill="none" opacity=".45" strokeLinecap="round"
            />
          ))}
        </motion.g>
      )}
    </>
  )
}

/* ================================================================== *
 *  Onderdelen
 * ================================================================== */

function Brush({
  cx, active, draait,
}: {
  cx: number
  active: boolean
  draait: boolean
}) {
  return (
    <g>
      <rect x={cx - 3} y="86" width="6" height="176" fill="#2a3a57" />
      <motion.g
        style={{ originX: `${cx}px`, originY: '174px' }}
        animate={{
          rotate: draait ? 360 : 0,
          scale: active ? 1 : 0.86,
        }}
        transition={{
          rotate: draait
            ? { duration: 0.65, repeat: Infinity, ease: 'linear' }
            : { duration: .4 },
          scale: { duration: .45, ease: 'easeOut' },
        }}
      >
        <ellipse cx={cx} cy="174" rx="21" ry="21" fill="#2d5f86" opacity=".9" />
        {Array.from({ length: 16 }).map((_, i) => (
          <rect
            key={i}
            x={cx - 2.5} y={100} width="5" height="74" rx="2.5"
            fill={i % 2 ? '#4fb3e0' : '#8de0ff'}
            opacity={active ? 0.95 : 0.5}
            transform={`rotate(${(360 / 16) * i} ${cx} 174)`}
          />
        ))}
      </motion.g>
    </g>
  )
}

function Sparkle({ x, y, delay }: { x: number; y: number; delay: number }) {
  return (
    <motion.path
      d={`M${x} ${y - 10} L${x + 2.8} ${y - 2.8} L${x + 10} ${y} L${x + 2.8} ${y + 2.8} L${x} ${y + 10} L${x - 2.8} ${y + 2.8} L${x - 10} ${y} L${x - 2.8} ${y - 2.8} Z`}
      fill="#ffffff"
      initial={{ opacity: 0, scale: 0, rotate: 0 }}
      animate={{ opacity: [0, 1, 0], scale: [0, 1.35, 0], rotate: 90 }}
      transition={{ duration: 1, delay, repeat: Infinity, repeatDelay: 0.7 }}
      style={{ originX: `${x}px`, originY: `${y}px` }}
    />
  )
}

/** Alle kleurverlopen op één plek. */
function Verf() {
  return (
    <defs>
      <linearGradient id="lucht" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0d1a2e" />
        <stop offset="100%" stopColor="#050a13" />
      </linearGradient>
      <linearGradient id="cabineLak" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffd451" />
        <stop offset="55%" stopColor="#f8c010" />
        <stop offset="100%" stopColor="#c1930a" />
      </linearGradient>
      <linearGradient id="opleggerLak" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f3f7ff" />
        <stop offset="60%" stopColor="#d3ddef" />
        <stop offset="100%" stopColor="#aebdd6" />
      </linearGradient>
      <linearGradient id="ruit" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#9fd8ff" stopOpacity=".95" />
        <stop offset="100%" stopColor="#2b5f85" stopOpacity=".9" />
      </linearGradient>
      <linearGradient id="balk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1b2b46" />
        <stop offset="100%" stopColor="#101c31" />
      </linearGradient>
      <linearGradient id="glans" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="45%" stopColor="#ffffff" stopOpacity=".65" />
        <stop offset="55%" stopColor="#ffffff" stopOpacity=".65" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="vlies" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#cfeeff" stopOpacity=".55" />
        <stop offset="100%" stopColor="#7fc9ef" stopOpacity=".2" />
      </linearGradient>
      <linearGradient id="vuilLaag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#7d7361" stopOpacity=".12" />
        <stop offset="55%" stopColor="#6b6152" stopOpacity=".42" />
        <stop offset="100%" stopColor="#4d4638" stopOpacity=".72" />
      </linearGradient>
      <linearGradient id="natteVloer" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#22a7f0" stopOpacity=".28" />
        <stop offset="100%" stopColor="#22a7f0" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="bundel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#8fd4ff" stopOpacity=".22" />
        <stop offset="100%" stopColor="#8fd4ff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="koplamp">
        <stop offset="0%" stopColor="#ffe9a8" stopOpacity=".5" />
        <stop offset="100%" stopColor="#ffe9a8" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="vignet" cx="50%" cy="46%" r="72%">
        <stop offset="55%" stopColor="#000000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000000" stopOpacity=".55" />
      </radialGradient>
      <clipPath id="tunnelClip">
        <rect x="120" y="20" width="420" height="262" />
      </clipPath>
    </defs>
  )
}
