import * as Tone from 'tone'

// Salamander Grand Piano（CC BY 3.0, Alexander Holm）。Tone.js がホストしているサンプルを使う
const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/'
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4',
  'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8']

let sampler: Tone.Sampler | null = null
let fallback: Tone.PolySynth | null = null
let loaded = false

function getInstrument(): Tone.Sampler | Tone.PolySynth {
  if (!sampler) {
    sampler = new Tone.Sampler({
      urls: Object.fromEntries(SAMPLE_NOTES.map((n) => [n, `${n.replace('#', 's')}.mp3`])),
      baseUrl: SAMPLE_BASE_URL,
      release: 1,
      onload: () => {
        loaded = true
      },
    }).toDestination()
  }
  if (loaded) return sampler
  // サンプルの読み込みが終わるまでは簡易シンセで鳴らす
  fallback ??= new Tone.PolySynth(Tone.Synth, { volume: -8 }).toDestination()
  return fallback
}

/** ユーザー操作の中で呼び、音声出力を有効にする（ブラウザの自動再生制限のため） */
export async function startAudio(): Promise<void> {
  await Tone.start()
  getInstrument()
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
