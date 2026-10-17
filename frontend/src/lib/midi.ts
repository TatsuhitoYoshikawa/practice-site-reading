import { Midi } from '@tonejs/midi'

/** 4分音符あたりの分割数（16分音符単位に量子化する） */
const DIVISIONS = 4

/** [長さ（16分音符単位）, 音符の種類, 付点] 長い順 */
const NOTE_VALUES: [number, string, boolean][] = [
  [16, 'whole', false], [12, 'half', true], [8, 'half', false], [6, 'quarter', true],
  [4, 'quarter', false], [3, 'eighth', true], [2, 'eighth', false], [1, '16th', false],
]

// @tonejs/midi が返す調名（関係長調の名前）。添字 - 7 が五度圏上の位置（シャープ/フラットの数）
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']

const SHARP_SPELLING: [string, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
]
const FLAT_SPELLING: [string, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
]

const DEFAULT_BPM = 120

interface QuantizedNote {
  start: number
  end: number
  midi: number
}

/** 譜表の1つの声部上の出来事。pitches が空なら休符 */
interface StaffEvent {
  start: number
  duration: number
  pitches: number[]
}

/** 小節内に書き出す1つの音符（または休符） */
interface Piece {
  duration: number
  pitches: number[]
  tieStart: boolean
  tieStop: boolean
}

/**
 * MIDI を2段譜（上段=ト音記号、下段=ヘ音記号）の MusicXML に変換する。
 * 譜読み練習用の簡易変換で、16分音符単位に量子化し、各段を1声部（和音つき）にまとめる。
 */
export function midiToMusicXml(data: ArrayBuffer | Uint8Array, title: string): string {
  return convertMidi(new Midi(data), title)
}

export function convertMidi(midi: Midi, title: string): string {
  const tickPerUnit = midi.header.ppq / DIVISIONS
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && !t.instrument.percussion)
  if (tracks.length === 0) throw new Error('MIDI に音符が含まれていません')

  const quantize = (ticks: number, durationTicks: number, pitch: number): QuantizedNote => {
    const start = Math.round(ticks / tickPerUnit)
    const end = Math.max(start + 1, Math.round((ticks + durationTicks) / tickPerUnit))
    return { start, end, midi: pitch }
  }

  // トラックが2つなら音の高い方を上段に、それ以外は中央ドを境に上下に分ける
  const staves: QuantizedNote[][] = [[], []]
  if (tracks.length === 2) {
    const average = (t: (typeof tracks)[number]) => t.notes.reduce((sum, n) => sum + n.midi, 0) / t.notes.length
    const [upper, lower] = average(tracks[0]) >= average(tracks[1]) ? tracks : [tracks[1], tracks[0]]
    staves[0] = upper.notes.map((n) => quantize(n.ticks, n.durationTicks, n.midi))
    staves[1] = lower.notes.map((n) => quantize(n.ticks, n.durationTicks, n.midi))
  } else {
    for (const n of tracks.flatMap((t) => t.notes)) {
      staves[n.midi >= 60 ? 0 : 1].push(quantize(n.ticks, n.durationTicks, n.midi))
    }
  }

  let [beats, beatType] = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4]
  let measureLength = (beats * DIVISIONS * 4) / beatType
  if (!Number.isInteger(measureLength) || measureLength <= 0) {
    ;[beats, beatType, measureLength] = [4, 4, DIVISIONS * 4]
  }
  const lastEnd = Math.max(...staves.flat().map((n) => n.end))
  const measureCount = Math.max(1, Math.ceil(lastEnd / measureLength))
  const totalLength = measureCount * measureLength

  const keyIndex = KEY_NAMES.indexOf(midi.header.keySignatures[0]?.key ?? 'C')
  const fifths = keyIndex >= 0 ? keyIndex - 7 : 0
  const spelling = fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? DEFAULT_BPM)

  const measurePieces = staves.map((notes) =>
    splitIntoMeasures(toEvents(notes, totalLength), measureLength, measureCount),
  )

  const measures: string[] = []
  for (let m = 0; m < measureCount; m++) {
    const parts = [`<measure number="${m + 1}">`]
    if (m === 0) {
      parts.push(
        `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths></key>`
          + `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>`
          + '<clef number="1"><sign>G</sign><line>2</line></clef>'
          + '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
          + '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
          + `<per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`,
      )
    }
    measurePieces.forEach((pieces, staffIndex) => {
      if (staffIndex > 0) parts.push(`<backup><duration>${measureLength}</duration></backup>`)
      const staff = staffIndex + 1
      const voice = staffIndex === 0 ? 1 : 5
      const measure = pieces[m]
      if (measure.length === 1 && measure[0].pitches.length === 0) {
        parts.push(`<note><rest measure="yes"/><duration>${measureLength}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`)
        return
      }
      for (const piece of measure) parts.push(...pieceXml(piece, staff, voice, spelling))
    })
    if (m === measureCount - 1) parts.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
    parts.push('</measure>')
    measures.push(parts.join(''))
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
    + '"http://www.musicxml.org/dtds/partwise.dtd">\n'
    + '<score-partwise version="4.0">'
    + `<work><work-title>${escapeXml(title)}</work-title></work>`
    + '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
    + `<part id="P1">${measures.join('\n')}</part></score-partwise>\n`
}

