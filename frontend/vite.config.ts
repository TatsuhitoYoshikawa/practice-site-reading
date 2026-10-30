import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { ABOUT, SITE } from './src/content/about.ts'

interface LibraryEntry {
  title: string
  composer: string
  level: string
}

const LEVELS = ['初級', '中級', '上級']

function readLibrary(): LibraryEntry[] {
  return JSON.parse(readFileSync(new URL('./public/library/index.json', import.meta.url), 'utf-8'))
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * 検索エンジン・AI 向けに、index.html へ説明文・メタ情報・構造化データを埋め込む。
 * JavaScript を実行しないクローラーにも内容が伝わるよう、ホーム画面の「このアプリについて」と
 * 同じ文章（src/content/about.ts）を HTML にも書き出す。React の描画で置き換わる。
 */
function seoContent(): Plugin {
  return {
    name: 'seo-content',
    transformIndexHtml(html) {
      const library = readLibrary()
      const title = escapeHtml(SITE.title)
      const description = escapeHtml(SITE.description)

      const head = [
        `<title>${title}</title>`,
        `<meta name="description" content="${description}" />`,
        `<link rel="canonical" href="${SITE.url}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${SITE.url}" />`,
        `<meta property="og:locale" content="ja_JP" />`,
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="theme-color" content="#fffdf8" />`,
      ].join('\n    ')

      const structuredData = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebApplication',
            name: SITE.name,
            url: SITE.url,
            description: SITE.description,
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Web ブラウザ（iOS / Android / Windows / macOS）',
            inLanguage: 'ja',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: 0, priceCurrency: 'JPY' },
            featureList: ABOUT.features,
          },
          {
            '@type': 'FAQPage',
            mainEntity: ABOUT.faq.map(({ q, a }) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          },
        ],
      }
      const jsonLd = JSON.stringify(structuredData).replace(/</g, '\\u003c')

      const songs = LEVELS.map((level) => {
        const items = library
          .filter((entry) => entry.level === level)
          .map((entry) => `<li>${escapeHtml(entry.title)}（${escapeHtml(entry.composer)}）</li>`)
          .join('')
        return items ? `<h3>${level}</h3><ul>${items}</ul>` : ''
      }).join('')
      const body = [
        `<main class="static-about">`,
        `<h1>${escapeHtml(SITE.name)}：ピアノ初心者の楽譜を読む練習アプリ</h1>`,
        `<p>${escapeHtml(ABOUT.intro)}</p>`,
        `<h2>特徴</h2><ul>${ABOUT.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`,
        `<h2>使い方</h2><ol>${ABOUT.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`,
        `<h2>収録曲</h2>${songs}`,
        `<h2>よくある質問</h2><dl>${ABOUT.faq.map(({ q, a }) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`).join('')}</dl>`,
        `</main>`,
      ].join('')

      return html
        .replace('<!--seo-head-->', `${head}\n    <script type="application/ld+json">${jsonLd}</script>`)
        .replace('<!--seo-body-->', body)
    },
    // AI 向けのサイト概要（llms.txt）
    generateBundle() {
      const library = readLibrary()
      const source = [
        `# ${SITE.name}`,
        '',
        `> ${SITE.description}`,
        '',
        ABOUT.intro,
        '',
        '## 特徴',
        ...ABOUT.features.map((f) => `- ${f}`),
        '',
        '## 使い方',
        ...ABOUT.steps.map((step, i) => `${i + 1}. ${step}`),
        '',
        '## 収録曲',
        ...LEVELS.flatMap((level) => {
          const entries = library.filter((entry) => entry.level === level)
          return entries.length ? [`### ${level}`, ...entries.map((e) => `- ${e.title}（${e.composer}）`)] : []
        }),
        '',
        '## よくある質問',
        ...ABOUT.faq.flatMap(({ q, a }) => [`### ${q}`, a]),
        '',
        `URL: ${SITE.url}`,
        '',
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), seoContent()],
})
