# spx-ops-dashboard

## Archived files

The repository now includes a generated archive inventory at
[`ARCHIVED_FILES.md`](./ARCHIVED_FILES.md).

It is built from git refs by treating a file as archived when it still exists in
at least one scanned ref but no longer exists in the baseline ref.

Refresh the report with:

```bash
python3 scripts/generate_archived_files_report.py
```