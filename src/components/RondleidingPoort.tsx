import { useEffect, useState } from 'react'
import { moetZien } from '../lib/rondleiding'
import type { Role } from '../lib/types'
import { useAuth } from '../store/useAuth'
import Rondleiding from './Rondleiding'
import { useRondleiding } from '../store/useRondleiding'

/* ------------------------------------------------------------------ *
 *  Wanneer de rondleiding vanzelf begint
 *
 *  Bij de eerste keer dat iemand een dashboard binnenkomt, en opnieuw als
 *  hij er een rol bij krijgt -- dat tweede geval is de reden dat het per rol
 *  wordt bijgehouden en niet per persoon. Wie er management bij krijgt, krijgt
 *  er een dashboard bij dat hij nooit heeft gezien, en dat is verwarrender
 *  dan een lege app: de rest kende hij wel.
 *
 *  Even wachten voor hij begint. Het dashboard moet staan, anders wijzen de
 *  aanwijzers naar knoppen die er nog niet zijn.
 * ------------------------------------------------------------------ */

export default function RondleidingPoort({ rol }: { rol: Role }) {
  const me = useAuth((s) => s.user)
  const gevraagd = useRondleiding((s) => s.rol)
  const stop = useRondleiding((s) => s.stop)
  const [vanzelf, setVanzelf] = useState(false)

  useEffect(() => {
    if (!moetZien(me, rol)) { setVanzelf(false); return }
    const id = setTimeout(() => setVanzelf(true), 700)
    return () => clearTimeout(id)
  }, [me, rol])

  // Zelf opgevraagd gaat voor; dan wil iemand een bepaalde rol terugzien.
  const tonen = gevraagd ?? (vanzelf ? rol : null)
  if (!tonen) return null

  return (
    <Rondleiding
      rol={tonen}
      onSluiten={() => { setVanzelf(false); stop() }}
    />
  )
}
