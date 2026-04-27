#!/usr/bin/env python3
"""
Build and push a curated single-expiration ThetaData dealer summary.

This uses the ThetaData Python Library directly. It never posts raw option
chains, raw greeks tables, or credentials.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PROBE_PATH = Path(__file__).with_name("theta-python-probe.py")
PROBE_SPEC = importlib.util.spec_from_file_location("theta_python_probe", PROBE_PATH)
if PROBE_SPEC is None or PROBE_SPEC.loader is None:
    raise RuntimeError("Unable to load theta-python-probe.py.")
theta_probe = importlib.util.module_from_spec(PROBE_SPEC)
PROBE_SPEC.loader.exec_module(theta_probe)

build_client = theta_probe.build_client
build_contract_rows = theta_probe.build_contract_rows
choose_root = theta_probe.choose_root
compute_dealer_summary = theta_probe.compute_dealer_summary
dataframe_rows = theta_probe.dataframe_rows
fetch_chain_parts = theta_probe.fetch_chain_parts
normalize_date = theta_probe.normalize_date
pick_expiration = theta_probe.pick_expiration
status_from_rows = theta_probe.status_from_rows


def get_float_env(name: str) -> float | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be numeric.")


def curated_payload(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": summary.get("source", "thetadata_python"),
        "status": summary.get("status", "unavailable"),
        "last_update": summary.get("last_update"),
        "ticker": "SPX",
        "spot_source": summary.get("spot_source", "unavailable"),
        "spot": summary.get("spot"),
        "test_expiration": summary.get("test_expiration"),
        "dealer": {
            "net_gex": summary["dealer"].get("net_gex"),
            "gamma_regime": summary["dealer"].get("gamma_regime", "unknown"),
            "dealer_behavior": summary["dealer"].get("dealer_behavior", "unknown"),
            "least_resistance_path": summary["dealer"].get("least_resistance_path", "unknown"),
            "call_wall": summary["dealer"].get("call_wall"),
            "put_wall": summary["dealer"].get("put_wall"),
            "max_pain": summary["dealer"].get("max_pain"),
            "zero_gamma": summary["dealer"].get("zero_gamma"),
            "expected_move_upper": summary["dealer"].get("expected_move_upper"),
            "expected_move_lower": summary["dealer"].get("expected_move_lower"),
        },
        "quality": {
            "data_quality": summary["quality"].get("data_quality", "unavailable"),
            "missing_fields": summary["quality"].get("missing_fields", []),
            "warnings": summary["quality"].get("warnings", []),
            "calculation_scope": "single_expiry_test",
            "raw_rows_sent": False,
        },
    }


def unavailable_payload(reason: str, spot: float | None, spot_source: str, expiration: str | None = None) -> dict[str, Any]:
    return curated_payload({
        "source": "thetadata_python",
        "status": "partial" if spot is not None else "unavailable",
        "last_update": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "spot_source": spot_source,
        "spot": spot,
        "test_expiration": expiration,
        "dealer": {
            "net_gex": None,
            "gamma_regime": "unknown",
            "dealer_behavior": "unknown",
            "least_resistance_path": "unknown",
            "call_wall": None,
            "put_wall": None,
            "max_pain": None,
            "zero_gamma": None,
            "expected_move_upper": None,
            "expected_move_lower": None,
        },
        "quality": {
            "data_quality": "partial" if spot is not None else "unavailable",
            "missing_fields": ["option_chain"] if spot is not None else ["option_chain", "external_spot"],
            "warnings": [reason],
            "calculation_scope": "single_expiry_test",
            "raw_rows_sent": False,
        },
    })


def post_summary(payload: dict[str, Any]) -> dict[str, Any]:
    cloud_url = os.getenv("CLOUD_URL", "").strip().rstrip("/")
    api_key = os.getenv("DATA_PUSH_API_KEY", "").strip()
    if not cloud_url:
        raise RuntimeError("CLOUD_URL missing.")
    if not api_key:
        raise RuntimeError("DATA_PUSH_API_KEY missing.")

    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{cloud_url}/ingest/theta",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")
            try:
                parsed = json.loads(text) if text else None
            except json.JSONDecodeError:
                parsed = text
            return {
                "status": response.status,
                "ok": 200 <= response.status < 300,
                "body": parsed,
            }
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8")
        try:
            parsed = json.loads(text) if text else None
        except json.JSONDecodeError:
            parsed = text
        return {
            "status": exc.code,
            "ok": False,
            "body": parsed,
        }


def build_summary(client: Any, spot: float | None, spot_source: str) -> dict[str, Any]:
    roots = [root.strip().upper() for root in os.getenv("THETA_OPTION_ROOTS", "SPXW,SPX").split(",") if root.strip()]
    requested_expiration = os.getenv("THETA_TEST_EXPIRATION")
    forced_expiration = normalize_date(requested_expiration) if requested_expiration else None
    if requested_expiration and not forced_expiration:
        raise ValueError("THETA_TEST_EXPIRATION must be YYYY-MM-DD or YYYYMMDD.")

    if forced_expiration:
        root = roots[0] if roots else "SPXW"
        expiration = forced_expiration
    else:
        root, expirations = choose_root(client, roots)
        expiration = pick_expiration(expirations)
        if not expiration:
            return unavailable_payload("no_expiration_available", spot, spot_source)

    parts = fetch_chain_parts(client, root, expiration, spot)
    rows = build_contract_rows(parts)
    summary = compute_dealer_summary(
        rows,
        spot,
        spot_source,
        expiration.isoformat(),
        warnings=parts.get("warnings", []),
    )
    summary["quality"]["warnings"] = sorted(set(summary["quality"]["warnings"] + [
        f"root_tested:{root}",
        f"quote:{status_from_rows(dataframe_rows(parts.get('quote')), ['bid', 'ask'])}",
        f"iv:{status_from_rows(dataframe_rows(parts.get('iv')), ['iv'])}",
        f"greeks:{status_from_rows(dataframe_rows(parts.get('greeks')), ['gamma'])}",
        f"open_interest:{status_from_rows(dataframe_rows(parts.get('open_interest')), ['open_interest'])}",
    ]))
    return curated_payload(summary)


def main() -> int:
    try:
        spot = get_float_env("THETA_TEST_SPOT")
    except ValueError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, indent=2), file=sys.stderr)
        return 1

    spot_source = "manual_test" if spot is not None else "unavailable"
    if os.getenv("THETA_TEST_SPOT_SOURCE"):
        spot_source = os.getenv("THETA_TEST_SPOT_SOURCE", "manual_test").strip() or spot_source

    try:
        client = build_client()
        payload = build_summary(client, spot, spot_source)
    except Exception as exc:
        payload = unavailable_payload(str(exc), spot, spot_source)

    result: dict[str, Any] = {
        "generated_dealer_summary": True,
        "raw_chain_sent": False,
        "raw_greeks_sent": False,
        "payload": payload,
    }

    if os.getenv("THETA_BRIDGE_DRY_RUN") == "1":
        result["post"] = {"skipped": True, "reason": "THETA_BRIDGE_DRY_RUN=1"}
    else:
        result["post"] = post_summary(payload)

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["post"].get("ok") or result["post"].get("skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
