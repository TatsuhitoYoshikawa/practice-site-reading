# URL 取り込みで取得を許可する楽譜サイト（config/score_sources.json で定義）
class ScoreSource
  Location = Data.define(:host, :path)

  attr_reader :id, :name, :homepage, :formats, :license, :locations

  def self.all
    @all ||= JSON.parse(Rails.root.join("config/score_sources.json").read).map { |attrs| new(attrs) }.freeze
  end

  # https（443番ポート）で、許可したホストとパスに一致する URI か
  def self.allowed?(uri)
    return false unless uri.scheme == "https" && uri.userinfo.nil? && uri.port == 443
    path = uri.path.to_s
    return false if dot_segments?(path)
    host = uri.host.to_s.downcase
    all.any? { |source| source.locations.any? { |l| l.host == host && l.path.match?(path) } }
  end

  # "." や ".." の区間を含むパス（%2e などの書き方も含む）。許可したパスの外を指せるので受け付けない
  def self.dot_segments?(path)
    decoded = URI.decode_www_form_component(path.gsub("+", "%2B"))
    decoded.include?("\\") || decoded.split("/").any? { |segment| segment == "." || segment == ".." }
  rescue ArgumentError
    true
  end

  def initialize(attrs)
    @id, @name, @homepage, @formats, @license = attrs.values_at("id", "name", "homepage", "formats", "license")
    @locations = attrs.fetch("locations").map { |l| Location.new(host: l.fetch("host"), path: Regexp.new(l.fetch("path"))) }
  end
end
