require "test_helper"

class ScoreFetcherTest < ActiveSupport::TestCase
  PUBLIC_RESOLVER = ->(_host) { [ "93.184.216.34" ] }
  MUSICXML = %(<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><part-list/></score-partwise>)

  def fetch(url, resolver: PUBLIC_RESOLVER)
    ScoreFetcher.call(url, resolver:)
  end

  def build_mxl(files)
    buffer = Zip::OutputStream.write_buffer do |zip|
      files.each do |name, content|
        zip.put_next_entry(name)
        zip.write(content)
      end
    end
    buffer.string
  end

  test "MusicXML をそのまま返す" do
    stub_request(:get, "https://scores.example/song.musicxml").to_return(body: MUSICXML)
    result = fetch("https://scores.example/song.musicxml")
    assert_equal "musicxml", result.format
    assert_equal MUSICXML, result.content
    assert_equal "song.musicxml", result.filename
  end

  test "MXL は container.xml が指す楽譜を展開して返す" do
    container = %(<container><rootfiles><rootfile full-path="score/main.xml"/></rootfiles></container>)
    mxl = build_mxl("META-INF/container.xml" => container, "score/other.xml" => "<x/>", "score/main.xml" => MUSICXML)
    stub_request(:get, "https://scores.example/song.mxl").to_return(body: mxl)
    result = fetch("https://scores.example/song.mxl")
    assert_equal "musicxml", result.format
    assert_equal MUSICXML, result.content
  end

  test "MIDI は Base64 で返す" do
    midi = "MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xE0".b
    stub_request(:get, "https://scores.example/song.mid").to_return(body: midi)
    result = fetch("https://scores.example/song.mid")
    assert_equal "midi", result.format
    assert_equal midi, Base64.strict_decode64(result.content)
  end

  test "リダイレクトをたどる" do
    stub_request(:get, "https://scores.example/a").to_return(status: 302, headers: { "Location" => "/b.musicxml" })
    stub_request(:get, "https://scores.example/b.musicxml").to_return(body: MUSICXML)
    assert_equal "b.musicxml", fetch("https://scores.example/a").filename
  end

  test "PDF は未対応のエラーにする" do
    stub_request(:get, "https://scores.example/song.pdf").to_return(body: "%PDF-1.7")
    error = assert_raises(ScoreFetcher::Error) { fetch("https://scores.example/song.pdf") }
    assert_match "PDF", error.message
  end

  test "楽譜でないファイルはエラーにする" do
    stub_request(:get, "https://scores.example/index.html").to_return(body: "<html></html>")
    assert_raises(ScoreFetcher::Error) { fetch("https://scores.example/index.html") }
  end

  test "プライベートアドレスへの取得を拒否する" do
    [ "127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1" ].each do |ip|
      error = assert_raises(ScoreFetcher::Error) { fetch("http://internal.example/", resolver: ->(_) { [ ip ] }) }
      assert_match "このアドレス", error.message, ip
    end
  end

  test "リダイレクト先のプライベートアドレスも拒否する" do
    resolver = ->(host) { host == "scores.example" ? [ "93.184.216.34" ] : [ "127.0.0.1" ] }
    stub_request(:get, "https://scores.example/a").to_return(status: 302, headers: { "Location" => "http://localhost/secret" })
    assert_raises(ScoreFetcher::Error) { fetch("https://scores.example/a", resolver:) }
  end

  test "http/https 以外は拒否する" do
    assert_raises(ScoreFetcher::Error) { fetch("file:///etc/passwd") }
    assert_raises(ScoreFetcher::Error) { fetch("not a url") }
  end

  test "大きすぎるファイルは拒否する" do
    stub_request(:get, "https://scores.example/big.musicxml")
      .to_return(body: "<score-partwise>" + "a" * (ScoreFetcher::MAX_BYTES + 1))
    error = assert_raises(ScoreFetcher::Error) { fetch("https://scores.example/big.musicxml") }
    assert_match "大きすぎます", error.message
  end

  test "HTTP エラーはエラーにする" do
    stub_request(:get, "https://scores.example/missing").to_return(status: 404)
    error = assert_raises(ScoreFetcher::Error) { fetch("https://scores.example/missing") }
    assert_match "404", error.message
  end
end
