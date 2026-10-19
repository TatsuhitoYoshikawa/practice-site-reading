import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { Keyboard, type KeyFlash } from '../components/Keyboard'
import { Loading } from '../components/Loading'
import { pianoStatus, preloadPiano, startAudio, subscribePianoStatus } from '../lib/audio'
import { db } from '../lib/db'
import { keyboardRange } from '../lib/keyboard'
import { buildSteps, getBpm, noteRange, wholeNoteSeconds } from '../lib/score'
import { PracticeSession, type SessionResult } from '../lib/session'
import type { Mode, PracticeHand, Step, StoredScore } from '../lib/types'

export interface PracticeSettings {
  hand: PracticeHand
  mode: Mode
  tempoRate: number
  accompaniment: boolean
}

interface Props {
  score: StoredScore
  settings: PracticeSettings
  onExit: () => void
}

const FLASH_MS = 250

export function Practice({ score, settings, onExit }: Props) {
  const scoreRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const cursorIndexRef = useRef(0)
  const sessionRef = useRef<PracticeSession | null>(null)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [wholeNoteSec, setWholeNoteSec] = useState(2.4)
  const [hints, setHints] = useState<Set<number>>(new Set())
  const [flashes, setFlashes] = useState<Map<number, KeyFlash>>(new Map())
  const [countIn, setCountIn] = useState(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [piano, setPiano] = useState(pianoStatus)

  useEffect(() => subscribePianoStatus(setPiano), [])

  // 楽譜を描画し、カーソル位置の一覧を作る
  useEffect(() => {
    const container = scoreRef.current
    if (!container) return
    let cancelled = false
    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawingParameters: 'compacttight',
      followCursor: true,
    })
    osmd.load(score.musicXml).then(() => {
      if (cancelled) return
      osmd.Zoom = 0.75
      osmd.render()
      osmd.cursor.show()
      osmdRef.current = osmd
      const built = buildSteps(osmd, score.staffHands)
      const midis = built.flatMap((step) => step.notes.map((n) => n.midi))
      if (midis.length > 0) preloadPiano(Math.min(...midis), Math.max(...midis))
      setSteps(built)
      setWholeNoteSec(wholeNoteSeconds(getBpm(osmd.Sheet)))
    }).catch((e: unknown) => {
      if (!cancelled) setError(`楽譜を読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`)
    })
    return () => {
      cancelled = true
      sessionRef.current?.stop()
      container.innerHTML = ''
    }
  }, [score])

  const range = useMemo(
    () => keyboardRange(steps ? noteRange(steps, settings.hand) : null),
    [steps, settings.hand],
  )

  const moveCursor = (stepIndex: number) => {
    const osmd = osmdRef.current
    if (!osmd) return
    if (stepIndex < cursorIndexRef.current) {
      osmd.cursor.reset()
      cursorIndexRef.current = 0
    }
    while (cursorIndexRef.current < stepIndex) {
      osmd.cursor.next()
      cursorIndexRef.current++
    }
  }

  const flash = (midi: number, kind: KeyFlash) => {
    setFlashes((prev) => new Map(prev).set(midi, kind))
    setTimeout(() => {
      setFlashes((prev) => {
        if (prev.get(midi) !== kind) return prev
        const next = new Map(prev)
        next.delete(midi)
        return next
      })
    }, FLASH_MS)
  }

  const start = async () => {
    if (!steps) return
    await startAudio()
    sessionRef.current?.stop()
    moveCursor(0)
    setResult(null)
    setHints(new Set())
    const session = new PracticeSession(steps, { ...settings, wholeNoteSec }, {
      onCursor: moveCursor,
      onHints: (midis) => setHints(new Set(midis)),
      onFlash: flash,
      onCountIn: setCountIn,
      onFinish: (r) => {
        setRunning(false)
        setResult(r)
        if (score.id !== undefined) {
          db.practiceLogs.add({
            scoreId: score.id,
            hand: settings.hand,
            mode: settings.mode,
            tempoRate: settings.tempoRate,
            accuracy: r.accuracy,
            playedAt: Date.now(),
          })
        }
      },
    })
    sessionRef.current = session
    setRunning(true)
    session.start()
  }

  const stop = () => {
    sessionRef.current?.stop()
    setRunning(false)
    setCountIn(0)
    setHints(new Set())
  }

  const handLabel = settings.hand === 'right' ? '右手' : '左手'
  const modeLabel = settings.mode === 'wait'
    ? '待機モード'
    : `テンポモード ${Math.round(settings.tempoRate * 100)}%`

  return (
    <div className="practice">
      <header className="practice-bar">
        <button onClick={() => { stop(); onExit() }}>← 戻る</button>
        <span className="practice-title">{score.title}</span>
        {piano === 'loading' && (
          <span className="badge"><span className="spinner small" aria-hidden="true" />ピアノ音を読み込み中（簡易音で鳴ります）</span>
        )}
        {piano === 'failed' && <span className="badge">ピアノ音を読み込めませんでした（簡易音で鳴ります）</span>}
        <span className="practice-meta">{handLabel} / {modeLabel}</span>
        {running
          ? <button onClick={stop}>停止</button>
          : (
            <button className="primary" onClick={start} disabled={!steps}>
              {!steps ? '準備中…' : result ? 'もう一度' : 'スタート'}
            </button>
          )}
      </header>
      <div className="score-area" ref={scoreRef} />
      {!steps && !error && <Loading overlay message="楽譜を表示中…" />}
      {error && <div className="overlay"><p>{error}</p></div>}
      {countIn > 0 && <div className="overlay count-in">{countIn}</div>}
      {result && (
        <div className="overlay">
          <div className="result">
            <p>正答率 <strong>{Math.round(result.accuracy * 100)}%</strong></p>
            <p>{result.correct} / {result.total} 音</p>
            <div className="actions">
              <button className="primary" onClick={start}>もう一度</button>
              <button onClick={onExit}>戻る</button>
            </div>
          </div>
        </div>
      )}
      <Keyboard range={range} hints={hints} flashes={flashes} onPress={(m) => sessionRef.current?.press(m)} />
    </div>
  )
}
