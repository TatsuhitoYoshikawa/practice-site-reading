import { useEffect, useState } from 'react'

/** この秒数を超えたら経過時間を表示する（止まっていないことを伝えるため） */
const SHOW_ELAPSED_AFTER_SEC = 3

interface Props {
  message: string
  /** 補足（例：時間がかかる理由） */
  detail?: string
  /** 画面（または親要素）全体を覆って操作できなくする */
  overlay?: boolean
}

export function Loading({ message, detail, overlay = false }: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const content = (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>
        {message}
        {elapsed >= SHOW_ELAPSED_AFTER_SEC && <span className="elapsed">（{elapsed}秒）</span>}
        {detail && <small>{detail}</small>}
      </span>
    </div>
  )
  return overlay ? <div className="overlay loading-overlay">{content}</div> : content
}
