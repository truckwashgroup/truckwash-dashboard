import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/* ------------------------------------------------------------------ *
 *  Wasstraat-animatie
 *  Een vrachtwagen rijdt de wasstraat binnen: voorwas, schuim, borstels,
 *  spoelen, drogen, en komt glanzend aan de andere kant naar buiten.
 *
 *  De beweging loopt in framer-motion (GPU), niet via React-renders.
 *  React hertekent alleen bij een fasewissel: zeven keer in totaal.
 * ------------------------------------------------------------------ */

const DURATION = 5.4 // seconden

const PHASES = [
  { at: 0.00, label: 'Wasstraat starten' },
  { at: 0.16, label: 'Voorwas — vuil losweken' },
  { at: 0.34, label: 'Schuim aanbrengen' },
  { at: 0.52, label: 'Borstels actief' },
  { at: 0.70, label: 'Naspoelen met osmosewater' },
  { at: 0.85, label: 'Drogen' },
  { at: 0.95, label: 'Klaar — glanzend de deur uit' },
]

interface Props {
  onDone: () => void
  userName?: string
}

export default function CarwashAnimation({ onDone, userName }: Props) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timers = PHASES.slice(1).map((p, i) =>
      setTimeout(() => setPhase(i + 1), p.at * DURATION * 1000),
    )
    const end = setTimeout(onDone, DURATION * 1000 + 420)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(end)
    }
  }, [onDone])

  const washing = phase >= 1 && phase <= 5
  const foaming = phase === 2 || phase === 3
  const rinsing = phase === 4
  const drying = phase === 5
  const clean = phase >= 5

  return (
    <div className="wash-stage">
      <div className="wash-inner">
        <svg viewBox="0 0 900 340" className="wash-svg" role="img" aria-label="Vrachtwagen in de wasstraat">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d1a2e" />
              <stop offset="100%" stopColor="#070d18" />
            </linearGradient>
            <linearGradient id="cabPaint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd451" />
              <stop offset="55%" stopColor="#f8c010" />
              <stop offset="100%" stopColor="#c1930a" />
            </linearGradient>
            <linearGradient id="trailerPaint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f3f7ff" />
              <stop offset="60%" stopColor="#d3ddef" />
              <stop offset="100%" stopColor="#aebdd6" />
            </linearGradient>
            <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9fd8ff" stopOpacity=".95" />
              <stop offset="100%" stopColor="#2b5f85" stopOpacity=".9" />
            </linearGradient>
            <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1b2b46" />
              <stop offset="100%" stopColor="#101c31" />
            </linearGradient>
            <linearGradient id="shine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity=".55" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="lampGlow">
              <stop offset="0%" stopColor="#7fd6ff" stopOpacity=".55" />
              <stop offset="100%" stopColor="#7fd6ff" stopOpacity="0" />
            </radialGradient>
            <clipPath id="tunnelClip">
              <rect x="120" y="20" width="420" height="262" />
            </clipPath>
          </defs>

          {/* achtergrond */}
          <rect width="900" height="340" fill="url(#sky)" />

          {/* achterwand van de hal */}
          <rect x="120" y="40" width="420" height="220" fill="#0a1424" />
          {Array.from({ length: 9 }).map((_, i) => (
            <rect key={i} x={130 + i * 46} y="46" width="38" height="208" rx="3" fill="#0c1930" opacity=".85" />
          ))}

          {/* vloer */}
          <rect x="0" y="258" width="900" height="82" fill="#0a1220" />
          <rect x="0" y="258" width="900" height="3" fill="#16243d" />
          <motion.rect
            x="120" y="261" width="420" height="40" fill="#22a7f0"
            animate={{ opacity: washing ? 0.16 : 0.05 }}
            transition={{ duration: .4 }}
          />

          {/* ---------------- Truck ---------------- */}
          <motion.g
            initial={{ x: -430 }}
            animate={{ x: 1060 }}
            transition={{ duration: DURATION, ease: 'linear' }}
          >
            <ellipse cx="165" cy="260" rx="175" ry="9" fill="#000" opacity=".45" />

            {/* oplegger */}
            <rect x="0" y="138" width="232" height="86" rx="7" fill="url(#trailerPaint)" />
            <rect x="0" y="138" width="232" height="86" rx="7" fill="none" stroke="#8fa2c0" strokeWidth="1.5" />
            <rect x="10" y="150" width="212" height="26" rx="4" fill="#f8c010" opacity=".95" />
            <text x="116" y="169" textAnchor="middle" fontSize="15" fontWeight="800" fill="#14202f" letterSpacing="2">
              TRUCKWASH1
            </text>
            <rect x="10" y="186" width="212" height="30" rx="4" fill="#c3cfe4" opacity=".55" />
            <rect x="115" y="140" width="2" height="82" fill="#9aabc6" />

            {/* koppeling */}
            <rect x="232" y="200" width="14" height="14" fill="#4a5a75" />

            {/* cabine */}
            <path
              d="M246 224 L246 152 Q246 142 256 142 L296 142 Q304 142 308 149 L326 186 Q330 192 330 200 L330 224 Z"
              fill="url(#cabPaint)"
            />
            <path d="M300 150 L316 184 L292 184 L292 150 Z" fill="url(#glass)" />
            <rect x="255" y="152" width="30" height="30" rx="4" fill="url(#glass)" opacity=".9" />
            <rect x="322" y="206" width="12" height="18" rx="3" fill="#2c3d58" />
            <circle cx="325" cy="196" r="5" fill="#ffe9a8" />
            <circle cx="325" cy="196" r="22" fill="url(#lampGlow)" />
            <rect x="240" y="150" width="7" height="72" rx="3" fill="#5a6b86" />

            {/* wielen */}
            {[58, 104, 292].map((cx) => (
              <g key={cx}>
                <circle cx={cx} cy="238" r="21" fill="#141c2b" />
                <circle cx={cx} cy="238" r="21" fill="none" stroke="#2b3a52" strokeWidth="3" />
                <motion.g
                  style={{ originX: `${cx}px`, originY: '238px' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.55, repeat: Infinity, ease: 'linear' }}
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

            {/* glans zodra hij schoon is */}
            {clean && (
              <>
                <motion.rect
                  x="0" y="138" width="330" height="86" fill="url(#shine)"
                  initial={{ opacity: 0, x: -60 }}
                  animate={{ opacity: [0, .95, 0], x: [-60, 340] }}
                  transition={{ duration: 1.1, ease: 'easeInOut' }}
                />
                <Sparkle x={40} y={150} delay={0} />
                <Sparkle x={150} y={196} delay={0.25} />
                <Sparkle x={270} y={158} delay={0.45} />
              </>
            )}
          </motion.g>

          {/* ---------------- Water, schuim, lucht ---------------- */}
          <g clipPath="url(#tunnelClip)">
            {washing &&
              Array.from({ length: 22 }).map((_, i) => (
                <motion.line
                  key={'jet' + i}
                  x1={140 + (i % 11) * 38}
                  y1={i < 11 ? 70 : 250}
                  x2={140 + (i % 11) * 38}
                  y2={i < 11 ? 130 : 200}
                  stroke="#7fd6ff" strokeWidth="2" strokeLinecap="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.15, 0.75, 0.15] }}
                  transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.035 }}
                />
              ))}

            {foaming &&
              Array.from({ length: 24 }).map((_, i) => (
                <motion.circle
                  key={'foam' + i}
                  cx={135 + ((i * 71) % 400)}
                  cy={110 + ((i * 53) % 140)}
                  r={5 + (i % 5) * 2.6}
                  fill="#eaf6ff"
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 0.8, 0], scale: [0.3, 1.15, 0.5], y: [0, 26] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: (i % 9) * 0.16 }}
                />
              ))}

            {rinsing &&
              Array.from({ length: 16 }).map((_, i) => (
                <motion.circle
                  key={'drop' + i}
                  cx={140 + ((i * 97) % 390)}
                  cy={90} r={2.4} fill="#9fe0ff"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.9, 0], y: [0, 160] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: (i % 8) * 0.09 }}
                />
              ))}

            {drying &&
              Array.from({ length: 7 }).map((_, i) => (
                <motion.path
                  key={'air' + i}
                  d={`M${150 + i * 55} 96 q 22 26 0 52`}
                  stroke="#bfe6ff" strokeWidth="2" fill="none" strokeLinecap="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.7, 0], x: [0, 16] }}
                  transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.07 }}
                />
              ))}
          </g>

          {/* borstels */}
          <Brush cx={185} active={washing} />
          <Brush cx={475} active={washing} />

          {/* dakborstel */}
          <rect x="200" y="76" width="260" height="10" rx="5" fill="#2a3a57" />
          <motion.g
            style={{ originX: '330px', originY: '99px' }}
            animate={washing ? { rotate: 360 } : { rotate: 0 }}
            transition={washing
              ? { duration: 0.85, repeat: Infinity, ease: 'linear' }
              : { duration: .3 }}
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
          <rect x="120" y="40" width="26" height="222" fill="url(#beam)" />
          <rect x="514" y="40" width="26" height="222" fill="url(#beam)" />
          <rect x="120" y="40" width="420" height="34" rx="4" fill="url(#beam)" />
          <rect x="120" y="40" width="420" height="34" rx="4" fill="none" stroke="#243b5e" />

          {/* verlichting */}
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.rect
              key={'lamp' + i}
              x={160 + i * 62} y="78" width="42" height="5" rx="2.5" fill="#7fd6ff"
              animate={{ opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.12 }}
            />
          ))}

          <text x="330" y="63" textAnchor="middle" fontSize="17" fontWeight="700" fill="#8fd4ff" letterSpacing="4">
            TRUCKWASH1 GROUP
          </text>

          {/* stoplicht bij de uitgang */}
          <rect x="556" y="120" width="22" height="52" rx="6" fill="#101c31" stroke="#243b5e" />
          <circle cx="567" cy="134" r="6.5" fill={clean ? '#1f3a2c' : '#f4685f'} opacity={clean ? .5 : 1} />
          <circle cx="567" cy="157" r="6.5" fill={clean ? '#35d07f' : '#1f3a2c'} opacity={clean ? 1 : .5} />
        </svg>

        <div className="wash-status">
          <div className="wash-phase">
            <span className="wash-dot" />
            {PHASES[phase].label}
          </div>
          <div className="wash-bar">
            <span style={{ animation: `washFill ${DURATION}s linear forwards` }} />
          </div>
          <div className="wash-sub">
            {userName ? `Welkom terug, ${userName}` : 'Bezig met voorbereiden'}
          </div>
        </div>

        <button className="btn ghost sm wash-skip" onClick={onDone}>
          Overslaan
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Brush({ cx, active }: { cx: number; active: boolean }) {
  return (
    <g>
      <rect x={cx - 3} y="86" width="6" height="176" fill="#2a3a57" />
      <motion.g
        style={{ originX: `${cx}px`, originY: '174px' }}
        animate={active ? { rotate: 360 } : { rotate: 0 }}
        transition={active
          ? { duration: 0.7, repeat: Infinity, ease: 'linear' }
          : { duration: .3 }}
      >
        <ellipse cx={cx} cy="174" rx="21" ry="21" fill="#2d5f86" opacity=".9" />
        {Array.from({ length: 16 }).map((_, i) => (
          <rect
            key={i}
            x={cx - 2.5} y={100} width="5" height="74" rx="2.5"
            fill={i % 2 ? '#4fb3e0' : '#8de0ff'}
            opacity={active ? 0.95 : 0.55}
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
      d={`M${x} ${y - 9} L${x + 2.6} ${y - 2.6} L${x + 9} ${y} L${x + 2.6} ${y + 2.6} L${x} ${y + 9} L${x - 2.6} ${y + 2.6} L${x - 9} ${y} L${x - 2.6} ${y - 2.6} Z`}
      fill="#ffffff"
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: [0, 1, 0], scale: [0, 1.3, 0] }}
      transition={{ duration: 0.9, delay, repeat: Infinity, repeatDelay: 0.6 }}
      style={{ originX: `${x}px`, originY: `${y}px` }}
    />
  )
}
