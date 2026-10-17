import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { getStaves, getTitle, guessStaffHands, loadSheet } from '../lib/score'
import type { LibraryEntry, StoredScore } from '../lib/types'

interface Props {
  onOpen: (score: StoredScore) => void
}

const LIBRARY_BASE = `${import.meta.env.BASE_URL}library/`

export function Home({ onOpen }: Props) {
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scores = useLiveQuery(() => db.scores.orderBy('createdAt').reverse().toArray(), [])

  useEffect(() => {
    fetch(`${LIBRARY_BASE}index.json`)
      .then((res) => res.json())
      .then(setLibrary)
      .catch(() => setError('ライブラリを読み込めませんでした'))
  }, [])

  const importScore = async (musicXml: string, fields: Pick<StoredScore, 'source' | 'libraryId'>, title?: string) => {
    const sheet = await loadSheet(musicXml)
    const score: StoredScore = {
      title: title ?? getTitle(sheet),
      musicXml,
      staffHands: guessStaffHands(getStaves(sheet)),
      createdAt: Date.now(),
      ...fields,
    }
    score.id = await db.scores.add(score)
    return score
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openLibrary = (entry: LibraryEntry) => run(async () => {
    const existing = await db.scores.where('libraryId').equals(entry.id).first()
    if (existing) {
      onOpen(existing)
      return
    }
    const res = await fetch(`${LIBRARY_BASE}${entry.file}`)
    if (!res.ok) throw new Error('楽譜を取得できませんでした')
    onOpen(await importScore(await res.text(), { source: 'library', libraryId: entry.id }, entry.title))
  })

  const openFile = (file: File) => run(async () => {
    const text = await file.text()
    onOpen(await importScore(text, { source: 'upload' }))
  })

  const remove = (score: StoredScore) => {
    if (score.id !== undefined && confirm(`「${score.title}」を削除しますか？`)) {
      db.practiceLogs.where('scoreId').equals(score.id).delete()
      db.scores.delete(score.id)
    }
  }

  const myScores = scores?.filter((s) => s.source !== 'library') ?? []

  return (
    <div className="home">
      <h1>譜読みれんしゅう</h1>
      {error && <p className="error">{error}</p>}
      <div className="columns">
        <section>
          <h2>ライブラリ</h2>
          <ul className="score-list">
            {library.map((entry) => (
              <li key={entry.id}>
                <button disabled={busy} onClick={() => openLibrary(entry)}>
                  <span>{entry.title}</span>
                  <small>{entry.composer}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>じぶんの楽譜</h2>
          <label className="file-button">
            MusicXML を取り込む
            <input
              type="file"
              accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml,text/xml"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) openFile(file)
              }}
            />
          </label>
          <ul className="score-list">
            {myScores.map((score) => (
              <li key={score.id}>
                <button disabled={busy} onClick={() => onOpen(score)}>
                  <span>{score.title}</span>
                </button>
                <button className="delete" onClick={() => remove(score)} aria-label="削除">×</button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
