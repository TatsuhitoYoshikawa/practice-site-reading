const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])
const NOTE_NAMES = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ']

/** 鍵盤に最低限表示する白鍵の数（音域が狭い曲でも周りの鍵盤が見えるように） */
const MIN_WHITE_KEYS = 10

/** スマホ横画面で白鍵の幅が窮屈にならない音域の上限（半音数） */
export const COMFORTABLE_RANGE_SEMITONES = 36

export function isBlack(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(midi % 12)
}

export function noteName(midi: number): string {
  return NOTE_NAMES[midi % 12]
}

function countWhite(low: number, high: number): number {
  let count = 0
  for (let m = low; m <= high; m++) if (!isBlack(m)) count++
  return count
}

/** 曲の音域から、両端が白鍵で最低限の幅を持つ鍵盤の表示範囲を求める */
export function keyboardRange(range: [number, number] | null): [number, number] {
  let [low, high] = range ?? [60, 72]
  if (isBlack(low)) low--
  if (isBlack(high)) high++
  let extendLow = true
  while (countWhite(low, high) < MIN_WHITE_KEYS) {
    if (extendLow) low -= isBlack(low - 1) ? 2 : 1
    else high += isBlack(high + 1) ? 2 : 1
    extendLow = !extendLow
  }
  return [low, high]
}
