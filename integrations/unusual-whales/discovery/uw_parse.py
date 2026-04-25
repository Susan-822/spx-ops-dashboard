#!/usr/bin/env python3
"""
Parse Brave Search raw JSON for Unusual Whales discovery.

Input:
  discovery/uw_raw_results/raw_*.json

Output:
  discovery/uw_discovery_results.json

This parser only cleans public Brave search results. It does not read UW member data,
store cookies, or access logged-in pages.
"""

import json
import re
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "uw_raw_results"
OUTPUT_FILE = BASE_DIR / "uw_discovery_results.json"

MODULE_CONFIG = {
    "spx_greek_exposure": {
        "file_prefix": "raw_1",
        "priority": "S",
        "purpose": "判断 SPX dealer / 做市商控波还是放波",
        "expected_keywords": [
            "greek exposure", "gex", "dex", "gamma", "vanna", "charm",
            "spx", "dealer", "hedging", "flip", "zero gamma", "gamma exposure"
        ],
        "url_boost_patterns": [r"/stock/spx", r"greek", r"gex", r"gamma", r"exposure"],
        "fields_to_extract_by_dom": [
            "net_gex", "net_dex", "net_vanna", "net_charm",
            "gamma_regime", "dealer_behavior", "zero_gamma_or_flip",
            "top_call_gamma_strikes", "top_put_gamma_strikes",
            "expiry_breakdown", "strike_breakdown", "last_update"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com SPX greek exposure",
            "site:unusualwhales.com gamma exposure dealer",
            "site:unusualwhales.com SPX gamma vanna charm"
        ],
        "cursor_next_step": "Playwright 打开最高置信 URL，读取 SPX Greek Exposure 可见数据，转成 dealer snapshot。"
    },
    "spy_darkpool_offlit": {
        "file_prefix": "raw_2",
        "priority": "S",
        "purpose": "判断 SPY 暗池 / Off-Lit 对 SPX 的支撑和压力",
        "expected_keywords": [
            "dark pool", "darkpool", "off lit", "off-lit", "off exchange",
            "price levels", "spy", "premium", "size", "volume", "institutional"
        ],
        "url_boost_patterns": [r"darkpool", r"dark-pool", r"/stock/spy", r"off-lit", r"off_lit"],
        "fields_to_extract_by_dom": [
            "nearest_darkpool_support", "nearest_darkpool_resistance",
            "largest_darkpool_levels", "off_lit_ratio",
            "recent_large_darkpool_trades", "darkpool_bias", "last_update"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com dark pool SPY",
            "site:unusualwhales.com darkpool price levels",
            "site:unusualwhales.com off lit SPY volume"
        ],
        "cursor_next_step": "Playwright 读取 SPY Dark Pool / Off-Lit 页面可见数据，计算支撑、压力和暗池偏向。"
    },
    "options_flow_alerts": {
        "file_prefix": "raw_3",
        "priority": "S",
        "purpose": "判断 SPX / SPY / QQQ 是否有真实资金推方向",
        "expected_keywords": [
            "options flow", "flow alerts", "flow", "premium", "ask side", "bid side",
            "sweep", "floor", "multi-leg", "multileg", "volume", "open interest",
            "oi", "iv", "spx", "spy", "qqq"
        ],
        "url_boost_patterns": [r"/flow", r"options-flow", r"flow-alerts", r"/alerts"],
        "fields_to_extract_by_dom": [
            "call_ask_premium_5m", "put_ask_premium_5m",
            "call_bid_premium_5m", "put_bid_premium_5m",
            "sweep_count_5m", "repeated_hits_count_5m",
            "floor_trade_count_15m", "multi_leg_ratio",
            "volume_oi_ratio", "iv_change", "flow_bias",
            "flow_speed", "flow_thrust", "last_update"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com options flow",
            "site:unusualwhales.com flow alerts premium",
            "site:unusualwhales.com options flow SPX SPY QQQ"
        ],
        "cursor_next_step": "Playwright 读取 Flow 页面中 SPX / SPY / QQQ 的可见期权流，计算 Flow 偏向、速度和推力。"
    },
    "nope": {
        "file_prefix": "raw_4",
        "priority": "A_phase_2",
        "purpose": "辅助判断期权流是否过热或背离",
        "expected_keywords": [
            "nope", "net options pricing effect", "call delta", "put delta",
            "stock volume", "divergence"
        ],
        "url_boost_patterns": [r"/nope", r"nope"],
        "fields_to_extract_by_dom": [
            "nope", "nope_fill", "call_delta", "put_delta",
            "call_volume", "put_volume", "stock_volume",
            "nope_state", "divergence"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com NOPE",
            "site:unusualwhales.com net options pricing effect"
        ],
        "cursor_next_step": "第二阶段再接。只作为过热和背离辅助，不作为主方向。"
    },
    "volatility_iv": {
        "file_prefix": "raw_5",
        "priority": "A_phase_2",
        "purpose": "判断是否适合卖波、铁鹰是否允许",
        "expected_keywords": [
            "iv rank", "iv percentile", "implied volatility", "realized volatility",
            "volatility", "term structure", "vol", "vix"
        ],
        "url_boost_patterns": [r"/volatility", r"/iv", r"iv-rank", r"term-structure", r"ivrank"],
        "fields_to_extract_by_dom": [
            "iv_rank", "iv_percentile", "realized_volatility",
            "implied_volatility", "term_structure_state",
            "sell_vol_permission", "iron_condor_permission"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com IV rank",
            "site:unusualwhales.com implied volatility",
            "site:unusualwhales.com realized volatility"
        ],
        "cursor_next_step": "第二阶段再接，用来决定是否允许铁鹰和卖波。"
    },
    "uw_help_docs": {
        "file_prefix": "raw_6",
        "priority": "B",
        "purpose": "寻找 UW 公开说明和字段解释，辅助页面识别",
        "expected_keywords": [
            "guide", "help", "documentation", "tutorial", "how to",
            "faq", "support", "learn"
        ],
        "url_boost_patterns": [r"/help", r"/guide", r"/docs", r"/faq", r"/support", r"/learn", r"/blog"],
        "fields_to_extract_by_dom": [
            "documentation_url", "module_descriptions", "field_names"
        ],
        "fallback_search_queries": [
            "site:unusualwhales.com help",
            "site:unusualwhales.com documentation guide"
        ],
        "cursor_next_step": "仅用于字段解释和页面确认，不进入 Dashboard。"
    }
}


