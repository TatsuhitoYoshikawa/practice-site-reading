import { useState } from 'react'
import { Home } from './screens/Home'
import { Practice, type PracticeSettings } from './screens/Practice'
import { Setup } from './screens/Setup'
import type { StoredScore } from './lib/types'

type Screen =
  | { name: 'home' }
  | { name: 'setup'; score: StoredScore }
  | { name: 'practice'; score: StoredScore; settings: PracticeSettings }

const DEFAULT_SETTINGS: PracticeSettings = { hand: 'right', mode: 'wait', tempoRate: 0.75, accompaniment: true }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  return (
    <>
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
    </>
  )
}

export default App
