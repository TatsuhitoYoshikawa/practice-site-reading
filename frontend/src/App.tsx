import { lazy, Suspense, useEffect, useState } from 'react'
import { Home } from './screens/Home'
import type { PracticeSettings } from './screens/Practice'
import type { StoredScore } from './lib/types'

// 楽譜表示・音源のライブラリは大きいので、ホーム画面の表示後に読み込む
const loadSetup = () => import('./screens/Setup')
const loadPractice = () => import('./screens/Practice')
const Setup = lazy(() => loadSetup().then((m) => ({ default: m.Setup })))
const Practice = lazy(() => loadPractice().then((m) => ({ default: m.Practice })))

type Screen =
  | { name: 'home' }
  | { name: 'setup'; score: StoredScore }
  | { name: 'practice'; score: StoredScore; settings: PracticeSettings }

const DEFAULT_SETTINGS: PracticeSettings = { hand: 'right', mode: 'wait', tempoRate: 0.75, accompaniment: true }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  // ホーム画面を表示したら、曲を選ぶ前に練習画面のプログラムを先読みしておく
  useEffect(() => {
    const id = setTimeout(() => {
      loadSetup()
      loadPractice()
    }, 500)
    return () => clearTimeout(id)
  }, [])

  return (
    <Suspense fallback={<p className="loading">読み込み中…</p>}>
      {screen.name === 'home' && <Home onOpen={(score) => setScreen({ name: 'setup', score })} />}
      {screen.name === 'setup' && (
        <Setup
          score={screen.score}
          initialSettings={settings}
          onBack={() => setScreen({ name: 'home' })}
          onStart={(score, s) => {
            setSettings(s)
            setScreen({ name: 'practice', score, settings: s })
          }}
        />
      )}
      {screen.name === 'practice' && (
        <Practice
          score={screen.score}
          settings={screen.settings}
          onExit={() => setScreen({ name: 'setup', score: screen.score })}
        />
      )}
      <div className="rotate-hint">スマホを横向きにしてください</div>
    </Suspense>
  )
}

export default App
