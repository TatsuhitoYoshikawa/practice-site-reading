# デプロイ手順（Render）

GitHub と連携せず、公開リポジトリの URL からデプロイする手順。
（連携する場合はリポジトリ直下の `render.yaml` を Blueprint として使える）

## 1. Rails API（Web Service・無料プラン）

Render のダッシュボード → New → Web Service → **Public Git Repository** に
`https://github.com/<アカウント>/practice-site-reading` を入力する。

| 項目 | 値 |
|---|---|
| Name | `practice-site-reading-api` |
| Branch | デプロイするブランチ |
| Root Directory | `backend` |
| Runtime | Ruby |
| Build Command | `bundle install` |
| Start Command | `bin/rails db:prepare && bundle exec puma -C config/puma.rb` |
| Instance Type | Free |
| Health Check Path | `/up` |

環境変数：

| キー | 値 |
|---|---|
| `RAILS_ENV` | `production` |
| `BUNDLE_WITHOUT` | `development:test` |
| `SECRET_KEY_BASE` | `openssl rand -hex 64` などで作ったランダムな値 |
| `FRONTEND_ORIGIN` | 2. で作るフロントエンドの URL（例: `https://practice-site-reading.onrender.com`） |

## 2. フロントエンド（Static Site・無料）

New → Static Site → **Public Git Repository** に同じ URL を入力する。

| 項目 | 値 |
|---|---|
| Name | `practice-site-reading` |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

環境変数：

| キー | 値 |
|---|---|
| `NODE_VERSION` | `22` |
| `VITE_API_BASE_URL` | 1. の URL（例: `https://practice-site-reading-api.onrender.com`） |

## 3. 確認
1. `https://<API の URL>/up` が緑色のページを返す
2. フロントエンドを開き、ライブラリの曲で練習できる
3. URL 取り込みで楽譜ファイルの URL を入れて取り込める

## 注意
- 公開リポジトリの URL からデプロイした場合、push しても自動では再デプロイされない。
  ダッシュボードの「Manual Deploy」で反映する
- `VITE_API_BASE_URL` はビルド時に埋め込まれるため、変更したらフロントエンドを再デプロイする
- 無料の Web Service は15分アクセスがないとスリープし、次の URL 取り込みは起動待ちで最大1分ほどかかる。
  練習機能はフロントエンドだけで動くので影響しない