def infer_module(filename: str):
    for module, cfg in MODULE_CONFIG.items():
        if filename.startswith(cfg["file_prefix"]):
            return module
    return None


def normalize_url(url: str) -> str:
    if not url:
        return ""
    return url.split("#")[0].rstrip("/").strip()


def get_keyword_hits(keywords, text: str):
    text_lower = (text or "").lower()
    return [kw for kw in keywords if kw.lower() in text_lower]


def compute_confidence(cfg, url, title, description, extra_snippets) -> float:
    keywords = [kw.lower() for kw in cfg.get("expected_keywords", [])]
    url_patterns = cfg.get("url_boost_patterns", [])

    parsed = urlparse(url or "")
    if "unusualwhales.com" not in parsed.netloc.lower():
        return 0.0

    score = 0.30

    url_lower = (url or "").lower()
    url_hits = sum(1 for pattern in url_patterns if re.search(pattern, url_lower))
    score += min(0.25, url_hits * 0.12)

    text_blob = f"{title or ''} {description or ''}".lower()
    keyword_hits = sum(1 for kw in keywords if kw in text_blob)
    score += min(0.35, keyword_hits * 0.05)

    snippets_blob = " ".join(extra_snippets or []).lower()
    snippet_hits = sum(1 for kw in keywords if kw in snippets_blob)
    score += min(0.10, snippet_hits * 0.02)

    return round(min(score, 1.0), 2)


def generate_why(cfg, url, confidence, keyword_hits):
    purpose = cfg.get("purpose", "")
    path = urlparse(url or "").path or "/"

    if confidence >= 0.70:
        strength = "高置信"
    elif confidence >= 0.50:
        strength = "中置信"
    else:
        strength = "低置信"

    hits_str = ", ".join(keyword_hits[:6]) if keyword_hits else "无明确关键词"
    return f"{strength}({confidence})：路径 {path} | 命中: {hits_str} | 用途: {purpose}"


