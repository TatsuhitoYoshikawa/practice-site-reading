import * as Tone from 'tone'

// Salamander Grand Piano（CC BY 3.0, Alexander Holm）。Tone.js がホストしているサンプルを使う
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4',
  'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8']

/** サンプルは半音3つおきに用意されているので、音域の外側もこの分だけ読み込む */
const SAMPLE_INTERVAL = 3

export type PianoStatus = 'idle' | 'loading' | 'ready' | 'failed'

let sampler: Tone.Sampler | null = null
let fallback: Tone.PolySynth | null = null
const requestedSamples = new Set<string>()
let pendingSamples = 0
let loadedSamples = 0
const statusListeners = new Set<(status: PianoStatus) => void>()

export function pianoStatus(): PianoStatus {
  if (pendingSamples > 0) return 'loading'
  if (loadedSamples > 0) return 'ready'
  return requestedSamples.size > 0 ? 'failed' : 'idle'
}

/** ピアノ音の読み込み状況の変化を受け取る。戻り値で購読をやめる */
export function subscribePianoStatus(listener: (status: PianoStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function notifyStatus(): void {
  const status = pianoStatus()
  for (const listener of statusListeners) listener(status)
}

function getInstrument(): Tone.Sampler | Tone.PolySynth {
  if (sampler && pianoStatus() === 'ready') return sampler
  // サンプルの読み込みが終わるまで（または読み込めなかったとき）は簡易シンセで鳴らす
  fallback ??= new Tone.PolySynth(Tone.Synth, { volume: -8 }).toDestination()
  return fallback
}

/**
 * 曲の音域（MIDI ノート番号）を鳴らすのに必要なピアノのサンプルだけを読み込み始める。
 * 練習画面を開いた時点で呼び、スタートまでに読み込みを済ませておく。
 */
export function preloadPiano(low: number, high: number): void {
  const target = (sampler ??= new Tone.Sampler({ release: 1 }).toDestination())
  for (const note of SAMPLE_NOTES) {
    const midi = Tone.Frequency(note).toMidi()
    if (midi < low - SAMPLE_INTERVAL || midi > high + SAMPLE_INTERVAL || requestedSamples.has(note)) continue
    requestedSamples.add(note)
    pendingSamples++
    const buffer = new Tone.ToneAudioBuffer(
      `${SAMPLE_BASE_URL}${note.replace('#', 's')}.mp3`,
      () => {
        target.add(note as Tone.Unit.Note, buffer)
        loadedSamples++
        pendingSamples--
        notifyStatus()
      },
      () => {
        pendingSamples--
        notifyStatus()
      },
    )
  }
  notifyStatus()
}

/** ユーザー操作の中で呼び、音声出力を有効にする（ブラウザの自動再生制限のため） */
export async function startAudio(): Promise<void> {
  await Tone.start()
}

export function now(): number {
  return Tone.now()
}

/**
 * 音を鳴らす。
 * @param when Tone.now() 基準の発音時刻（省略時は即時）
 */
export function playNotes(midis: number[], durationSec: number, when?: number, velocity = 0.8): void {
  if (midis.length === 0) return
  const names = midis.map((m) => Tone.Frequency(m, 'midi').toNote())
  getInstrument().triggerAttackRelease(names, Math.max(durationSec, 0.1), when, velocity)
}

/** 練習用の時計（Transport）を0秒から動かし始める */
export function startClock(): void {
  const transport = Tone.getTransport()
  transport.stop()
  transport.cancel()
  transport.start()
}

/** 練習用の時計の現在時刻（秒） */
export function clockSeconds(): number {
  return Tone.getTransport().seconds
}

/** 練習用の時計の時刻 at（秒）に音を鳴らすよう予約する */
export function scheduleNotes(midis: number[], durationSec: number, at: number, velocity = 0.6): void {
  if (midis.length === 0) return
  Tone.getTransport().schedule((time) => playNotes(midis, durationSec, time, velocity), at)
}

/** 時計を止め、予約済みの発音を取り消して鳴っている音を止める */
export function stopAll(): void {
  const transport = Tone.getTransport()
  transport.stop()
  transport.cancel()
  sampler?.releaseAll()
  fallback?.releaseAll()
}
