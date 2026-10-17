require "test_helper"

class Api::ScoreFetchesControllerTest < ActionDispatch::IntegrationTest
  test "取得した楽譜を返す" do
    # IP アドレスを直接指定し、テスト中に名前解決が起きないようにする
    stub_request(:get, "https://93.184.216.34/song.musicxml").to_return(body: "<score-partwise/>")
    post api_score_fetches_url, params: { url: "https://93.184.216.34/song.musicxml" }, as: :json
    assert_response :success
    assert_equal({ "format" => "musicxml", "content" => "<score-partwise/>", "filename" => "song.musicxml" }, response.parsed_body)
  end

  test "取得できない場合はエラーメッセージを返す" do
    post api_score_fetches_url, params: { url: "http://127.0.0.1/" }, as: :json
    assert_response :unprocessable_content
    assert response.parsed_body["error"].present?
  end
end
