module Api
  class ScoreFetchesController < ApplicationController
    rate_limit to: 20, within: 1.minute

    # POST /api/score_fetches { url: "https://..." }
    def create
      result = ScoreFetcher.call(params.require(:url))
      render json: { format: result.format, content: result.content, filename: result.filename }
    rescue ScoreFetcher::Error => e
      render json: { error: e.message }, status: :unprocessable_content
    end
  end
end
