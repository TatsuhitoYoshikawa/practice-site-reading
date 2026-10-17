require "test_helper"

class Api::ScoreFetchesControllerTest < ActionDispatch::IntegrationTest
  setup { ScoreFetcher.resolver = ->(_host) { [ "93.184.216.34" ] } }
  teardown { ScoreFetcher.resolver = nil }

  test "取得した楽譜を返す" do
    url = "https://raw.githubusercontent.com/user/repo/main/song.musicxml"
    stub_request(:get, url).to_return(body: "<score-partwise/>")
    post api_score_fetches_url, params: { url: }, as: :json
    assert_response :success
    assert_equal({ "format" => "musicxml", "content" => "<score-partwise/>", "filename" => "song.musicxml" }, response.parsed_body)
  end

  test "許可していないサイトはエラーメッセージを返す" do
    post api_score_fetches_url, params: { url: "https://example.com/song.musicxml" }, as: :json
    assert_response :unprocessable_content
    assert_match "このサイトからは取り込めません", response.parsed_body["error"]
  end
end