def init_modules():
    modules = {}
    for module, cfg in MODULE_CONFIG.items():
        modules[module] = {
            "module": module,
            "priority": cfg["priority"],
            "purpose": cfg["purpose"],
            "status": "not_found",
            "candidate_urls": [],
            "expected_keywords": cfg["expected_keywords"],
            "fields_to_extract_by_dom": cfg["fields_to_extract_by_dom"],
            "fallback_search_queries": cfg["fallback_search_queries"],
            "cursor_next_step": cfg["cursor_next_step"]
        }
    return modules


def main():
    modules = init_modules()
    seen = {}
    errors = []

    if not RAW_DIR.exists():
        errors.append({"error": f"raw directory not found: {RAW_DIR}"})

    for file in sorted(RAW_DIR.glob("raw_*.json")):
        module = infer_module(file.name)
        if not module:
            errors.append({"file": file.name, "error": "无法识别模块：文件名前缀不匹配"})
            continue

        cfg = MODULE_CONFIG[module]

        try:
            data = json.loads(file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append({"file": file.name, "module": module, "error": f"JSON解析失败: {exc}"})
            continue
        except Exception as exc:
            errors.append({"file": file.name, "module": module, "error": f"读取失败: {exc}"})
            continue

        if isinstance(data, dict) and data.get("error"):
            errors.append({"file": file.name, "module": module, "error": f"Brave API错误: {data.get('error')}"})
            continue

        web_results = (data.get("web") or {}).get("results") or []
        if not web_results:
            errors.append({"file": file.name, "module": module, "error": "web.results 为空"})
            continue

        for item in web_results:
            url = normalize_url(item.get("url", ""))
            if not url:
                continue

            title = item.get("title", "") or ""
            desc = item.get("description", "") or ""
            extra = item.get("extra_snippets", []) or []

            confidence = compute_confidence(cfg, url, title, desc, extra)
            full_text = f"{title} {desc} {' '.join(extra)}"
            kw_hits = get_keyword_hits(cfg["expected_keywords"], full_text)
            why = generate_why(cfg, url, confidence, kw_hits)

            candidate = {
                "url": url,
                "title": title,
                "snippet": desc[:350],
                "extra_snippets": extra[:5],
                "confidence": confidence,
                "keyword_hits": kw_hits[:10],
                "source_file": file.name,
                "why_it_matters": why
            }

            key = f"{module}:{url}"
            if key not in seen or confidence > seen[key]["confidence"]:
                seen[key] = candidate

    for key, candidate in seen.items():
        module = key.split(":", 1)[0]
        if module in modules:
            modules[module]["candidate_urls"].append(candidate)

    for module_obj in modules.values():
        module_obj["candidate_urls"] = sorted(
            module_obj["candidate_urls"],
            key=lambda item: item.get("confidence", 0),
            reverse=True
        )[:10]

        if not module_obj["candidate_urls"]:
            module_obj["status"] = "not_found"
        elif module_obj["candidate_urls"][0].get("confidence", 0) >= 0.60:
            module_obj["status"] = "found"
        else:
            module_obj["status"] = "partial"

    output = {
        "source_discovery": {
            "provider": "brave_search",
            "target_site": "unusualwhales.com",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "notes": [
                "Brave only discovers public URLs and documentation.",
                "Brave does not read member-only data.",
                "DOM Reader must run locally with user's logged-in UW browser profile.",
                "Do not store UW cookies or account credentials in this output.",
                "Do not publish raw member-only UW data."
            ]
        },
        "modules": list(modules.values()),
        "errors": errors
    }

    OUTPUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"OK: 已生成 {OUTPUT_FILE}")
    print(f"模块数量: {len(output['modules'])}")
    print(f"错误数量: {len(errors)}")
    for module in output["modules"]:
        print(f"- {module['module']}: {module['status']} | {len(module['candidate_urls'])} urls")


if __name__ == "__main__":
    main()
