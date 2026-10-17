# セキュリティ方針（GitHub アカウントの分離）

開発者の GitHub アカウントは社内リポジトリにもアクセスできる。
このリポジトリ（公開リポジトリ）を経由して社内リポジトリや社内情報に触れられないよう、以下を守る。

## 1. リポジトリに置かないもの
- トークン・鍵・パスワード（`backend/config/master.key`、`.env*` は `.gitignore` 済み）
- 社内のメールアドレス・ホスト名・リポジトリ名
- コミットの作成者メール：このリポジトリでは GitHub の noreply アドレスを使う
  ```sh
  git config user.email "<ID>+<ユーザー名>@users.noreply.github.com"
  ```
  GitHub の Settings → Emails で「Keep my email addresses private」と
  「Block command line pushes that expose my email」を有効にする

## 2. 外部サービスに渡す GitHub 権限
| 連携先 | 方針 |
|---|---|
| Claude（GitHub App） | 個人アカウントへのインストールを「Only select repositories」にし、このリポジトリだけを選ぶ。社内 Organization にはインストールしない |
| Render | 公開リポジトリなので、GitHub 連携なしで「Public Git Repository」の URL からデプロイする。連携する場合も「Only select repositories」でこのリポジトリだけにする |
| GitHub Actions | 使う場合は `permissions: contents: read` を基本にし、社内にアクセスできる個人アクセストークンを Secrets に登録しない |

## 3. 開発マシンでの依存パッケージ
- `frontend/.npmrc` で `ignore-scripts=true` にし、npm パッケージのインストールスクリプトを実行しない
- 依存は lock ファイル（`package-lock.json` / `Gemfile.lock`）で固定し、`npm ci` / `bundle install` で入れる
- 定期的に `npm audit`、`bin/bundler-audit check --update`、`bin/brakeman` を実行する

## 4. アプリ自体
- URL 取り込み（`ScoreFetcher`）は認証情報を一切付けずに取得する。プライベート IP への取得は拒否する
- 社内ネットワークで backend を起動する場合、社内 IP 制限のみで守られた公開アドレスのサービスには届きうる。
  開発サーバーは `localhost` でのみ待ち受け（Rails の既定）、外部に公開しない
- 本番の `secret_key_base` は Render の環境変数 `SECRET_KEY_BASE` で渡す
