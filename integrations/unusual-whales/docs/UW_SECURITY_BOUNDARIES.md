# UW Security Boundaries

## Scope

This document defines security boundaries for the Unusual Whales integration chain.

Current project stage:

- discovery
- review
- whitelist

Not yet implemented:

- DOM reader
- ingest endpoint wiring
- snapshot store
- `/signals/current` UW merge

## Hard boundaries

The UW integration must not:

- call the UW official API unless explicitly approved in a later phase
- store cookies
- commit browser profiles
- commit raw member-only HTML
- commit screenshots containing private account data
- commit tokens, session IDs, or authentication headers
- bypass login
- automate credential capture

## Allowed artifacts in current phase

- Brave discovery scripts
- curated review JSON/Markdown
- curated whitelist JSON/Markdown
- phase planning docs
- schema placeholders
- ingest contract placeholders
- test placeholders

## Disallowed artifacts in current phase

- raw Brave result dumps in git
- reader temporary files
- reader screenshots
- reader tmp files
- cookie jars
- exported storage/session state
- copied UW member pages

## Git ignore expectations

The repo must ignore:

```gitignore
integrations/unusual-whales/discovery/uw_raw_results/
integrations/unusual-whales/reader/raw/
integrations/unusual-whales/reader/screenshots/
integrations/unusual-whales/reader/tmp/
```

## Data handling rule

At this stage, do not claim live UW data is already integrated.  
Only discovery/review/whitelist groundwork is complete.
