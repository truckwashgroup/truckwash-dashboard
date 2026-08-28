import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Check, ChevronRight, Clock,
  GraduationCap, RotateCcw, TriangleAlert, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { learning } from '../lib/repo'
import {
  COURSE_CATEGORIES, type Course, type CourseProgress,
} from '../lib/types'
import { Badge, Bar, Card, Empty, Stat } from './ui'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'

const DAY = 86_400_000

/* ------------------------------------------------------------------ *
 *  E-learning voor de medewerker
 *
 *  Een cursus bestaat uit lessen en sluit af met een toets. Slagen betekent
 *  minimaal het percentage dat bij de cursus staat. Cursussen met een
 *  geldigheidsduur komen na afloop vanzelf weer op de lijst.
 * ------------------------------------------------------------------ */

export default function Opleiding() {
  const me = useAuth((s) => s.user)!
  const [openId, setOpenId] = useState<string | null>(null)

  const courses = useLiveQuery(() => db.courses.toArray(), [], [] as Course[])
  const progress = useLiveQuery(
    () => db.courseProgress.where('userId').equals(me.id).toArray(),
    [me.id],
    [] as CourseProgress[],
  )

  const byCourse = useMemo(
    () => new Map(progress.map((p) => [p.courseId, p])),
    [progress],
  )

  const mine = useMemo(() => {
    return courses
      .map((c) => {
        const p = byCourse.get(c.id)
        const expired = p?.expiresAt ? p.expiresAt < Date.now() : false
        const expiringSoon = p?.expiresAt ? p.expiresAt - Date.now() < 30 * DAY : false
        const required = c.requiredFor.some((r) => me.roles.includes(r))
        const done = !!p?.passed && !expired
        return { course: c, progress: p, required, done, expired, expiringSoon }
      })
      .sort((a, b) => {
        // Wat af moet en nog niet af is, staat bovenaan
        const rank = (x: typeof a) => (x.done ? 2 : x.required ? 0 : 1)
        return rank(a) - rank(b) || a.course.title.localeCompare(b.course.title)
      })
  }, [courses, byCourse, me.roles])

  const open = openId ? courses.find((c) => c.id === openId) : null
  if (open) {
    return <CoursePlayer course={open} onBack={() => setOpenId(null)} />
  }

  const verplicht = mine.filter((m) => m.required)
  const afgerond = verplicht.filter((m) => m.done).length
  const verlopen = mine.filter((m) => m.expired).length

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat
          label="Verplicht afgerond"
          value={`${afgerond} / ${verplicht.length}`}
          icon={<Award size={17} />}
          tone={afgerond === verplicht.length ? 'ok' : 'warn'}
        />
        <Stat
          label="Beschikbare cursussen"
          value={courses.length}
          icon={<BookOpen size={17} />}
        />
        <Stat
          label="Verlopen"
          value={verlopen}
          icon={<TriangleAlert size={17} />}
          tone={verlopen ? 'danger' : 'ok'}
        />
      </div>

      {courses.length === 0 ? (
        <Card>
          <Empty text="Er staat nog geen lesmateriaal klaar." icon={<GraduationCap size={30} />} />
        </Card>
      ) : (
        <div className="course-grid">
          {mine.map(({ course, progress: p, required, done, expired, expiringSoon }) => {
            const pct = p
              ? done ? 100 : Math.round((p.lessonIndex / Math.max(1, course.lessons.length)) * 100)
              : 0
            return (
              <button key={course.id} className="course-card" onClick={() => setOpenId(course.id)}>
                <div className="course-top">
                  <span className={`course-cat cat-${course.category}`}>
                    {COURSE_CATEGORIES[course.category]}
                  </span>
                  {done && <Badge tone="ok"><Check size={11} /> Afgerond</Badge>}
                  {expired && <Badge tone="danger">Verlopen</Badge>}
                  {!done && !expired && required && <Badge tone="warn">Verplicht</Badge>}
                </div>

                <h3>{course.title}</h3>
                <p>{course.summary}</p>

                <div className="course-meta">
                  <span><Clock size={12} /> {course.estimatedMinutes} min</span>
                  <span>{course.lessons.length} lessen</span>
                  <span className="mono">{course.code}</span>
                </div>

                {p && !done && (
                  <div style={{ marginTop: 10 }}>
                    <Bar value={pct} max={100} />
                    <div style={{ fontSize: '.72rem', color: 'var(--text-3)', marginTop: 4 }}>
                      {pct}% gedaan
                    </div>
                  </div>
                )}

                {done && p?.expiresAt && (
                  <div
                    style={{
                      fontSize: '.73rem',
                      color: expiringSoon ? 'var(--warn)' : 'var(--text-3)',
                      marginTop: 8,
                    }}
                  >
                    Geldig tot {new Date(p.expiresAt).toLocaleDateString('nl-NL')}
                    {p.score ? ` · score ${p.score}%` : ''}
                  </div>
                )}

                <span className="course-go">
                  {done ? 'Opnieuw bekijken' : p ? 'Verder gaan' : 'Beginnen'}
                  <ChevronRight size={14} />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

/* ================================================================== *
 *  De cursus zelf
 * ================================================================== */

function CoursePlayer({ course, onBack }: { course: Course; onBack: () => void }) {
  const me = useAuth((s) => s.user)!
  const id = `${me.id}__${course.id}`

  const progress = useLiveQuery(() => db.courseProgress.get(id), [id], undefined)
  const [step, setStep] = useState(0)
  const [quizMode, setQuizMode] = useState(false)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null)

  const lesson = course.lessons[step]
  const isLast = step === course.lessons.length - 1

  async function next() {
    await learning.start(me, course.id)
    await learning.setLesson(id, step + 1)
    if (isLast) setQuizMode(true)
    else setStep(step + 1)
  }

  async function submitQuiz() {
    const unanswered = course.quiz.filter((q) => answers[q.id] === undefined)
    if (unanswered.length) {
      return toast.error(`Nog ${unanswered.length} vraag${unanswered.length === 1 ? '' : 'en'} open`)
    }
    const correct = course.quiz.filter((q) => answers[q.id] === q.correct).length
    const score = Math.round((correct / course.quiz.length) * 100)
    const passed = score >= course.passScore

    await learning.start(me, course.id)
    await learning.submitQuiz(id, score, course.passScore, course.validMonths)
    setResult({ score, passed })

    if (passed) toast.ok(`Geslaagd met ${score}%`)
    else toast.warn(`${score}% — je hebt ${course.passScore}% nodig`)
  }

  function retry() {
    setAnswers({})
    setResult(null)
    setQuizMode(false)
    setStep(0)
  }

  /* ---------------- uitslag ---------------- */
  if (result) {
    return (
      <>
        <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
          <ArrowLeft size={15} /> Terug naar het overzicht
        </button>

        <Card>
          <div style={{ textAlign: 'center', padding: '22px 10px' }}>
            <div
              style={{
                width: 76, height: 76, borderRadius: '50%', margin: '0 auto 16px',
                display: 'grid', placeItems: 'center',
                background: result.passed ? 'rgba(53,208,127,.14)' : 'rgba(245,181,68,.14)',
                border: `2px solid ${result.passed ? 'var(--ok)' : 'var(--warn)'}`,
              }}
            >
              {result.passed
                ? <Award size={34} color="var(--ok)" />
                : <RotateCcw size={32} color="var(--warn)" />}
            </div>

            <h2>{result.passed ? 'Geslaagd' : 'Nog niet gehaald'}</h2>
            <p style={{ color: 'var(--text-3)', margin: '8px 0 0' }}>
              Je score is {result.score}%. Je hebt {course.passScore}% nodig.
            </p>

            {result.passed && course.validMonths && (
              <p style={{ color: 'var(--text-3)', fontSize: '.85rem', marginTop: 6 }}>
                Deze cursus is {course.validMonths} maanden geldig. Daarna komt hij
                vanzelf weer op je lijst.
              </p>
            )}

            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              {!result.passed && (
                <button className="btn primary" onClick={retry}>
                  <RotateCcw size={15} /> Opnieuw proberen
                </button>
              )}
              <button className={`btn ${result.passed ? 'primary' : ''}`} onClick={onBack}>
                Terug naar het overzicht
              </button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 16, marginTop: 8 }}>
            <h3 style={{ marginBottom: 10 }}>Je antwoorden</h3>
            {course.quiz.map((q, i) => {
              const given = answers[q.id]
              const ok = given === q.correct
              return (
                <div key={q.id} style={{ marginBottom: 14 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    {ok
                      ? <Check size={16} color="var(--ok)" style={{ marginTop: 2, flex: 'none' }} />
                      : <X size={16} color="var(--danger)" style={{ marginTop: 2, flex: 'none' }} />}
                    <div>
                      <div style={{ fontSize: '.87rem', fontWeight: 600 }}>{i + 1}. {q.text}</div>
                      <div style={{ fontSize: '.82rem', color: ok ? 'var(--text-2)' : 'var(--danger)' }}>
                        Jouw antwoord: {q.options[given] ?? '—'}
                      </div>
                      {!ok && (
                        <div style={{ fontSize: '.82rem', color: 'var(--ok)' }}>
                          Juist: {q.options[q.correct]}
                        </div>
                      )}
                      {q.explain && (
                        <div style={{ fontSize: '.79rem', color: 'var(--text-3)', marginTop: 3 }}>
                          {q.explain}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </>
    )
  }

  /* ---------------- toets ---------------- */
  if (quizMode) {
    const beantwoord = Object.keys(answers).length
    return (
      <>
        <button className="btn ghost sm" onClick={() => setQuizMode(false)} style={{ marginBottom: 14 }}>
          <ArrowLeft size={15} /> Terug naar de lessen
        </button>

        <Card title={`Toets — ${course.title}`} hint={`${beantwoord} van ${course.quiz.length} beantwoord`}>
          <Bar value={beantwoord} max={course.quiz.length} />

          <div style={{ marginTop: 20, display: 'grid', gap: 22 }}>
            {course.quiz.map((q, i) => (
              <div key={q.id}>
                <div style={{ fontSize: '.93rem', fontWeight: 600, marginBottom: 10 }}>
                  {i + 1}. {q.text}
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {q.options.map((opt, oi) => {
                    const chosen = answers[q.id] === oi
                    return (
                      <button
                        key={oi}
                        className={`quiz-option ${chosen ? 'chosen' : ''}`}
                        onClick={() => setAnswers({ ...answers, [q.id]: oi })}
                      >
                        <span className="marker">{String.fromCharCode(65 + oi)}</span>
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="row end" style={{ marginTop: 24 }}>
            <button className="btn primary lg" onClick={() => void submitQuiz()}>
              Toets inleveren
            </button>
          </div>
        </Card>
      </>
    )
  }

  /* ---------------- les ---------------- */
  return (
    <>
      <button className="btn ghost sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ArrowLeft size={15} /> Terug naar het overzicht
      </button>

      <Card>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className={`course-cat cat-${course.category}`}>
            {COURSE_CATEGORIES[course.category]}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
            Les {step + 1} van {course.lessons.length}
          </span>
        </div>

        <h2 style={{ marginBottom: 4 }}>{course.title}</h2>
        <Bar value={step + 1} max={course.lessons.length + 1} />

        <motion.div
          key={lesson.id}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: .2 }}
          style={{ marginTop: 22 }}
        >
          <h3 style={{ fontSize: '1.1rem', marginBottom: 12 }}>{lesson.title}</h3>

          {lesson.body.map((para, i) => (
            <p key={i} style={{ fontSize: '.94rem', lineHeight: 1.65, color: 'var(--text-2)', margin: '0 0 14px' }}>
              {para}
            </p>
          ))}

          {lesson.keyPoints && lesson.keyPoints.length > 0 && (
            <div className="lesson-points">
              <div className="head">Onthoud dit</div>
              <ul>
                {lesson.keyPoints.map((k) => <li key={k}>{k}</li>)}
              </ul>
            </div>
          )}

          {lesson.warning && (
            <div className="lesson-warning">
              <TriangleAlert size={17} />
              <span>{lesson.warning}</span>
            </div>
          )}
        </motion.div>

        <div className="row" style={{ marginTop: 26 }}>
          <button
            className="btn"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            <ArrowLeft size={15} /> Vorige
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => void next()}>
            {isLast ? 'Naar de toets' : 'Volgende'} <ArrowRight size={15} />
          </button>
        </div>
      </Card>
    </>
  )
}
