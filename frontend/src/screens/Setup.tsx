import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { COMFORTABLE_RANGE_SEMITONES } from '../lib/keyboard'
import { getStaves, loadSheet, staffRanges } from '../lib/score'
import type { Hand, PracticeHand, StaffInfo, StoredScore } from '../lib/types'
import type { PracticeSettings } from './Practice'

interface Props {
  score: StoredScore
  initialSettings: PracticeSettings
  onBack: () => void
  onStart: (score: StoredScore, settings: PracticeSettings) => void
}

const CLEF_LABEL: Record<StaffInfo['clef'], string> = { G: 'ト音記号', F: 'ヘ音記号', C: 'ハ音記号', other: 'その他' }
const HAND_LABEL: Record<Hand, string> = { right: '右手', left: '左手', none: '使わない' }

export function Setup({ score, initialSettings, onBack, onStart }: Props) {
  const [staves, setStaves] = useState<StaffInfo[]>([])
  const [ranges, setRanges] = useState<([number, number] | null)[]>([])
  const [staffHands, setStaffHands] = useState<Hand[]>(score.staffHands)
  const [settings, setSettings] = useState(initialSettings)

  useEffect(() => {
    loadSheet(score.musicXml).then((sheet) => {
      setStaves(getStaves(sheet))
      setRanges(staffRanges(sheet))
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
                正しく弾いたら進む
              </button>
              <button className={settings.mode === 'tempo' ? 'selected' : ''} onClick={() => update('mode', 'tempo')}>
                テンポどおり進む
              </button>
            </div>
          </div>
          {settings.mode === 'tempo' && (
            <label className="field">
              <span>テンポ {Math.round(settings.tempoRate * 100)}%</span>
              <input
                type="range" min={0.5} max={1} step={0.05} value={settings.tempoRate}
                onChange={(e) => update('tempoRate', Number(e.target.value))}
              />
            </label>
          )}
          <label className="field checkbox">
            <input
              type="checkbox" checked={settings.accompaniment}
              onChange={(e) => update('accompaniment', e.target.checked)}
            />
            <span>もう片方の手を伴奏として鳴らす</span>
          </label>
          {selectedRange === null && staves.length > 0 && (
            <p className="error">{HAND_LABEL[settings.hand]}に割り当てた譜表に音符がありません</p>
          )}
          {selectedRange !== null && selectedRange > COMFORTABLE_RANGE_SEMITONES && (
            <p className="warning">この曲は音域が広いため、スマホでは鍵盤が窮屈になります</p>
          )}
          <button className="primary start" disabled={selectedRange === null} onClick={start}>
            練習をはじめる
          </button>
        </section>
      </div>
    </div>
  )
}
