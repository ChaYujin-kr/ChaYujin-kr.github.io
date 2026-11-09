# frozen_string_literal: true

source "https://rubygems.org"

# 테마는 정확한 버전으로 고정(2026-11-09). 올릴 때는 _includes·_data/origin 덮어쓴 파일을 새 버전과 비교할 것.
gem "jekyll-theme-chirpy", "7.6.0"

gem "html-proofer", "~> 5.0", group: :test

platforms :windows, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

gem "wdm", "~> 0.2.0", :platforms => [:windows]

# 2주 규칙(공개 2주 미만 버전 제외)으로 간접 의존성 일부를 고정 (2026-11-09).
# Bundler에는 날짜 필터가 없어서 직접 적는다. 취약점 검사(osv-scanner) 결과가 우선이며, 갱신 시 이 블록부터 확인.
gem "addressable", "2.9.0"
gem "csv", "3.3.6"
gem "ethon", "0.18.0"
gem "jekyll-include-cache", "0.3.1"
gem "nokogiri", "1.19.4"
gem "sass-embedded", "1.106.1"
gem "typhoeus", "1.6.0", group: :test