/** 同時に鳴り始める音を和音にまとめ、次の音の開始で切って、隙間を休符で埋める */
function toEvents(notes: QuantizedNote[], totalLength: number): StaffEvent[] {
  const byStart = new Map<number, QuantizedNote[]>()
  for (const n of notes) byStart.set(n.start, [...(byStart.get(n.start) ?? []), n])
  const starts = [...byStart.keys()].sort((a, b) => a - b)

  const events: StaffEvent[] = []
  let cursor = 0
  starts.forEach((start, i) => {
    if (start > cursor) events.push({ start: cursor, duration: start - cursor, pitches: [] })
    const group = byStart.get(start)!
    const nextStart = starts[i + 1] ?? totalLength
    const end = Math.min(Math.max(...group.map((n) => n.end)), nextStart)
    const pitches = [...new Set(group.map((n) => n.midi))].sort((a, b) => a - b)
    events.push({ start, duration: end - start, pitches })
    cursor = end
  })
  if (cursor < totalLength) events.push({ start: cursor, duration: totalLength - cursor, pitches: [] })
  return events
}

/** 出来事を小節線と音価で区切り、小節ごとの音符の並びにする（区切った音はタイでつなぐ） */
function splitIntoMeasures(events: StaffEvent[], measureLength: number, measureCount: number): Piece[][] {
  const measures: Piece[][] = Array.from({ length: measureCount }, () => [])
  for (const event of events) {
    const isNote = event.pitches.length > 0
    let position = event.start
    const end = event.start + event.duration
    while (position < end) {
      const measureIndex = Math.floor(position / measureLength)
      const measureEnd = (measureIndex + 1) * measureLength
      const chunk = Math.min(end, measureEnd) - position
      for (const value of decompose(chunk)) {
        measures[measureIndex].push({
          duration: value,
          pitches: event.pitches,
          tieStop: isNote && position > event.start,
          tieStart: isNote && position + value < end,
        })
        position += value
      }
    }
  }
  return measures
}

/** 長さを書き表せる音価の組み合わせに分ける */
function decompose(length: number): number[] {
  const values: number[] = []
  let rest = length
  while (rest > 0) {
    const [value] = NOTE_VALUES.find(([v]) => v <= rest)!
    values.push(value)
    rest -= value
  }
  return values
}

function pieceXml(piece: Piece, staff: number, voice: number, spelling: [string, number][]): string[] {
  const [, type, dotted] = NOTE_VALUES.find(([v]) => v === piece.duration)!
  const common = `<duration>${piece.duration}</duration>`
  const tail = `<voice>${voice}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff>`
  if (piece.pitches.length === 0) return [`<note><rest/>${common}${tail}</note>`]

  return piece.pitches.map((midi, i) => {
    const [step, alter] = spelling[midi % 12]
    const octave = Math.floor(midi / 12) - 1
    const ties = (piece.tieStop ? '<tie type="stop"/>' : '') + (piece.tieStart ? '<tie type="start"/>' : '')
    const tied = (piece.tieStop ? '<tied type="stop"/>' : '') + (piece.tieStart ? '<tied type="start"/>' : '')
    return '<note>'
      + (i > 0 ? '<chord/>' : '')
      + `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`
      + common + ties + tail
      + (tied ? `<notations>${tied}</notations>` : '')
      + '</note>'
  })
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
