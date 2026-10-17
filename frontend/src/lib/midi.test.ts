import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { convertMidi, midiToMusicXml } from './midi'

const PPQ = 480

function buildMidi(tracks: { midi: number; beat: number; beats: number }[][], setup?: (m: Midi) => void) {
  const midi = new Midi()
  midi.header.setTempo(90)
  setup?.(midi)
  for (const notes of tracks) {
    const track = midi.addTrack()
    for (const n of notes) track.addNote({ midi: n.midi, ticks: n.beat * PPQ, durationTicks: n.beats * PPQ })
  }
  return midi.toArray()
}

/** 小節ごと・段ごとの音の長さの合計（和音の2音目以降は数えない） */
function measureDurations(xml: string): number[][] {
  return xml.split('<measure ').slice(1).map((measure) =>
    measure.split('<backup>').map((staff) =>
      [...staff.matchAll(/<note>(<chord\/>)?.*?<duration>(\d+)<\/duration>/g)]
        .filter((m) => !m[1])
        .reduce((sum, m) => sum + Number(m[2]), 0),
    ),
  )
}

describe('midiToMusicXml', () => {
  it('1トラックを中央ドを境に上下の段に分け、各小節を埋める', () => {
    const xml = midiToMusicXml(buildMidi([[
      { midi: 60, beat: 0, beats: 1 },
      { midi: 64, beat: 1, beats: 1 },
      { midi: 48, beat: 0, beats: 4 },
      { midi: 67, beat: 2, beats: 4 }, // 小節をまたぐ
    ]]), 'テスト')
    expect(xml).toContain('<work-title>テスト</work-title>')
    expect(xml).toContain('<sound tempo="90"/>')
    expect(measureDurations(xml)).toEqual([[16, 16], [16, 16]])
    // 小節をまたいだ G4 はタイでつながる
    expect(xml).toMatch(/<step>G<\/step><octave>4<\/octave><\/pitch><duration>8<\/duration><tie type="start"\/>/)
    expect(xml).toMatch(/<step>G<\/step><octave>4<\/octave><\/pitch><duration>8<\/duration><tie type="stop"\/>/)
    // 下段の C3 は2段目
    expect(xml).toMatch(/<step>C<\/step><octave>3<\/octave>.*?<staff>2<\/staff>/)
  })

  it('2トラックは音の高い方を上段にし、同時の音は和音にする', () => {
    const xml = midiToMusicXml(buildMidi([
      [{ midi: 43, beat: 0, beats: 4 }],
      [{ midi: 55, beat: 0, beats: 2 }, { midi: 59, beat: 0, beats: 2 }, { midi: 62, beat: 2, beats: 2 }],
    ]), 'x')
    expect(measureDurations(xml)).toEqual([[16, 16]])
    expect(xml).toContain('<chord/><pitch><step>B</step><octave>3</octave>')
    expect(xml).toMatch(/<step>G<\/step><octave>2<\/octave>.*?<staff>2<\/staff>/)
  })

  it('フラット系の調ではフラットで表記し、拍子を引き継ぐ', () => {
    const midi = new Midi(buildMidi([[{ midi: 70, beat: 0, beats: 3 }]], (m) => {
      m.header.timeSignatures.push({ timeSignature: [3, 4], ticks: 0 })
    }))
    // @tonejs/midi は調号の書き出しに不具合があるため、読み込み後に設定する
    midi.header.keySignatures = [{ key: 'F', scale: 'major', ticks: 0 }]
    const xml = convertMidi(midi, 'x')
    expect(xml).toContain('<fifths>-1</fifths>')
    expect(xml).toContain('<beats>3</beats><beat-type>4</beat-type>')
    expect(xml).toContain('<step>B</step><alter>-1</alter>')
    expect(measureDurations(xml)).toEqual([[12, 12]])
  })

  it('音符がない MIDI はエラーにする', () => {
    expect(() => midiToMusicXml(buildMidi([]), 'x')).toThrow()
  })
})
