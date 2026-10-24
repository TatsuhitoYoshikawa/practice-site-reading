import { useEffect, useState } from 'react'
import { Loading } from '../components/Loading'
import { db } from '../lib/db'
import { COMFORTABLE_RANGE_SEMITONES } from '../lib/keyboard'
import { getStaves, loadSheet, staffRanges } from '../lib/score'
import type { Hand, Mode, PracticeHand, StaffInfo, StoredScore } from '../lib/types'
import type { PracticeSettings } from './Practice'

interface Props {
  score: StoredScore
  initialSettings: PracticeSettings
  onBack: () => void
  onStart: (score: StoredScore, settings: PracticeSettings) => void
}

const CLEF_LABEL: Record<StaffInfo['clef'], string> = { G: 'ト音記号', F: 'ヘ音記号', C: 'ハ音記号', other: 'その他' }
const HAND_LABEL: Record<Hand, string> = { right: '右手', left: '左手', none: '使わない' }
const MODE_HELP: Record<Mode, string> = {
  wait: '正しい鍵盤を押すまで待ちます。自分のペースで進められます。',
  tempo: '楽譜のテンポで進みます。タイミングも判定します。',
  demo: '両手の音を楽譜どおりに鳴らします（判定・記録はしません）。',
}

export function Setup({ score, initialSettings, onBack, onStart }: Props) {
  const [staves, setStaves] = useState<StaffInfo[]>([])
  const [ranges, setRanges] = useState<([number, number] | null)[]>([])
  const [staffHands, setStaffHands] = useState<Hand[]>(score.staffHands)
  const [settings, setSettings] = useState(initialSettings)
  const [analyzed, setAnalyzed] = useState(false)

  useEffect(() => {
    loadSheet(score.musicXml).then((sheet) => {
      setStaves(getStaves(sheet))
      setRanges(staffRanges(sheet))
      setAnalyzed(true)
    })
  }, [score])

  const handRange = (hand: PracticeHand): number | null => {
    let min = Infinity
    let max = -Infinity
    ranges.forEach((r, i) => {
      if (!r || staffHands[i] !== hand) return
      min = Math.min(min, r[0])
      max = Math.max(max, r[1])
    })
    return min === Infinity ? null : max - min
  }

  const selectedRange = handRange(settings.hand)
  const update = <K extends keyof PracticeSettings>(key: K, value: PracticeSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  const start = async () => {
    // ボタン操作のうちに音声出力を有効にしておく（待機モードはスタートボタンがないため）
    import('../lib/audio').then((audio) => audio.startAudio()).catch(() => {})
    const updated = { ...score, staffHands }
    if (score.id !== undefined) await db.scores.update(score.id, { staffHands })
    onStart(updated, settings)
  }

  return (
    <div className="setup">
      <header className="practice-bar">
        <button onClick={onBack}>← 戻る</button>
        <span className="practice-title">{score.title}</span>
      </header>
      <div className="columns">
        <section>
          <h2>譜表の割り当て</h2>
          {!analyzed && <Loading message="楽譜を解析中…" />}
          <table className="staff-table">
            <tbody>
              {staves.map((staff) => (
                <tr key={staff.index}>
                  <td>{staff.partName} {staff.staffInPart + 1}段目</td>
                  <td>{CLEF_LABEL[staff.clef]}</td>
                  <td>
                    <select
                      value={staffHands[staff.index] ?? 'none'}
                      onChange={(e) => setStaffHands((prev) => {
                        const next = [...prev]
                        next[staff.index] = e.target.value as Hand
                        return next
                      })}
                    >
                      {(['right', 'left', 'none'] as Hand[]).map((h) => (
                        <option key={h} value={h}>{HAND_LABEL[h]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>練習の設定</h2>
          <div className="field">
            <span>練習する手</span>
            <div className="segmented">
              {(['right', 'left'] as PracticeHand[]).map((h) => (
                <button key={h} className={settings.hand === h ? 'selected' : ''} onClick={() => update('hand', h)}>
                  {HAND_LABEL[h]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>モード</span>
            <div className="segmented">
              <button className={settings.mode === 'wait' ? 'selected' : ''} onClick={() => update('mode', 'wait')}>
                待機
              </button>
              <button className={settings.mode === 'tempo' ? 'selected' : ''} onClick={() => update('mode', 'tempo')}>
                テンポ
              </button>
              <button className={settings.mode === 'demo' ? 'selected' : ''} onClick={() => update('mode', 'demo')}>
                お手本
              </button>
            </div>
          </div>
          <p className="muted mode-help">{MODE_HELP[settings.mode]}</p>
          {settings.mode !== 'wait' && (
            <label className="field">
              <span>テンポ {Math.round(settings.tempoRate * 100)}%</span>
              <input
                type="range" min={0.5} max={1} step={0.05} value={settings.tempoRate}
                onChange={(e) => update('tempoRate', Number(e.target.value))}
              />
            </label>
          )}
          {settings.mode === 'demo' ? (
            <p className="muted">{HAND_LABEL[settings.hand]}の鳴っている鍵盤が光るので、弾く位置を目で追えます。</p>
          ) : (
            <label className="field checkbox">
              <input
                type="checkbox" checked={settings.accompaniment}
                onChange={(e) => update('accompaniment', e.target.checked)}
              />
              <span>もう片方の手を伴奏として鳴らす</span>
            </label>
          )}
          {selectedRange === null && staves.length > 0 && (
            <p className="error">{HAND_LABEL[settings.hand]}に割り当てた譜表に音符がありません</p>
          )}
          {selectedRange !== null && selectedRange > COMFORTABLE_RANGE_SEMITONES && (
            <p className="warning">この曲は音域が広いため、スマホでは鍵盤が窮屈になります</p>
          )}
          <button className="primary start" disabled={!analyzed || selectedRange === null} onClick={start}>
            {!analyzed ? '楽譜を解析中…' : settings.mode === 'demo' ? 'お手本を聴く' : '練習をはじめる'}
          </button>
        </section>
      </div>
    </div>
  )
}
