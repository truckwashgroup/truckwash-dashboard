import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToasts } from '../store/useToasts'

const ICONS = {
  ok: <CheckCircle2 size={17} color="var(--ok)" />,
  warn: <AlertTriangle size={17} color="var(--warn)" />,
  error: <XCircle size={17} color="var(--danger)" />,
  info: <Info size={17} color="var(--info)" />,
}

export default function Toasts() {
  const { items, dismiss } = useToasts()

  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.tone}`}
            layout
            initial={{ opacity: 0, x: 48, scale: .94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: .94, height: 0, marginTop: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: .7 }}
            onClick={() => dismiss(t.id)}
          >
            {ICONS[t.tone]}
            <span>{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
