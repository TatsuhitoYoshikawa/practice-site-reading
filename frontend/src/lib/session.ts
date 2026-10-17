import { clockSeconds, playNotes, scheduleNotes, startClock, stopAll } from './audio'
import { notesForHand } from './score'
import type { Mode, PracticeHand, Step } from './types'

/** テンポモードで正解とみなすタイミングのずれ（秒） */
export const TIMING_WINDOW_SEC = 0.15
/** テンポモード開始前のカウント数（拍） */
const COUNT_IN_BEATS = 4
/** ユーザーが鳴らす音の最短の長さ（秒） */
const MIN_USER_NOTE_SEC = 0.4

export interface SessionOptions {
  hand: PracticeHand
  mode: Mode
  /** テンポ倍率（1 = 楽譜どおり） */
  tempoRate: number
  accompaniment: boolean
  /** 全音符の長さ（秒、テンポ倍率適用前） */
  wholeNoteSec: number
}

export interface SessionResult {
  total: number
  correct: number
  accuracy: number
}

export interface SessionCallbacks {
  /** カーソルを置く Step の添字 */
  onCursor: (stepIndex: number) => void
  /** 正解の鍵盤として光らせる音 */
  onHints: (midis: number[]) => void
  onFlash: (midi: number, kind: 'correct' | 'wrong') => void
  /** テンポモードのカウントイン（残り拍数。0 で開始） */
  onCountIn: (remaining: number) => void
  onFinish: (result: SessionResult) => void
}

interface Target {
  stepIndex: number
  midis: number[]
  /** 練習用の時計での発音予定時刻（秒） */
  at: number
  /** 音の長さ（秒） */
  duration: number
  hit: Set<number>
  missed: boolean
  done: boolean
}

export class PracticeSession {
  private readonly targets: Target[]
  private readonly wholeSec: number
  /** 待機モード：次に弾く Target の添字 / テンポモード：判定が終わっていない最初の Target の添字 */
  private current = 0
  private startAt = 0
  private rafId = 0
  private finished = false
  private readonly steps: Step[]
  private readonly options: SessionOptions
  private readonly callbacks: SessionCallbacks

  constructor(steps: Step[], options: SessionOptions, callbacks: SessionCallbacks) {
    this.steps = steps
    this.options = options
    this.callbacks = callbacks
    const rate = options.mode === 'tempo' ? options.tempoRate : 1
    this.wholeSec = options.wholeNoteSec / rate
    this.targets = steps.flatMap((step, stepIndex) => {
      const midis = notesForHand(step, options.hand)
      if (midis.length === 0) return []
      const length = Math.max(...step.notes.filter((n) => n.hand === options.hand).map((n) => n.length))
      return [{
        stepIndex,
        midis,
        at: step.time * this.wholeSec,
        duration: length * this.wholeSec,
        hit: new Set<number>(),
        missed: false,
        done: false,
      }]
    })
  }

  get totalTargets(): number {
    return this.targets.length
  }

  start(): void {
    startClock()
    if (this.targets.length === 0) {
      this.finish()
      return
    }
    if (this.options.mode === 'wait') this.startWaitMode()
    else this.startTempoMode()
  }

  stop(): void {
    this.finished = true
    cancelAnimationFrame(this.rafId)
    stopAll()
  }

  press(midi: number): void {
    if (this.finished) return
    if (this.options.mode === 'wait') this.pressWaitMode(midi)
    else this.pressTempoMode(midi)
  }

  // ---- 待機モード ----

  private startWaitMode(): void {
    // 最初に弾く音より前にある伴奏を鳴らしてから待つ
    this.scheduleAccompaniment(0, this.targets[0].stepIndex, 0, 0)
    this.callbacks.onCursor(this.targets[0].stepIndex)
  }

  private pressWaitMode(midi: number): void {
    const target = this.targets[this.current]
    if (!target.midis.includes(midi)) {
      target.missed = true
      this.callbacks.onFlash(midi, 'wrong')
      this.callbacks.onHints(target.midis.filter((m) => !target.hit.has(m)))
      return
    }
    playNotes([midi], Math.max(target.duration, MIN_USER_NOTE_SEC))
    this.callbacks.onFlash(midi, 'correct')
    target.hit.add(midi)
    const remaining = target.midis.filter((m) => !target.hit.has(m))
    if (remaining.length > 0) {
      if (target.missed) this.callbacks.onHints(remaining)
      return
    }

    target.done = true
    this.callbacks.onHints([])
    const next = this.targets[this.current + 1]
    const nextStepIndex = next ? next.stepIndex : this.steps.length
    // 今弾いた位置から次に弾く位置の手前までの伴奏を、楽譜どおりの間隔で鳴らす
    this.scheduleAccompaniment(target.stepIndex, nextStepIndex, clockSeconds(), this.steps[target.stepIndex].time)
    this.current++
    if (next) {
      this.callbacks.onCursor(next.stepIndex)
    } else {
      this.callbacks.onCursor(this.steps.length - 1)
      this.finish()
    }
  }

