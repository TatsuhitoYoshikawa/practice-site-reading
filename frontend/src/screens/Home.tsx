import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loading } from '../components/Loading'
import { fetchScoreFromUrl } from '../lib/api'
import { db } from '../lib/db'
import { SCORE_SOURCES } from '../lib/scoreSources'
import type { LibraryEntry, StoredScore } from '../lib/types'

interface Props {
  onOpen: (score: StoredScore) => void
}

const LIBRARY_BASE = `${import.meta.env.BASE_URL}library/`
const LEVELS = [
  { name: '初級', className: 'easy' },
  { name: '中級', className: 'mid' },
  { name: '上級', className: 'hard' },
]
/** 開いている難易度をブラウザに覚えておくキー（練習から戻ったときに同じ状態で表示する） */
const OPEN_LEVELS_KEY = 'openLevels'

function loadOpenLevels(): string[] {
  try {
    return JSON.parse(localStorage.getItem(OPEN_LEVELS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function Home({ onOpen }: Props) {
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null)
  const [busy, setBusy] = useState<{ message: string; detail?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [openLevels, setOpenLevels] = useState<string[]>(loadOpenLevels)
  const toggleLevel = (name: string, open: boolean) => {
    const next = open ? [...new Set([...openLevels, name])] : openLevels.filter((n) => n !== name)
    setOpenLevels(next)
    try {
      localStorage.setItem(OPEN_LEVELS_KEY, JSON.stringify(next))
    } catch {
      // 保存できない環境（プライベートモードなど）では覚えない
    }
  }
  const scores = useLiveQuery(() => db.scores.orderBy('createdAt').reverse().toArray(), [])

  useEffect(() => {
    fetch(`${LIBRARY_BASE}index.json`)
      .then((res) => res.json())
      .then(setLibrary)
      .catch(() => {
        setLibrary([])
        setError('ライブラリを読み込めませんでした')
      })
  }, [])

  const importScore = async (musicXml: string, fields: Pick<StoredScore, 'source' | 'libraryId'>, title: string) => {
    const { getStaves, getTitle, guessStaffHands, loadSheet } = await import('../lib/score')
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

  const run = async (task: () => Promise<void>, message: string, detail?: string) => {
    setBusy({ message, detail })
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
  }, `「${entry.title}」を読み込み中…`)

  const openFile = (file: File) => run(async () => {
    const title = stripExtension(file.name)
    const musicXml = isMidiName(file.name)
      ? (await import('../lib/midi')).midiToMusicXml(await file.arrayBuffer(), title)
      : await file.text()
    onOpen(await importScore(musicXml, { source: 'upload' }, title))
  }, `「${file.name}」を取り込み中…`)

  const openUrl = () => run(async () => {
    const fetched = await fetchScoreFromUrl(url)
    const title = stripExtension(decodeURIComponent(fetched.filename)) || 'URLから取り込んだ楽譜'
    const musicXml = fetched.format === 'midi'
      ? (await import('../lib/midi')).midiToMusicXml(Uint8Array.from(atob(fetched.content), (c) => c.charCodeAt(0)), title)
      : fetched.content
    const score = await importScore(musicXml, { source: 'url' }, title)
    setUrl('')
    onOpen(score)
  }, 'URL から取り込み中…', 'サーバーが休止中の場合、起動に1分ほどかかります')

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
      {busy && <Loading overlay message={busy.message} detail={busy.detail} />}
      <div className="columns">
        <section>
          <h2>ライブラリ</h2>
          {library === null && <Loading message="曲の一覧を読み込み中…" />}
          {library && LEVELS.map((level) => {
            const entries = library.filter((entry) => entry.level === level.name)
            if (entries.length === 0) return null
            return (
              <details
                key={level.name}
                className="level-group"
                open={openLevels.includes(level.name)}
                onToggle={(e) => {
                  const open = e.currentTarget.open
                  if (open !== openLevels.includes(level.name)) toggleLevel(level.name, open)
                }}
              >
                <summary>
                  <span className={`level level-${level.className}`}>{level.name}</span>
                  <small>{entries.length}曲</small>
                </summary>
                <ul className="score-list">
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <button disabled={busy !== null} onClick={() => openLibrary(entry)}>
                        <span>{entry.title}</span>
                        <small>{entry.composer}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
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
