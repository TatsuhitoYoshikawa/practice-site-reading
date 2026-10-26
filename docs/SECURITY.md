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
- URL 取り込み（`ScoreFetcher`）は許可リストの楽譜サイト（`backend/config/score_sources.json`）からのみ取得する。
  任意のサイトへの中継・攻撃の踏み台には使えない。認証情報は一切付けず、プライベート IP への取得も拒否する
- SSRF 対策（サーバーから外部へリクエストを送るのは `ScoreFetcher` の1か所だけ）
  - 許可リスト：https・443番ポートのみ。ホストは完全一致、パスは正規表現で限定。ユーザー情報付き URL と、
    `.` / `..` 区間（`%2e` などの書き方も含む）・バックスラッシュを含むパスは拒否
  - 名前解決した全アドレスを検査し、1つでもプライベート・ループバック・リンクローカル（クラウドのメタデータ含む）・
    IPv4 埋め込み IPv6 などの範囲なら拒否。検査済みのアドレスへ直接接続し、環境変数のプロキシも使わない
  - リダイレクトは3回まで、行き先ごとに許可リストとアドレスを検査し直す
  - 応答は10MB・接続10秒・全体20秒まで。楽譜形式（MusicXML / MXL / MIDI）以外は返さない
  - MXL は展開しながら10MBで打ち切る（申告サイズを偽った圧縮ファイル対策）
  - 1分20回のレート制限
- 許可リストにサイトを追加するときは、ホストとパスをできるだけ狭く指定し、`frontend/src/lib/scoreSources.ts` も更新する
- 本番の `secret_key_base` は Render の環境変数 `SECRET_KEY_BASE` で渡す
