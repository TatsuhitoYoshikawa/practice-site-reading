# フロントエンド（別オリジン）からの API 呼び出しを許可する。
# 本番では FRONTEND_ORIGIN にフロントエンドの URL を設定する（カンマ区切りで複数可）。
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*ENV.fetch("FRONTEND_ORIGIN", "http://localhost:5173").split(","))
    resource "/api/*", headers: :any, methods: %i[get post options]
  end
end
