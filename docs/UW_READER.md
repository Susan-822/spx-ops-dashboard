# UW Reader

## Purpose
The UW reader converts UW content into structured semantic output for the rest of the system.

## Hard rules
- UW must go through a Semantic Mapper.
- The frontend must not parse UW HTML.
- Raw DOM and raw HTML are backend concerns only.
- Missing UW configuration must not crash the system.
- Fallback responses must be explicitly marked as mock.

## Output expectations
The UW reader should emit structured fields plus `last_updated` so stale checks can be enforced before downstream use.
