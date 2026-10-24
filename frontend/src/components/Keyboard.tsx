import { isBlack } from '../lib/keyboard'

export type KeyFlash = 'correct' | 'wrong'

interface Props {
  range: [number, number]
  /** 正解の鍵盤として光らせる音 */
  hints: Set<number>
  /** 和音のうち押し終えた音 */
  held: Set<number>
  /** お手本再生で鳴っている音 */
  playing: Set<number>
  /** 押した直後の一時的な色 */
  flashes: Map<number, KeyFlash>
  onPress: (midi: number) => void
}

export function Keyboard({ range, hints, held, playing, flashes, onPress }: Props) {
  const [low, high] = range
  const whites: number[] = []
  const blacks: { midi: number; leftWhites: number }[] = []
  for (let m = low; m <= high; m++) {
    if (isBlack(m)) blacks.push({ midi: m, leftWhites: whites.length })
    else whites.push(m)
  }
  const whiteWidth = 100 / whites.length

  const className = (midi: number, base: string) => {
    const classes = [base]
    if (hints.has(midi)) classes.push('hint')
    if (held.has(midi)) classes.push('held')
    if (playing.has(midi)) classes.push('playing')
    const flash = flashes.get(midi)
    if (flash) classes.push(flash)
    return classes.join(' ')
  }

  const handlePointerDown = (midi: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    onPress(midi)
  }

  return (
    <div className="keyboard">
      <div className="keys">
        {whites.map((m) => (
          <div
            key={m}
            data-midi={m}
            className={className(m, 'key white')}
            style={{ width: `${whiteWidth}%` }}
            onPointerDown={handlePointerDown(m)}
          >
            {m % 12 === 0 && <span className="key-label">{m === 60 ? 'ド(中央)' : 'ド'}</span>}
          </div>
        ))}
        {blacks.map(({ midi, leftWhites }) => (
          <div
            key={midi}
            data-midi={midi}
            className={className(midi, 'key black')}
            style={{ left: `${(leftWhites - 0.3) * whiteWidth}%`, width: `${whiteWidth * 0.6}%` }}
            onPointerDown={handlePointerDown(midi)}
          />
        ))}
      </div>
    </div>
  )
}