  // ---- テンポモード ----

  private startTempoMode(): void {
    const beatSec = this.wholeSec / 4
    this.startAt = COUNT_IN_BEATS * beatSec
    this.scheduleAccompaniment(0, this.steps.length, this.startAt, 0)
    this.callbacks.onCountIn(COUNT_IN_BEATS)
    const lastStep = this.steps[this.steps.length - 1]
    const lastLength = Math.max(0, ...lastStep.notes.map((n) => n.length))
    const endAt = (lastStep.time + lastLength) * this.wholeSec + 0.5

    let cursor = -1
    let countIn = COUNT_IN_BEATS
    const tick = () => {
      if (this.finished) return
      const elapsed = clockSeconds() - this.startAt
      if (elapsed < 0) {
        const remaining = Math.ceil(-elapsed / beatSec)
        if (remaining !== countIn) {
          countIn = remaining
          this.callbacks.onCountIn(remaining)
        }
      } else if (countIn !== 0) {
        countIn = 0
        this.callbacks.onCountIn(0)
      }

      // 時刻を過ぎた Step にカーソルを進める
      let next = cursor
      while (next + 1 < this.steps.length && this.steps[next + 1].time * this.wholeSec <= elapsed) next++
      if (next !== cursor && next >= 0) {
        cursor = next
        this.callbacks.onCursor(cursor)
      }

      // 判定の受付時間を過ぎた音は弾き逃しにする
      while (this.current < this.targets.length && this.targets[this.current].at + TIMING_WINDOW_SEC < elapsed) {
        const target = this.targets[this.current]
        if (!target.done) {
          target.missed = true
          this.callbacks.onHints(target.midis)
        } else if (!target.missed) {
          this.callbacks.onHints([])
        }
        this.current++
      }

      if (elapsed > endAt) {
        this.finish()
        return
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private pressTempoMode(midi: number): void {
    const elapsed = clockSeconds() - this.startAt
    const inWindow = this.targets.filter((t) => !t.done && Math.abs(t.at - elapsed) <= TIMING_WINDOW_SEC)
    const target = inWindow
      .filter((t) => t.midis.includes(midi) && !t.hit.has(midi))
      .sort((a, b) => Math.abs(a.at - elapsed) - Math.abs(b.at - elapsed))[0]

    if (!target) {
      this.callbacks.onFlash(midi, 'wrong')
      // 近くに弾くべき音があればその音を間違えたことにする
      const nearest = inWindow.sort((a, b) => Math.abs(a.at - elapsed) - Math.abs(b.at - elapsed))[0]
      if (nearest) {
        nearest.missed = true
        this.callbacks.onHints(nearest.midis.filter((m) => !nearest.hit.has(m)))
      }
      return
    }

    playNotes([midi], Math.max(target.duration, MIN_USER_NOTE_SEC))
    this.callbacks.onFlash(midi, 'correct')
    target.hit.add(midi)
    if (target.midis.every((m) => target.hit.has(m))) {
      target.done = true
      this.callbacks.onHints([])
    }
  }

  // ---- 共通 ----

  /**
   * steps[from, to) のうち練習していない手の音を、伴奏として予約する。
   * @param clockAt baseTime の位置を鳴らす練習用の時計の時刻（秒）
   * @param baseTime 基準となる楽譜上の時間（全音符 = 1）
   */
  private scheduleAccompaniment(from: number, to: number, clockAt: number, baseTime: number): void {
    if (!this.options.accompaniment) return
    for (let i = from; i < to; i++) {
      const step = this.steps[i]
      const at = clockAt + (step.time - baseTime) * this.wholeSec
      for (const note of step.notes) {
        if (note.hand === this.options.hand) continue
        scheduleNotes([note.midi], note.length * this.wholeSec, at)
      }
    }
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    cancelAnimationFrame(this.rafId)
    const total = this.targets.length
    const correct = this.targets.filter((t) => t.done && !t.missed).length
    this.callbacks.onHints([])
    this.callbacks.onFinish({ total, correct, accuracy: total === 0 ? 1 : correct / total })
  }
}
