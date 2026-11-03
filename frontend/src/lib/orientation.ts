/**
 * スマホを縦向きで開いたときは、画面全体を 90° 回して横向きのレイアウトで表示する。
 * （ブラウザでは全画面にしない限り画面の向きを固定できないため、CSS で回転させる）
 * index.css の同じメディアクエリと揃えること
 */
export const ROTATED_QUERY = '(orientation: portrait) and (max-width: 600px)'

export function isRotated(): boolean {
  return window.matchMedia(ROTATED_QUERY).matches
}

/**
 * 要素 a の上端が要素 b の上端より、画面の中の向き（回転後のレイアウト）で何px下にあるか。
 * 回転中は getBoundingClientRect が端末の画面の向きで返るので換算する
 */
export function layoutTopDelta(a: Element, b: Element): number {
  const ra = a.getBoundingClientRect()
  const rb = b.getBoundingClientRect()
  // rotate(90deg) ではレイアウトの「下」が画面の左になり、上端は画面の右端になる
  return isRotated() ? rb.right - ra.right : ra.top - rb.top
}
