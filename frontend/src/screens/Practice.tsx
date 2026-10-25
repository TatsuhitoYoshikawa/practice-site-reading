import { useEffect, useMemo, useRef, useState } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { Keyboard, type KeyFlash } from '../components/Keyboard'
import { Loading } from '../components/Loading'
import { audioReady, pianoStatus, preloadPiano, startAudio, subscribePianoStatus } from '../lib/audio'
import { db } from '../lib/db'
import { keyboardRange } from '../lib/keyboard'
import { buildSteps, getBpm, noteRange, wholeNoteSeconds } from '../lib/score'
import { PracticeSession, type SessionResult } from '../lib/session'
import type { Hand, Mode, PracticeHand, Step, StoredScore } from '../lib/types'

export interface PracticeSettings {
  hand: PracticeHand
  mode: Mode
  tempoRate: number
  accompaniment: boolean
}

/**
 * カーソルのある段が見えるように楽譜をスクロールする。
 * 段が表示枠より高いときは、練習している手の譜表（右手なら上端、左手なら下端まで）を優先して見せる
 */
function scrollToCursor(osmd: OpenSheetMusicDisplay, container: HTMLElement, staffHands: Hand[], hand: PracticeHand) {
  const measures = osmd.GraphicSheet.MeasureList[osmd.cursor.Iterator.CurrentMeasureIndex]
  if (!measures) return
  const measure = measures[staffHands.indexOf(hand)] ?? measures.find(Boolean)
  if (!measure) return

  const svg = container.querySelector('svg')
  const offset = svg ? svg.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop : 0
  const view = container.clientHeight
  const [systemTop, systemBottom] = verticalExtent(measure.ParentMusicSystem.PositionAndShape, osmd.Zoom)
  let top: number
  if (systemBottom - systemTop + 2 * SCORE_MARGIN_PX <= view) {
    top = systemTop - (view - (systemBottom - systemTop)) / 2
  } else {
    const [staffTop, staffBottom] = verticalExtent(measure.ParentStaffLine.PositionAndShape, osmd.Zoom)
    top = hand === 'right' ? staffTop - SCORE_MARGIN_PX : staffBottom - view + SCORE_MARGIN_PX
  }
  top = Math.max(0, top + offset)
  if (Math.abs(container.scrollTop - top) > 1) container.scrollTo({ top, behavior: 'smooth' })
}

interface Props {
  score: StoredScore
  settings: PracticeSettings
  onExit: () => void
}

const FLASH_MS = 250
/** 楽譜の表示倍率。1段（右手と左手の組）が表示枠に収まらない曲では MIN_ZOOM まで縮める */
const BASE_ZOOM = 0.75
const MIN_ZOOM = 0.55
/** OSMD の座標1単位あたりのピクセル数（倍率1のとき） */
const OSMD_UNIT_PX = 10
/** 段の上下に空ける余白（px）。OSMD の領域は加線の端などを数px小さく見積もるので、その分も含める */
const SCORE_MARGIN_PX = 12

interface VerticalBox {
  AbsolutePosition: { y: number }
  BorderMarginTop: number
  BorderMarginBottom: number
}

/** OSMD の領域（五線の外にはみ出した音符も含む）の上端・下端を、楽譜の SVG 上のピクセルで返す */
function verticalExtent(box: VerticalBox, zoom: number): [number, number] {
  const scale = OSMD_UNIT_PX * zoom
  return [(box.AbsolutePosition.y + box.BorderMarginTop) * scale, (box.AbsolutePosition.y + box.BorderMarginBottom) * scale]
}

/** 一番高い段が表示枠に収まる倍率（MIN_ZOOM〜BASE_ZOOM）。段の高さは倍率にほぼ比例する */
function fittingZoom(osmd: OpenSheetMusicDisplay, viewHeight: number): number {
  const systems = osmd.GraphicSheet.MusicPages.flatMap((page) => page.MusicSystems)
  const tallest = Math.max(...systems.map((system) => {
    const [top, bottom] = verticalExtent(system.PositionAndShape, osmd.Zoom)
    return bottom - top
  }))
  const available = viewHeight - 2 * SCORE_MARGIN_PX
  return Math.min(BASE_ZOOM, Math.max(MIN_ZOOM, (osmd.Zoom * available) / tallest))
}

/**
 * 表示枠に合わせて倍率を変え、描き直す（カーソル位置は呼び出し側で戻す）。
 * 幅が変わったとき（全画面・回転）は段の折り返しも変わるので、force で描き直す
 * @returns 描き直したか
 */
function renderToFit(osmd: OpenSheetMusicDisplay, container: HTMLElement, force = false): boolean {
  const zoom = fittingZoom(osmd, container.clientHeight)
  if (!force && Math.abs(zoom - osmd.Zoom) < 0.02) return false
  osmd.Zoom = zoom
  osmd.render()
  osmd.cursor.show()
  return true
}

