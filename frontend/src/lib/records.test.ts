import { describe, expect, it } from 'vitest'
import { bestAccuracies } from './records'
import type { PracticeLog } from './types'

const log = (scoreId: number, accuracy: number): PracticeLog => ({
  scoreId, accuracy, hand: 'right', mode: 'wait', tempoRate: 1, playedAt: 0,
})

describe('bestAccuracies', () => {
  it('曲ごとに最高の正答率を返す', () => {
    const best = bestAccuracies([log(1, 0.5), log(1, 0.9), log(1, 0.7), log(2, 0)])
    expect(best.get(1)).toBe(0.9)
    expect(best.get(2)).toBe(0)
    expect(best.has(3)).toBe(false)
  })
})
