import Dexie, { type EntityTable } from 'dexie'
import type { PracticeLog, StoredScore } from './types'

export const db = new Dexie('practice-site-reading') as Dexie & {
  scores: EntityTable<StoredScore, 'id'>
  practiceLogs: EntityTable<PracticeLog, 'id'>
}

db.version(1).stores({
  scores: '++id, source, libraryId, createdAt',
  practiceLogs: '++id, scoreId, playedAt',
})
