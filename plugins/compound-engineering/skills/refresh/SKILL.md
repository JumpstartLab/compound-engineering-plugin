---
name: ce:refresh
description: "Sync reviewer personas from external Git repos into the local plugin. Reads sources from reviewer-registry.yaml, fetches .md files, and places them in agents/review/. Use when setting up the plugin for the first time, after updating your reviewer repo, or to pull in new reviewer personas."
---

# Refresh Reviewers

Syncs reviewer persona files from external Git repositories into the plugin's `agents/review/` directory. Reviewer files are not committed to the plugin repo — they live in external repos and are fetched on demand.

## How It Works

1. Read `sources` from `plugins/compound-engineering/skills/ce-review/references/reviewer-registry.yaml`
2. For each source, fetch `.md` files from the specified repo, branch, and path
3. Place them in `plugins/compound-engineering/agents/review/`
4. Report what was added, updated, or unchanged

## Fetching Strategy

Try `gh` first (faster, no local clone needed). Fall back to `git` if `gh` is not available.

### With `gh` CLI:

For each source, run:

```bash
# List .md files in the source path
gh api repos/{source.repo}/contents/{source.path} \
  --jq '.[] | select(.name | endswith(".md")) | .name' \
  -H "Accept: application/vnd.github.v3+json" \
  --method GET \
  -f ref={source.branch}

# Download each file
gh api repos/{source.repo}/contents/{source.path}/{filename} \
  --jq '.content' \
  -H "Accept: application/vnd.github.v3+json" \
  -f ref={source.branch} | base64 -d > agents/review/{filename}
```

### Without `gh` (git fallback):

```bash
# Shallow clone into a temp directory
tmp=$(mktemp -d)
git clone --depth 1 --branch {source.branch} \
  https://github.com/{source.repo}.git "$tmp" 2>/dev/null

# Copy .md files from the source path
cp "$tmp"/{source.path}/*.md agents/review/

# Clean up
rm -rf "$tmp"
```

## Source Configuration

Sources are defined in `reviewer-registry.yaml` under the `sources` key:

```yaml
sources:
  - name: my-reviewers
    repo: username/repo-name
    branch: main
    path: reviewers/

  - name: community-reviewers
    repo: SomeOrg/ce-reviewers
    branch: main
    path: .
    except:
      - kieran-python-reviewer
      - kieran-typescript-reviewer
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | A label for this source (used in status output) |
| `repo` | yes | — | GitHub owner/repo (e.g., `JumpstartLab/ce-reviewers`) |
| `branch` | no | `main` | Branch to fetch from |
| `path` | no | `.` | Directory within the repo containing reviewer `.md` files |
| `except` | no | `[]` | List of reviewer filenames (without `.md`) to skip from this source |

## Conflict Resolution

Sources listed first in the YAML have higher priority. If two sources contain a file with the same name, the first source wins.

To implement this, **process sources in reverse order** (bottom-to-top). Each source writes its files, and earlier sources overwrite later ones. This ensures the first-listed source has final say.

When a conflict is detected, warn: "Conflict: {filename} — keeping version from '{higher-priority-source}' (overrides '{lower-priority-source}')"

## Execution

1. **Read the registry** at the path shown above. Parse the YAML and extract the `sources` array.
2. **If sources is empty or missing**, report "No external reviewer sources configured" and explain how to add one to `reviewer-registry.yaml`.
3. **Process sources in reverse order** (last source first, first source last — so first-listed source wins conflicts):
   a. Announce: "Syncing from {name} ({repo}@{branch}:{path})..."
   b. Determine if `gh` is available (`which gh`). Use `gh` if present, `git clone` otherwise.
   c. Fetch all `.md` files from the source path (skip README.md).
   d. If the source has an `except` list, skip any file whose name (without `.md`) matches an entry. Report: "Skipped: {filename} (excluded by config)"
   e. For each remaining file, compare with any existing file in `agents/review/`:
      - New file → copy and report "Added: {filename}"
      - Changed file → overwrite and report "Updated: {filename}"
      - Unchanged → report "Unchanged: {filename}"
   e. Track which source provided each file for conflict reporting.
4. **Report orphans**: files in `agents/review/` (excluding `_template-reviewer.md`) that are not present in any configured source. Don't auto-delete — just warn.
5. **Summary**: "Synced {n} reviewers from {m} sources. {added} added, {updated} updated, {unchanged} unchanged, {conflicts} conflicts resolved."

## Error Handling

- If a source repo doesn't exist or the branch is wrong, report the error and continue to the next source.
- If neither `gh` nor `git` is available, stop with a clear error message.
- Never delete files from `agents/review/` automatically — only warn about orphans.
