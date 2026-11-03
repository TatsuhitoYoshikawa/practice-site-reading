import { db } from './db'
import type { PracticeLog } from './types'

/** 曲（scoreId）ごとの最高正答率（0〜1） */
export function bestAccuracies(logs: PracticeLog[]): Map<number, number> {
  const best = new Map<number, number>()
  for (const log of logs) {
    const prev = best.get(log.scoreId)
    if (prev === undefined || log.accuracy > prev) best.set(log.scoreId, log.accuracy)
  }
  return best
}

/** 1曲の最高正答率。まだ記録がなければ null */
export async function bestAccuracy(scoreId: number): Promise<number | null> {
  const logs = await db.practiceLogs.where('scoreId').equals(scoreId).toArray()
  return bestAccuracies(logs).get(scoreId) ?? null
}

export function formatPercent(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`
}
