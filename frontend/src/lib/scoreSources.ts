/**
 * URL 取り込みに対応している楽譜サイト（画面表示用）。
 * 取得の可否は backend/config/score_sources.json で判定する。内容を変えたら両方を更新すること
 * （一致していることは scoreSources.test.ts で確認している）。
 */
export interface ScoreSourceInfo {
  id: string
  name: string
  homepage: string
  formats: string[]
  license: string
}

export const SCORE_SOURCES: ScoreSourceInfo[] = [
  {
    id: 'mutopia',
    name: 'Mutopia Project',
    homepage: 'https://www.mutopiaproject.org/',
    formats: ['MIDI'],
    license: 'パブリックドメイン / CC BY / CC BY-SA（曲ごとに表示）',
  },
  {
    id: 'kernscores',
    name: 'KernScores',
    homepage: 'https://kern.humdrum.org/',
    formats: ['MusicXML', 'MIDI'],
    license: 'サイトの利用条件に従う（主に研究・教育目的）',
  },
  {
    id: 'wikimedia',
    name: 'Wikimedia Commons',
    homepage: 'https://commons.wikimedia.org/',
    formats: ['MIDI'],
    license: '自由ライセンス（ファイルごとに表示）',
  },
  {
    id: 'github',
    name: 'GitHub（公開リポジトリのファイル）',
    homepage: 'https://github.com/',
    formats: ['MusicXML', 'MXL', 'MIDI'],
    license: 'リポジトリごとのライセンスに従う',
  },
]