export function Practice({ score, settings, onExit }: Props) {
  const scoreRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const cursorIndexRef = useRef(0)
  /** 楽譜を描いたときの表示枠の幅 */
  const renderedWidthRef = useRef(0)
  const sessionRef = useRef<PracticeSession | null>(null)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [wholeNoteSec, setWholeNoteSec] = useState(2.4)
  const [hints, setHints] = useState<Set<number>>(new Set())
  const [held, setHeld] = useState<Set<number>>(new Set())
  const [playing, setPlaying] = useState<Set<number>>(new Set())
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
      // 8分・16分音符を連桁でつなぐ（楽譜データに連桁の指定がなくても読みやすくする）
      autoBeam: true,
    })
    osmd.load(score.musicXml).then(() => {
      if (cancelled) return
      osmd.Zoom = BASE_ZOOM
      osmd.render()
      osmd.cursor.show()
      renderToFit(osmd, container)
      renderedWidthRef.current = container.clientWidth
      osmdRef.current = osmd
      cursorIndexRef.current = 0
      scrollToCursor(osmd, container, score.staffHands, settings.hand)
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
  }, [score, settings.hand])

  // 全画面にした・画面を回転したなどで表示枠が変わったら、倍率を合わせ直してカーソル位置を戻す
  useEffect(() => {
    let timer = 0
    const onResize = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const osmd = osmdRef.current
        const container = scoreRef.current
        if (!osmd || !container) return
        const index = cursorIndexRef.current
        const widthChanged = container.clientWidth !== renderedWidthRef.current
        if (!renderToFit(osmd, container, widthChanged)) {
          scrollToCursor(osmd, container, score.staffHands, settings.hand)
          return
        }
        renderedWidthRef.current = container.clientWidth
        osmd.cursor.reset()
        for (let i = 0; i < index; i++) osmd.cursor.next()
        scrollToCursor(osmd, container, score.staffHands, settings.hand)
      }, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [score, settings.hand])

  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null)
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
        // 対応している端末では横向きに固定する（できなくても続ける）
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')
      }
    } catch {
      // 全画面や向きの固定に対応していない端末では何もしない
    }
  }

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
    if (scoreRef.current) scrollToCursor(osmd, scoreRef.current, score.staffHands, settings.hand)
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

  /**
   * 練習を始める。
   * @param withAudio ボタン操作から呼ぶときは true（このときに音声出力を有効にする）。
   *   待機モードの自動開始では false にし、最初の鍵盤タップで有効にする
   */
  const start = async (withAudio = true) => {
    if (!steps) return
    if (withAudio) await startAudio()
    sessionRef.current?.stop()
    moveCursor(0)
    setResult(null)
    setHints(new Set())
    setHeld(new Set())
    const session = new PracticeSession(steps, { ...settings, wholeNoteSec }, {
      onCursor: moveCursor,
      onHints: (midis) => setHints(new Set(midis)),
      onHeld: (midis) => setHeld(new Set(midis)),
      onPlaying: (midis) => setPlaying(new Set(midis)),
      onFlash: flash,
      onCountIn: setCountIn,
      onFinish: (r) => {
        setRunning(false)
        setResult(r)
        if (score.id !== undefined && settings.mode !== 'demo') {
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

  // 待機モードはスタートボタンなしで、楽譜の準備ができたらすぐ始める
  useEffect(() => {
    if (settings.mode === 'wait' && steps && !sessionRef.current) start(false)
    // start は描画ごとに作り直されるが、ここでは楽譜の準備ができたときに一度だけ呼べばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, settings.mode])

  const press = (midi: number) => {
    if (audioReady()) {
      sessionRef.current?.press(midi)
      return
    }
    // 最初のタップで音声出力を有効にしてから判定する
    startAudio().then(() => sessionRef.current?.press(midi))
  }

  const stop = () => {
    sessionRef.current?.stop()
    setRunning(false)
    setCountIn(0)
    setHints(new Set())
    setHeld(new Set())
    setPlaying(new Set())
  }

  const handLabel = settings.hand === 'right' ? '右手' : '左手'
  const rateLabel = `${Math.round(settings.tempoRate * 100)}%`
  const modeLabel = settings.mode === 'wait'
    ? '待機モード'
    : settings.mode === 'tempo' ? `テンポモード ${rateLabel}` : `お手本 ${rateLabel}`

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
        {document.fullscreenEnabled && (
          <button onClick={toggleFullscreen}>{fullscreen ? '全画面を終了' : '全画面'}</button>
        )}
        {settings.mode !== 'wait' && (running
          ? <button onClick={stop}>停止</button>
          : (
            <button className="primary" onClick={() => start()} disabled={!steps}>
              {!steps ? '準備中…' : result ? 'もう一度' : 'スタート'}
            </button>
          ))}
      </header>
      <div className="score-area" ref={scoreRef} />
      {!steps && !error && <Loading overlay message="楽譜を表示中…" />}
      {error && <div className="overlay"><p>{error}</p></div>}
      {countIn > 0 && <div className="overlay count-in">{countIn}</div>}
      {result && (
        <div className="overlay">
          <div className="result">
            {settings.mode === 'demo' ? (
              <p><strong>おしまい</strong></p>
            ) : (
              <>
                <p>正答率 <strong>{Math.round(result.accuracy * 100)}%</strong></p>
                <p>{result.correct} / {result.total} 音</p>
              </>
            )}
            <div className="actions">
              <button className="primary" onClick={() => start()}>もう一度</button>
              <button onClick={onExit}>戻る</button>
            </div>
          </div>
        </div>
      )}
      <Keyboard range={range} hints={hints} held={held} playing={playing} flashes={flashes} onPress={press} />
    </div>
  )
}
