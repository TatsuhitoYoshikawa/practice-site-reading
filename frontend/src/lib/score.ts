import { ClefEnum, ClefInstruction, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { MusicSheet, Note } from 'opensheetmusicdisplay'
import type { Hand, StaffInfo, Step } from './types'

/** OSMD の Note.halfTone を MIDI ノート番号に変換するためのオフセット（C4 = 60） */
const HALFTONE_TO_MIDI = 12

const DEFAULT_BPM = 100

export async function loadSheet(musicXml: string): Promise<MusicSheet> {
  const container = document.createElement('div')
  const osmd = new OpenSheetMusicDisplay(container, { autoResize: false, backend: 'svg' })
  await osmd.load(musicXml)
  return osmd.Sheet
}

export function getTitle(sheet: MusicSheet): string {
  return sheet.TitleString || sheet.Title?.text || '無題'
}

export function getStaves(sheet: MusicSheet): StaffInfo[] {
  const firstEntries = sheet.SourceMeasures[0]?.FirstInstructionsStaffEntries ?? []
  return sheet.Staves.map((staff, index) => {
    const instrument = staff.ParentInstrument
    const clefInstruction = firstEntries[index]?.Instructions.find(
      (i): i is ClefInstruction => i instanceof ClefInstruction,
    )
    const clefType = clefInstruction?.ClefType
    return {
      index,
      partName: instrument.Name || `パート${instrument.Id}`,
      staffInPart: instrument.Staves.indexOf(staff),
      clef:
        clefType === ClefEnum.G ? 'G' : clefType === ClefEnum.F ? 'F' : clefType === ClefEnum.C ? 'C' : 'other',
    }
  })
}

/**
 * 譜表ごとの手の初期値を推定する。
 * 2段以上のパートは上段=右手・下段=左手、1段のパートは音部記号で判断する。
 */
export function guessStaffHands(staves: StaffInfo[]): Hand[] {
  const stavesPerPart = new Map<string, number>()
  for (const s of staves) stavesPerPart.set(s.partName, (stavesPerPart.get(s.partName) ?? 0) + 1)
  return staves.map((s) => {
    if ((stavesPerPart.get(s.partName) ?? 1) >= 2) return s.staffInPart === 0 ? 'right' : 'left'
    return s.clef === 'F' ? 'left' : 'right'
  })
}

export function getBpm(sheet: MusicSheet): number {
  const bpm = sheet.DefaultStartTempoInBpm
  return bpm > 0 ? bpm : DEFAULT_BPM
}

/** 全音符の長さ（秒） */
export function wholeNoteSeconds(bpm: number): number {
  return (4 * 60) / bpm
}

function isTiedContinuation(note: Note): boolean {
  const tie = note.NoteTie
  return !!tie && tie.StartNote !== note
}

/**
 * 描画済みの OSMD からカーソルの各位置を列挙する。
 * カーソルの next() と同じ進め方をするので、Step の添字 = カーソルを進めた回数になる。
 */
export function buildSteps(osmd: OpenSheetMusicDisplay, staffHands: Hand[]): Step[] {
  const staves = osmd.Sheet.Staves
  osmd.cursor.reset()
  const iterator = osmd.cursor.Iterator.clone()
  const steps: Step[] = []
  while (!iterator.EndReached) {
    const step: Step = { time: iterator.CurrentEnrolledTimestamp.RealValue, notes: [] }
    for (const voiceEntry of iterator.CurrentVoiceEntries) {
      for (const note of voiceEntry.Notes) {
        if (note.isRest() || note.IsGraceNote || isTiedContinuation(note)) continue
        const staffIndex = staves.indexOf(note.ParentStaffEntry.ParentStaff)
        step.notes.push({
          midi: note.halfTone + HALFTONE_TO_MIDI,
          hand: staffHands[staffIndex] ?? 'none',
          length: (note.NoteTie ? note.NoteTie.Duration : note.Length).RealValue,
        })
      }
    }
    steps.push(step)
    iterator.moveToNextVisibleVoiceEntry(false)
  }
  return steps
}

/** 譜表ごとの音域（MIDI ノート番号）。音符がない譜表は null */
export function staffRanges(sheet: MusicSheet): ([number, number] | null)[] {
  const ranges: ([number, number] | null)[] = sheet.Staves.map(() => null)
  for (const measure of sheet.SourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      container.StaffEntries.forEach((staffEntry, staffIndex) => {
        for (const voiceEntry of staffEntry?.VoiceEntries ?? []) {
          for (const note of voiceEntry.Notes) {
            if (note.isRest()) continue
            const midi = note.halfTone + HALFTONE_TO_MIDI
            const r = ranges[staffIndex]
            ranges[staffIndex] = r ? [Math.min(r[0], midi), Math.max(r[1], midi)] : [midi, midi]
          }
        }
      })
    }
  }
  return ranges
}

export function notesForHand(step: Step, hand: Hand): number[] {
  return [...new Set(step.notes.filter((n) => n.hand === hand).map((n) => n.midi))]
}

export function noteRange(steps: Step[], hand: Hand): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const step of steps) {
    for (const n of step.notes) {
      if (n.hand !== hand) continue
      min = Math.min(min, n.midi)
      max = Math.max(max, n.midi)
    }
  }
  return min === Infinity ? null : [min, max]
}
