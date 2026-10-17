# URL 取り込みで取得を許可する楽譜サイト（config/score_sources.json で定義）
class ScoreSource
  Location = Data.define(:host, :path)

  attr_reader :id, :name, :homepage, :formats, :license, :locations

  def self.all
    @all ||= JSON.parse(Rails.root.join("config/score_sources.json").read).map { |attrs| new(attrs) }.freeze
  end

  # https で、許可したホストとパスに一致する URI か
  def self.allowed?(uri)
    return false unless uri.scheme == "https" && uri.userinfo.nil?
    host = uri.host.to_s.downcase
    all.any? { |source| source.locations.any? { |l| l.host == host && l.path.match?(uri.path.to_s) } }
  end

  def initialize(attrs)
    @id, @name, @homepage, @formats, @license = attrs.values_at("id", "name", "homepage", "formats", "license")
    @locations = attrs.fetch("locations").map { |l| Location.new(host: l.fetch("host"), path: Regexp.new(l.fetch("path"))) }
  end
end
