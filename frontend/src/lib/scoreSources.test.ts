import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCORE_SOURCES, type ScoreSourceInfo } from './scoreSources'

describe('SCORE_SOURCES', () => {
  it('バックエンドの許可リストと一致している', () => {
    const backend = JSON.parse(
      readFileSync(new URL('../../../backend/config/score_sources.json', import.meta.url), 'utf-8'),
    ) as ScoreSourceInfo[]
    const pick = ({ id, name, homepage, formats, license }: ScoreSourceInfo) =>
      ({ id, name, homepage, formats, license })
    expect(SCORE_SOURCES.map(pick)).toEqual(backend.map(pick))
  })
})
