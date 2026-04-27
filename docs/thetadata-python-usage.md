 # ThetaData Python Library P3 usage
 
 This path uses the ThetaData Python Library directly. It does not use Theta
 Terminal, `127.0.0.1:25503`, Java Terminal, or the old Node probe as the main
 path.
 
 ## Requirements
 
 - Python 3.12+
 - `python -m pip install thetadata`
 - Options Standard credentials only; SPX spot remains external/FMP/manual test
 
 ## Credentials
 
 Preferred:
 
 - `THETADATA_EMAIL`
 - `THETADATA_PASSWORD`
 
 Alternatives:
 
 - `THETADATA_CREDENTIALS_FILE`
 - `./creds.txt` with email on line 1 and password on line 2
 
 Never commit `creds.txt`.
 
 ## Probe
 
 `python scripts/theta-python-probe.py`
 
 The probe tries `SPXW` first, then `SPX`, and reports whether expirations,
 quote bid/ask, IV, gamma, and open interest are available.
 
 ## Bridge dry run
 
 `THETA_TEST_EXPIRATION=YYYY-MM-DD THETA_TEST_SPOT=7165.08 THETA_BRIDGE_DRY_RUN=1 python scripts/theta-python-bridge.py`
 
 ## Bridge push
 
 `CLOUD_URL=https://spxopslab.store DATA_PUSH_API_KEY=... THETA_TEST_EXPIRATION=YYYY-MM-DD THETA_TEST_SPOT=7165.08 python scripts/theta-python-bridge.py`
 
 The bridge posts only the curated dealer summary to `/ingest/theta`; it does
 not post raw option chains, raw greeks tables, or credentials.
