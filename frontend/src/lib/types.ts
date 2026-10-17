export type Hand = 'right' | 'left' | 'none'
export type PracticeHand = Exclude<Hand, 'none'>
export type Mode = 'wait' | 'tempo'

export type ScoreSource = 'library' | 'upload' | 'url'

export interface StoredScore {
  id?: number
  title: string
  source: ScoreSource
  libraryId?: string
  musicXml: string
  /** 楽譜内の譜表（上から順）ごとの手の割り当て */
  staffHands: Hand[]
  createdAt: number
}

export interface PracticeLog {
  id?: number
  scoreId: number
  hand: PracticeHand
  mode: Mode
  tempoRate: number
  accuracy: number
  playedAt: number
}

export interface StaffInfo {
  index: number
  partName: string
  /** パート内での段番号（0 始まり） */
  staffInPart: number
  clef: 'G' | 'F' | 'C' | 'other'
}

export interface StepNote {
  midi: number
  hand: Hand
  /** 音の長さ（全音符 = 1） */
  length: number
}

/** カーソル1つ分の位置。同時に鳴り始める音の集まり */
export interface Step {
  /** 曲頭からの時間（全音符 = 1、繰り返し展開後） */
  time: number
  notes: StepNote[]
}

export interface LibraryEntry {
  id: string
  title: string
  composer: string
  license: string
  file: string
}
