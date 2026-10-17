const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export interface FetchedScore {
  format: 'musicxml' | 'midi'
  /** musicxml は本文、midi は Base64 */
  content: string
  filename: string
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('サーバーに接続できませんでした')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `サーバーでエラーが発生しました（${res.status}）`)
  return json as T
}

/** URL の楽譜ファイルをサーバー経由で取得する */
export function fetchScoreFromUrl(url: string): Promise<FetchedScore> {
  return post<FetchedScore>('/api/score_fetches', { url })
}
