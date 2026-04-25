#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# UW Discovery via Brave Search
# Purpose:
#   Brave only discovers public Unusual Whales URLs and docs.
#   It does NOT read member-only data, cookies, or logged-in pages.
# Output:
#   integrations/unusual-whales/discovery/uw_raw_results/raw_*.json
# Then run:
#   python3 integrations/unusual-whales/discovery/uw_parse.py
# ============================================================

BASE_URL="https://api.search.brave.com/res/v1/web/search"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_DIR="$SCRIPT_DIR/uw_raw_results"
COUNT="${BRAVE_SEARCH_COUNT:-20}"

mkdir -p "$RAW_DIR"

if [[ -z "${BRAVE_API_KEY:-}" ]]; then
  echo "ERROR: Please set BRAVE_API_KEY first."
  echo "Example: export BRAVE_API_KEY='your_key_here'"
  exit 1
fi

API_KEY="$BRAVE_API_KEY"

echo "开始搜索 Unusual Whales 页面结构..."
echo "Raw 输出目录: $RAW_DIR"

search_brave() {
  local module="$1"
  local query="$2"
  local outfile="$3"

  echo "搜索 [$module] => $query"

  local http_code
  http_code=$(curl -sS --compressed -w "%{http_code}" -o "$outfile" "$BASE_URL" \
    -H "Accept: application/json" \
    -H "X-Subscription-Token: $API_KEY" \
    -G \
    --data-urlencode "q=$query" \
    --data-urlencode "count=$COUNT" \
    --data-urlencode "extra_snippets=true" \
    --data-urlencode "safesearch=off")

  if [[ "$http_code" == "429" ]]; then
    echo "WARN: Rate limited [$module]. Retrying in 8s..."
    sleep 8
    http_code=$(curl -sS --compressed -w "%{http_code}" -o "$outfile" "$BASE_URL" \
      -H "Accept: application/json" \
      -H "X-Subscription-Token: $API_KEY" \
      -G \
      --data-urlencode "q=$query" \
      --data-urlencode "count=$COUNT" \
      --data-urlencode "extra_snippets=true" \
      --data-urlencode "safesearch=off")
  fi

  if [[ "$http_code" != "200" ]]; then
    echo "WARN: HTTP $http_code for [$module], saved to $outfile"
  fi

  sleep 1
}

# ============================================================
# S 级：第一阶段必须找
# ============================================================

# 1) SPX Greek Exposure / GEX / Vanna / Charm
search_brave "spx_greek_exposure" "site:unusualwhales.com SPX greek exposure GEX DEX Vanna Charm" "$RAW_DIR/raw_1a_spx_greek.json"
search_brave "spx_greek_exposure" "site:unusualwhales.com greek-exposure gamma dealer zero gamma" "$RAW_DIR/raw_1b_spx_greek.json"
search_brave "spx_greek_exposure" "site:unusualwhales.com SPX gamma vanna charm dealer hedging" "$RAW_DIR/raw_1c_spx_greek.json"

# 2) SPY Dark Pool / Off-lit / Price Levels
search_brave "spy_darkpool_offlit" "site:unusualwhales.com SPY dark pool" "$RAW_DIR/raw_2a_spy_darkpool.json"
search_brave "spy_darkpool_offlit" "site:unusualwhales.com darkpool price levels off-exchange SPY" "$RAW_DIR/raw_2b_spy_darkpool.json"
search_brave "spy_darkpool_offlit" "site:unusualwhales.com dark pool premium size volume price levels" "$RAW_DIR/raw_2c_spy_darkpool.json"

# 3) Options Flow / Flow Alerts
search_brave "options_flow_alerts" "site:unusualwhales.com options flow alerts premium sweep floor" "$RAW_DIR/raw_3a_flow.json"
search_brave "options_flow_alerts" "site:unusualwhales.com flow premium sweep floor SPX SPY QQQ" "$RAW_DIR/raw_3b_flow.json"
search_brave "options_flow_alerts" "site:unusualwhales.com options flow ask side bid side open interest" "$RAW_DIR/raw_3c_flow.json"

# ============================================================
# A 级：第二阶段找入口，暂不接入主看板
# ============================================================

# 4) NOPE
search_brave "nope" "site:unusualwhales.com NOPE net options pricing effect" "$RAW_DIR/raw_4a_nope.json"
search_brave "nope" "site:unusualwhales.com NOPE call delta put delta stock volume" "$RAW_DIR/raw_4b_nope.json"

# 5) IV / Volatility
search_brave "volatility_iv" "site:unusualwhales.com IV rank implied volatility" "$RAW_DIR/raw_5a_volatility.json"
search_brave "volatility_iv" "site:unusualwhales.com realized volatility term structure volatility statistics" "$RAW_DIR/raw_5b_volatility.json"

# 6) Help / guide / docs
search_brave "uw_help_docs" "site:unusualwhales.com help guide documentation options flow greek exposure dark pool" "$RAW_DIR/raw_6a_help.json"

echo "Brave 搜索完成。下一步运行：python3 \"$SCRIPT_DIR/uw_parse.py\""
