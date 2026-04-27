#!/usr/bin/env python3
import datetime as dt
import json
import math
import os
import sys
from pathlib import Path

ROOT_CANDIDATES = ("SPXW", "SPX")


def empty_result():
    return {
        "thetadata_python_client": "fail",
        "auth": "fail",
        "root_tested": None,
        "expirations": "fail",
        "test_expiration": None,
        "option_chain": "fail",
        "quote": "fail",
        "iv": "fail",
        "greeks": "fail",
        "open_interest": "fail",
        "sample_contract_count": 0,
        "sample_fields": {
            "strike": False,
            "right": False,
            "bid": False,
            "ask": False,
            "iv": False,
            "gamma": False,
            "open_interest": False,
        },
        "usable_for_dealer_engine": False,
        "missing_fields": [],
        "warnings": [],
    }


def warn(result, message):
    if message and message not in result["warnings"]:
        result["warnings"].append(message)


def normalized_key(value):
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def first_value(row, aliases):
    lookup = {normalized_key(key): value for key, value in row.items()}
    for alias in aliases:
        value = lookup.get(normalized_key(alias))
        if value is not None:
            return value
    return None


def to_number(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def round_number(value, digits=2):
    number = to_number(value)
    return None if number is None else round(number, digits)


def normalize_right(value):
    raw = str(value or "").strip().upper()
    if raw in ("C", "CALL", "0"):
        return "C"
    if raw in ("P", "PUT", "1"):
        return "P"
    return raw or None


def dataframe_rows(frame):
    if frame is None:
        return []
    if hasattr(frame, "to_dicts"):
        return frame.to_dicts()
    if hasattr(frame, "to_dict"):
        return frame.to_dict(orient="records")
    return []


def normalize_date(value):
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    raw = str(value).strip()
    for fmt, length in (("%Y-%m-%d", 10), ("%Y%m%d", 8)):
        try:
            return dt.datetime.strptime(raw[:length], fmt).date()
        except ValueError:
            continue
    return None


def extract_expirations(frame):
    expirations = []
    for row in dataframe_rows(frame):
        preferred = first_value(row, ("expiration", "expirations", "expiration_date", "exp", "date"))
        candidates = [preferred] if preferred is not None else list(row.values())
        for value in candidates:
            parsed = normalize_date(value)
            if parsed:
                expirations.append(parsed)
                break
    return sorted(set(expirations))


def pick_expiration(expirations, requested=None):
    requested_date = normalize_date(requested if requested is not None else os.getenv("THETA_TEST_EXPIRATION"))
    if requested_date:
        return requested_date
    today = dt.date.today()
    upcoming = [item for item in expirations if item >= today]
    return (upcoming or expirations)[0] if expirations else None


def contract_from_row(row):
    return {
        "strike": to_number(first_value(row, ("strike", "strike_price"))),
        "right": normalize_right(first_value(row, ("right", "put_call", "contract_type", "option_type"))),
        "bid": to_number(first_value(row, ("bid", "bid_price", "bid_px"))),
        "ask": to_number(first_value(row, ("ask", "ask_price", "ask_px"))),
        "iv": to_number(first_value(row, ("iv", "implied_vol", "implied_volatility", "mid_iv", "bid_iv", "ask_iv"))),
        "gamma": to_number(first_value(row, ("gamma",))),
        "open_interest": to_number(first_value(row, ("open_interest", "openinterest", "oi"))),
    }


def merge_contracts(target, frame):
    for row in dataframe_rows(frame):
        contract = contract_from_row(row)
        if contract["strike"] is None or contract["right"] not in ("C", "P"):
            continue
        key = (contract["strike"], contract["right"])
        target.setdefault(key, {"strike": contract["strike"], "right": contract["right"]})
        for field, value in contract.items():
            if value is not None:
                target[key][field] = value


def build_contract_rows(parts):
    contracts = {}
    for key in ("quote", "iv", "greeks", "open_interest"):
        merge_contracts(contracts, parts.get(key))
    return list(contracts.values())


def sample_fields(contracts):
    return {
        "strike": any(item.get("strike") is not None for item in contracts),
        "right": any(item.get("right") in ("C", "P") for item in contracts),
        "bid": any(item.get("bid") is not None for item in contracts),
        "ask": any(item.get("ask") is not None for item in contracts),
        "iv": any(item.get("iv") is not None for item in contracts),
        "gamma": any(item.get("gamma") is not None for item in contracts),
        "open_interest": any(item.get("open_interest") is not None for item in contracts),
    }


def status_from_rows(rows, aliases):
    for row in rows:
        contract = contract_from_row(row)
        if any(contract.get(alias) is not None for alias in aliases):
            return "pass"
    return "partial" if rows else "fail"


def credentials_args(result=None):
    email = os.getenv("THETADATA_EMAIL")
    password = os.getenv("THETADATA_PASSWORD")
    if email and password:
        return {"email": email, "password": password}
    creds_file = os.getenv("THETADATA_CREDENTIALS_FILE") or "creds.txt"
    if Path(creds_file).exists():
        return {"creds_file": creds_file}
    if result is not None:
        warn(result, "thetadata_credentials_missing")
    return None


def build_client():
    from thetadata import Client

    creds = credentials_args()
    if not creds:
        raise RuntimeError("thetadata_credentials_missing")
    return Client(dataframe_type="polars", **creds)


def choose_root(client, roots=ROOT_CANDIDATES):
    messages = []
    for root in roots:
        try:
            expirations = extract_expirations(client.option_list_expirations([root]))
        except Exception as error:
            messages.append(f"{root}_expirations_failed:{type(error).__name__}")
            continue
        if expirations:
            return root, expirations
        messages.append(f"{root}_no_expirations")
    raise RuntimeError(";".join(messages) or "expirations_unavailable")


def fetch_chain_parts(client, root, expiration, spot=None):
    parts = {"warnings": []}
    try:
        parts["quote"] = client.option_snapshot_quote(root, expiration, strike="*", right="both")
    except Exception as error:
        parts["warnings"].append(f"quote_failed:{type(error).__name__}")
    try:
        parts["iv"] = client.option_snapshot_greeks_implied_volatility(
            root,
            expiration,
            strike="*",
            right="both",
            stock_price=to_number(spot),
            use_market_value=True,
        )
    except Exception as error:
        parts["warnings"].append(f"iv_failed:{type(error).__name__}")
    try:
        parts["greeks"] = client.option_snapshot_greeks_first_order(
            root,
            expiration,
            strike="*",
            right="both",
            stock_price=to_number(spot),
            use_market_value=True,
        )
    except Exception as error:
        parts["warnings"].append(f"greeks_failed:{type(error).__name__}")
    try:
        parts["open_interest"] = client.option_snapshot_open_interest(root, expiration, strike="*", right="both")
    except Exception as error:
        parts["warnings"].append(f"open_interest_failed:{type(error).__name__}")
    return parts


def mid_price(contract):
    if not contract:
        return None
    bid = to_number(contract.get("bid"))
    ask = to_number(contract.get("ask"))
    if bid is not None and ask is not None:
        return (bid + ask) / 2
    return None


def expected_move(contracts, spot):
    if spot is None:
        return None, None
    strikes = sorted({item["strike"] for item in contracts if item.get("strike") is not None})
    if not strikes:
        return None, None
    strike = min(strikes, key=lambda item: (abs(item - spot), item))
    call = next((item for item in contracts if item.get("strike") == strike and item.get("right") == "C"), None)
    put = next((item for item in contracts if item.get("strike") == strike and item.get("right") == "P"), None)
    call_mid = mid_price(call)
    put_mid = mid_price(put)
    return strike, None if call_mid is None or put_mid is None else call_mid + put_mid


def gex_value(contract, spot):
    gamma = to_number(contract.get("gamma"))
    oi = to_number(contract.get("open_interest"))
    if gamma is None or oi is None or spot is None:
        return None
    sign = -1 if contract.get("right") == "P" else 1
    return sign * gamma * oi * spot * spot * 100 * 0.01


def compute_max_pain(contracts):
    strikes = sorted({item["strike"] for item in contracts if item.get("strike") is not None})
    oi_contracts = [item for item in contracts if item.get("open_interest") is not None]
    if not strikes or not oi_contracts:
        return None
    best = None
    for candidate in strikes:
        payout = 0
        for contract in oi_contracts:
            strike = contract["strike"]
            oi = contract["open_interest"]
            if contract.get("right") == "C":
                payout += max(candidate - strike, 0) * oi
            elif contract.get("right") == "P":
                payout += max(strike - candidate, 0) * oi
        if best is None or payout < best[1]:
            best = (candidate, payout)
    return best[0] if best else None


def compute_zero_gamma(gex_by_strike, spot):
    ordered = sorted(gex_by_strike.items())
    crossings = []
    for (left_strike, left_gex), (right_strike, right_gex) in zip(ordered, ordered[1:]):
        if left_gex == 0 or (left_gex < 0 < right_gex) or (left_gex > 0 > right_gex):
            crossings.append((left_strike + right_strike) / 2)
    if not crossings:
        return None
    return round_number(min(crossings, key=lambda item: abs(item - spot)) if spot is not None else crossings[0])


def compute_dealer_summary(contracts, spot, spot_source, expiration, warnings=None):
    warnings = list(dict.fromkeys(warnings or []))
    fields = sample_fields(contracts)
    missing = [field for field in ("bid", "ask", "iv", "gamma", "open_interest") if not fields[field]]
    _, move = expected_move(contracts, spot)
    if move is None:
        missing.append("expected_move")

    call_gex_by_strike = {}
    put_gex_by_strike = {}
    net_by_strike = {}
    for contract in contracts:
        contribution = gex_value(contract, spot)
        if contribution is None:
            continue
        strike = contract["strike"]
        net_by_strike[strike] = net_by_strike.get(strike, 0) + contribution
        bucket = call_gex_by_strike if contract.get("right") == "C" else put_gex_by_strike
        bucket[strike] = bucket.get(strike, 0) + contribution

    net_gex = sum(net_by_strike.values()) if net_by_strike else None
    if net_gex is None:
        missing.append("net_gex")

    call_wall = max(call_gex_by_strike, key=call_gex_by_strike.get) if call_gex_by_strike else None
    put_wall = min(put_gex_by_strike, key=put_gex_by_strike.get) if put_gex_by_strike else None
    if (call_wall is None or put_wall is None) and fields["open_interest"]:
        warnings.append("walls_from_oi_fallback")
        calls = [item for item in contracts if item.get("right") == "C" and item.get("open_interest") is not None]
        puts = [item for item in contracts if item.get("right") == "P" and item.get("open_interest") is not None]
        call_wall = call_wall or (max(calls, key=lambda item: item["open_interest"])["strike"] if calls else None)
        put_wall = put_wall or (max(puts, key=lambda item: item["open_interest"])["strike"] if puts else None)
    if call_wall is None:
        missing.append("call_wall")
    if put_wall is None:
        missing.append("put_wall")

    max_pain = compute_max_pain(contracts)
    zero_gamma = compute_zero_gamma(net_by_strike, spot)
    if max_pain is None:
        missing.append("max_pain")
    if zero_gamma is None:
        missing.append("zero_gamma")

    gamma_regime = "unknown"
    if net_gex is not None:
        gamma_regime = "positive" if net_gex > 100_000_000 else "negative" if net_gex < -100_000_000 else "critical"
    status = "live" if contracts and spot is not None else "partial" if contracts else "unavailable"
    if status == "live" and ("gamma" in missing or "open_interest" in missing or "expected_move" in missing):
        status = "partial"
    dealer_behavior = "pin" if status == "live" and gamma_regime == "positive" else "expand" if status == "live" and gamma_regime == "negative" else "unknown"
    least_path = "range" if dealer_behavior == "pin" else "unknown"

    return {
        "source": "thetadata_python",
        "status": status,
        "last_update": dt.datetime.now(dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "ticker": "SPX",
        "spot_source": spot_source,
        "spot": spot,
        "test_expiration": expiration,
        "dealer": {
            "net_gex": round_number(net_gex),
            "gamma_regime": gamma_regime,
            "dealer_behavior": dealer_behavior,
            "least_resistance_path": least_path,
            "call_wall": call_wall,
            "put_wall": put_wall,
            "max_pain": max_pain,
            "zero_gamma": zero_gamma,
            "expected_move_upper": round_number(spot + move, 4) if spot is not None and move is not None else None,
            "expected_move_lower": round_number(spot - move, 4) if spot is not None and move is not None else None,
        },
        "quality": {
            "data_quality": "live" if status == "live" and not missing else "partial" if contracts else "unavailable",
            "missing_fields": sorted(set(missing)),
            "warnings": sorted(set(warnings)),
            "calculation_scope": "single_expiry_test",
            "raw_rows_sent": False,
        },
    }


def main():
    result = empty_result()
    if sys.version_info < (3, 12):
        warn(result, "python_3_12_required")
        print(json.dumps(result, indent=2))
        return 1
    try:
        import thetadata  # noqa: F401
    except Exception as error:
        warn(result, f"thetadata_import_failed:{type(error).__name__}")
        print(json.dumps(result, indent=2))
        return 1

    result["thetadata_python_client"] = "pass"
    creds = credentials_args(result)
    if not creds:
        print(json.dumps(result, indent=2))
        return 2
    try:
        client = build_client()
    except Exception as error:
        warn(result, f"auth_failed:{type(error).__name__}")
        print(json.dumps(result, indent=2))
        return 2

    result["auth"] = "pass"
    try:
        root, expirations = choose_root(client)
    except Exception as error:
        warn(result, str(error))
        print(json.dumps(result, indent=2))
        return 3

    expiration = pick_expiration(expirations)
    result["root_tested"] = root
    result["expirations"] = "pass" if expirations else "fail"
    result["test_expiration"] = expiration.isoformat() if expiration else None
    if not expiration:
        warn(result, "no_test_expiration_available")
        print(json.dumps(result, indent=2))
        return 3

    parts = fetch_chain_parts(client, root, expiration, os.getenv("THETA_TEST_SPOT"))
    contracts = build_contract_rows(parts)
    fields = sample_fields(contracts)
    result["sample_contract_count"] = len(contracts)
    result["sample_fields"] = fields
    result["option_chain"] = "pass" if contracts else "fail"
    result["quote"] = status_from_rows(dataframe_rows(parts.get("quote")), ("bid", "ask"))
    result["iv"] = status_from_rows(dataframe_rows(parts.get("greeks")), ("iv",))
    result["greeks"] = status_from_rows(dataframe_rows(parts.get("greeks")), ("gamma",))
    result["open_interest"] = status_from_rows(dataframe_rows(parts.get("open_interest")), ("open_interest",))
    result["missing_fields"] = [field for field, present in fields.items() if not present]
    result["warnings"] = sorted(set(result["warnings"] + parts.get("warnings", [])))
    result["usable_for_dealer_engine"] = bool(
        contracts and fields["strike"] and fields["right"] and any(fields[field] for field in ("bid", "ask", "iv", "gamma", "open_interest"))
    )
    print(json.dumps(result, indent=2))
    return 0 if result["usable_for_dealer_engine"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
