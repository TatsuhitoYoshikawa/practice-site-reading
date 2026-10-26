require "ipaddr"
require "net/http"

# URL で指定された楽譜ファイルを取得し、形式を判定して返す。
#
# - 取得先は許可した楽譜サイト（ScoreSource）の https URL に限る（任意のサイトへの中継・踏み台を防ぐ）
# - 加えて、接続先は公開アドレスに限る（社内ネットワーク等への中継を防ぐ）
# - 圧縮 MusicXML（.mxl）は展開して MusicXML として返す
# - MIDI はそのまま返し、MusicXML への変換はフロントエンドで行う
class ScoreFetcher
  class Error < StandardError; end

  Result = Data.define(:format, :content, :filename)

  MAX_BYTES = 10 * 1024 * 1024
  MAX_REDIRECTS = 3
  TIMEOUT_SEC = 10
  # リダイレクトを含めた取得全体の制限時間（少しずつ送り続けられてもサーバーを占有されないように）
  TOTAL_TIMEOUT_SEC = 20

  BLOCKED_NETWORKS = %w[
    0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12
    192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4
    ::/96 fc00::/7 fe80::/10 ff00::/8 100::/64 2001:db8::/32
    64:ff9b::/96 64:ff9b:1::/48 2002::/16 2001::/32
  ].map { |cidr| IPAddr.new(cidr) }
  # ::/96 は未指定・ループバック・IPv4 互換アドレス。64:ff9b::/96 などは IPv4 アドレスを埋め込める変換用の範囲

  class << self
    attr_writer :resolver

    # 名前解決の方法（テストで差し替える）
    def resolver
      @resolver || method(:resolve)
    end
  end

  def self.call(url, resolver: self.resolver, total_timeout: TOTAL_TIMEOUT_SEC)
    new(resolver, total_timeout).fetch(url)
  end

  def self.resolve(host)
    Addrinfo.getaddrinfo(host, nil, nil, :STREAM).map(&:ip_address).uniq
  rescue SocketError
    raise Error, "ホスト名を解決できませんでした"
  end

  def initialize(resolver, total_timeout)
    @resolver = resolver
    @total_timeout = total_timeout
  end

  def fetch(url)
    @deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + @total_timeout
    body, final_uri = download(parse_uri(url))
    detect(body, File.basename(final_uri.path.to_s))
  end

  private

  def parse_uri(url)
    uri = URI.parse(url.to_s.strip)
    raise Error, "http または https の URL を指定してください" unless uri.is_a?(URI::HTTP) && uri.host.present?
    uri
  rescue URI::InvalidURIError
    raise Error, "URL の形式が正しくありません"
  end

  # 本文と、リダイレクトをたどった後の URI を返す
  def download(uri, redirects = 0)
    ensure_allowed_source(uri)
    ip = safe_ip_for(uri.host)
    # 名前解決をやり直さず、確認済みのアドレスに直接接続する（環境変数のプロキシも使わない）
    http = Net::HTTP.new(uri.host, uri.port, nil)
    http.ipaddr = ip
    http.use_ssl = uri.scheme == "https"
    http.open_timeout = [ TIMEOUT_SEC, remaining_time ].min
    http.read_timeout = [ TIMEOUT_SEC, remaining_time ].min

    http.request(Net::HTTP::Get.new(uri)) do |response|
      case response
      when Net::HTTPRedirection
        raise Error, "リダイレクトが多すぎます" if redirects >= MAX_REDIRECTS
        return download(parse_uri(URI.join(uri, response["location"]).to_s), redirects + 1)
      when Net::HTTPSuccess
        return [ read_limited(response), uri ]
      else
        raise Error, "ファイルを取得できませんでした（HTTP #{response.code}）"
      end
    end
  rescue Net::OpenTimeout, Net::ReadTimeout
    raise Error, "取得がタイムアウトしました"
  rescue SystemCallError, OpenSSL::SSL::SSLError, IOError => e
    raise Error, "接続できませんでした（#{e.class.name}）"
  end

  # 制限時間の残り（秒）。過ぎていたらエラーにする
  def remaining_time
    remaining = @deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
    raise Error, "取得がタイムアウトしました" if remaining <= 0
    remaining
  end

  def ensure_allowed_source(uri)
    return if ScoreSource.allowed?(uri)
    raise Error, "このサイトからは取り込めません（対応サイト: #{ScoreSource.all.map(&:name).join('、')}）"
  end

  def safe_ip_for(host)
    ips = @resolver.call(host)
    raise Error, "ホスト名を解決できませんでした" if ips.empty?
    ips.each do |ip|
      addr = IPAddr.new(ip)
      addr = addr.native if addr.ipv4_mapped?
      raise Error, "このアドレスからは取得できません" if BLOCKED_NETWORKS.any? { |net| net.include?(addr) }
    end
    ips.first
  end

  def read_limited(response)
    raise Error, "ファイルが大きすぎます（上限10MB）" if response.content_length.to_i > MAX_BYTES
    body = +""
    response.read_body do |chunk|
      body << chunk
      raise Error, "ファイルが大きすぎます（上限10MB）" if body.bytesize > MAX_BYTES
      remaining_time
    end
    body.force_encoding(Encoding::BINARY)
  end

  def detect(body, filename)
    if body.start_with?("MThd")
      Result.new(format: "midi", content: Base64.strict_encode64(body), filename:)
    elsif body.start_with?("PK")
      Result.new(format: "musicxml", content: extract_mxl(body), filename:)
    elsif body.start_with?("%PDF")
      raise Error, "PDF の取り込みは画像認識の対応後に利用できます"
    elsif musicxml?(body)
      Result.new(format: "musicxml", content: to_utf8(body), filename:)
    else
      raise Error, "対応していない形式です（MusicXML / MXL / MIDI に対応）"
    end
  end

  def musicxml?(body)
    head = body.byteslice(0, 4096).to_s.dup.force_encoding(Encoding::UTF_8).scrub
    head.include?("<score-partwise") || head.include?("<score-timewise")
  end

  def to_utf8(body)
    text = body.dup
    # UTF-16 の MusicXML（BOM 付き）にも対応する
    if text.start_with?("\xFF\xFE".b)
      text.byteslice(2..).force_encoding(Encoding::UTF_16LE).encode(Encoding::UTF_8)
    elsif text.start_with?("\xFE\xFF".b)
      text.byteslice(2..).force_encoding(Encoding::UTF_16BE).encode(Encoding::UTF_8)
    else
      text.force_encoding(Encoding::UTF_8).delete_prefix("﻿").scrub
    end
  end

  def extract_mxl(body)
    zip = Zip::File.open_buffer(StringIO.new(body))
    entry = rootfile_entry(zip)
    raise Error, "MXL ファイルの中に楽譜が見つかりません" unless entry
    raise Error, "ファイルが大きすぎます（上限10MB）" if entry.size > MAX_BYTES
    # 申告サイズは偽れるので、展開しながら上限を超えたら打ち切る（展開すると巨大になるファイル対策）
    content = entry.get_input_stream { |stream| stream.read(MAX_BYTES + 1) }.to_s
    raise Error, "ファイルが大きすぎます（上限10MB）" if content.bytesize > MAX_BYTES
    to_utf8(content.b)
  rescue Zip::Error
    raise Error, "MXL ファイルを展開できませんでした"
  end

  def rootfile_entry(zip)
    container = zip.find_entry("META-INF/container.xml")
    path = container&.get_input_stream&.read.to_s[/<rootfile[^>]*full-path="([^"]+)"/, 1]
    return zip.find_entry(path) if path

    zip.entries.find { |e| e.file? && !e.name.start_with?("META-INF/") && e.name.match?(/\.(xml|musicxml)\z/i) }
  end
end
