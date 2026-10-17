# practice-site-reading

ピアノ初心者向けの譜読み練習Webアプリ。仕様は [docs/SPEC.md](docs/SPEC.md)、セキュリティ方針は [docs/SECURITY.md](docs/SECURITY.md)、デプロイ手順は [docs/DEPLOY.md](docs/DEPLOY.md) を参照。

- `backend/` Rails（APIモード）
- `frontend/` React + TypeScript（Vite）

## 開発

```sh
# backend
cd backend && bundle install && bin/rails s

# frontend
cd frontend && npm install && npm run dev
```

## テスト

```sh
cd backend && bin/rails test
cd frontend && npm test
```

## 環境変数

| 変数 | 設定先 | 内容 | 既定値 |
|---|---|---|---|
| `VITE_API_BASE_URL` | frontend（ビルド時） | Rails API の URL | `http://localhost:3000` |
| `FRONTEND_ORIGIN` | backend | CORS で許可するフロントエンドのオリジン（カンマ区切り） | `http://localhost:5173` |
