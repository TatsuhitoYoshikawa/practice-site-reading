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
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/song.musicxml").to_return(body: MUSICXML)
    result = fetch("https://raw.githubusercontent.com/user/repo/main/song.musicxml")
    assert_equal "musicxml", result.format
    assert_equal MUSICXML, result.content
    assert_equal "song.musicxml", result.filename
  end

  test "MXL は container.xml が指す楽譜を展開して返す" do
    container = %(<container><rootfiles><rootfile full-path="score/main.xml"/></rootfiles></container>)
    mxl = build_mxl("META-INF/container.xml" => container, "score/other.xml" => "<x/>", "score/main.xml" => MUSICXML)
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/song.mxl").to_return(body: mxl)
    result = fetch("https://raw.githubusercontent.com/user/repo/main/song.mxl")
    assert_equal "musicxml", result.format
    assert_equal MUSICXML, result.content
  end

  test "MIDI は Base64 で返す" do
    midi = "MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xE0".b
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/song.mid").to_return(body: midi)
    result = fetch("https://raw.githubusercontent.com/user/repo/main/song.mid")
    assert_equal "midi", result.format
    assert_equal midi, Base64.strict_decode64(result.content)
  end

  test "リダイレクトをたどる" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/a").to_return(status: 302, headers: { "Location" => "/user/repo/main/b.musicxml" })
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/b.musicxml").to_return(body: MUSICXML)
    assert_equal "b.musicxml", fetch("https://raw.githubusercontent.com/user/repo/main/a").filename
  end

  test "PDF は未対応のエラーにする" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/song.pdf").to_return(body: "%PDF-1.7")
    error = assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/song.pdf") }
    assert_match "PDF", error.message
  end

  test "楽譜でないファイルはエラーにする" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/index.html").to_return(body: "<html></html>")
    assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/index.html") }
  end

  test "プライベートアドレスへの取得を拒否する" do
    [ "127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1" ].each do |ip|
      error = assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/a.xml", resolver: ->(_) { [ ip ] }) }
      assert_match "このアドレス", error.message, ip
    end
  end

  test "リダイレクト先のプライベートアドレスも拒否する" do
    resolver = ->(host) { host == "raw.githubusercontent.com" ? [ "93.184.216.34" ] : [ "127.0.0.1" ] }
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/a").to_return(status: 302, headers: { "Location" => "https://upload.wikimedia.org/secret.mid" })
    assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/a", resolver:) }
  end

  test "http/https 以外は拒否する" do
    assert_raises(ScoreFetcher::Error) { fetch("file:///etc/passwd") }
    assert_raises(ScoreFetcher::Error) { fetch("not a url") }
  end

  test "大きすぎるファイルは拒否する" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/big.musicxml")
      .to_return(body: "<score-partwise>" + "a" * (ScoreFetcher::MAX_BYTES + 1))
    error = assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/big.musicxml") }
    assert_match "大きすぎます", error.message
  end

  test "HTTP エラーはエラーにする" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/missing").to_return(status: 404)
    error = assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/missing") }
    assert_match "404", error.message
  end

  test "許可していないサイトからは取得しない" do
    [
      "https://example.com/song.musicxml",
      "https://raw.githubusercontent.com.evil.example/song.musicxml",
      "https://raw.githubusercontent.com@evil.example/song.musicxml",
      "https://user:pass@raw.githubusercontent.com/song.musicxml",
      "http://raw.githubusercontent.com/user/repo/main/song.musicxml",
      "https://www.ibiblio.org/other/song.mid",
      "https://kern.humdrum.org/other",
      "https://github.com/user/repo/blob/main/song.musicxml"
    ].each do |url|
      error = assert_raises(ScoreFetcher::Error, url) { fetch(url) }
      assert_match "このサイトからは取り込めません", error.message, url
    end
    assert_not_requested :any, /.*/
  end

  test "許可したサイトのパスなら取得する" do
    {
      "https://www.mutopiaproject.org/ftp/Composer/piece/piece.mid" => "MThd",
      "https://WWW.IBIBLIO.ORG/mutopia/ftp/piece.mid" => "MThd",
      "https://kern.humdrum.org/cgi-bin/ksdata?l=cc/bach&file=a.krn&f=xml" => MUSICXML,
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Song.mid" => "MThd"
    }.each do |url, body|
      stub_request(:get, url).to_return(body:)
      assert fetch(url), url
    end
  end

  test "GitHub の raw リンクは raw.githubusercontent.com へのリダイレクトをたどる" do
    stub_request(:get, "https://github.com/user/repo/raw/main/song.musicxml")
      .to_return(status: 302, headers: { "Location" => "https://raw.githubusercontent.com/user/repo/main/song.musicxml" })
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/song.musicxml").to_return(body: MUSICXML)
    assert_equal "song.musicxml", fetch("https://github.com/user/repo/raw/main/song.musicxml").filename
  end

  test "許可したサイトから許可していないサイトへのリダイレクトは拒否する" do
    stub_request(:get, "https://raw.githubusercontent.com/user/repo/main/a")
      .to_return(status: 302, headers: { "Location" => "https://example.com/song.musicxml" })
    error = assert_raises(ScoreFetcher::Error) { fetch("https://raw.githubusercontent.com/user/repo/main/a") }
    assert_match "このサイトからは取り込めません", error.message
  end
end
