import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { fetchScoreFromUrl } from '../lib/api'
import { db } from '../lib/db'
import { midiToMusicXml } from '../lib/midi'
import { getStaves, getTitle, guessStaffHands, loadSheet } from '../lib/score'
import { SCORE_SOURCES } from '../lib/scoreSources'
import type { LibraryEntry, StoredScore } from '../lib/types'

interface Props {
  onOpen: (score: StoredScore) => void
}

const LIBRARY_BASE = `${import.meta.env.BASE_URL}library/`

export function Home({ onOpen }: Props) {
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const scores = useLiveQuery(() => db.scores.orderBy('createdAt').reverse().toArray(), [])

  useEffect(() => {
    fetch(`${LIBRARY_BASE}index.json`)
      .then((res) => res.json())
      .then(setLibrary)
      .catch(() => setError('ライブラリを読み込めませんでした'))
  }, [])

  const importScore = async (musicXml: string, fields: Pick<StoredScore, 'source' | 'libraryId'>, title: string) => {
    const sheet = await loadSheet(musicXml)
    const score: StoredScore = {
      title: getTitle(sheet) ?? title,
      musicXml,
      staffHands: guessStaffHands(getStaves(sheet)),
      createdAt: Date.now(),
      ...fields,
    }
    score.id = await db.scores.add(score)
    return score
  }

  const run = async (task: () => Promise<void>, message = '読み込み中…') => {
    setBusy(message)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
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
    const title = stripExtension(file.name)
    const musicXml = isMidiName(file.name)
      ? midiToMusicXml(await file.arrayBuffer(), title)
      : await file.text()
    onOpen(await importScore(musicXml, { source: 'upload' }, title))
  })

  const openUrl = () => run(async () => {
    const fetched = await fetchScoreFromUrl(url)
    const title = stripExtension(decodeURIComponent(fetched.filename)) || 'URLから取り込んだ楽譜'
    const musicXml = fetched.format === 'midi'
      ? midiToMusicXml(Uint8Array.from(atob(fetched.content), (c) => c.charCodeAt(0)), title)
      : fetched.content
    const score = await importScore(musicXml, { source: 'url' }, title)
    setUrl('')
    onOpen(score)
  }, '取り込み中…（サーバーが休止中の場合、起動に1分ほどかかります）')

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
      {busy && <p className="muted">{busy}</p>}
      <div className="columns">
        <section>
          <h2>ライブラリ</h2>
          <ul className="score-list">
            {library.map((entry) => (
              <li key={entry.id}>
                <button disabled={busy !== null} onClick={() => openLibrary(entry)}>
                  <span>{entry.title}</span>
                  <small>{entry.composer}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>じぶんの楽譜</h2>
          <form className="url-form" onSubmit={(e) => { e.preventDefault(); openUrl() }}>
            <input
              type="url"
              placeholder="楽譜ファイルの URL（対応サイトのみ）"
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" disabled={busy !== null}>URLから取り込む</button>
          </form>
          <details className="sources">
            <summary>URL から取り込めるサイト</summary>
            <ul>
              {SCORE_SOURCES.map((source) => (
                <li key={source.id}>
                  <a href={source.homepage} target="_blank" rel="noopener noreferrer">{source.name}</a>
                  <small>{source.formats.join(' / ')}・{source.license}</small>
                </li>
              ))}
            </ul>
            <p>ほかのサイトの楽譜は、ダウンロードしてから「ファイルを取り込む」で読み込んでください。</p>
          </details>
          <label className="file-button">
            ファイルを取り込む（MusicXML / MIDI）
            <input
              type="file"
              accept=".musicxml,.xml,.mid,.midi,application/vnd.recordare.musicxml+xml,text/xml,audio/midi"
              disabled={busy !== null}
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
                <button disabled={busy !== null} onClick={() => onOpen(score)}>
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

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function isMidiName(name: string): boolean {
  return /\.midi?$/i.test(name)
}
