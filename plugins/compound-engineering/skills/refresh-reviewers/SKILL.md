---
name: ce:refresh-reviewers
description: "Sync custom reviewer personas from external Git repos into the local plugin. Reads sources from reviewer-registry.yaml, fetches .md files, and drops them into agents/review/custom/. Use when you've updated your reviewer repo or want to pull in new reviewer personas."
---

# Refresh Reviewers

Syncs custom reviewer persona files from external Git repositories into the local plugin's `agents/review/custom/` directory.

## How It Works

1. Read `sources` from `plugins/compound-engineering/skills/ce-review/references/reviewer-registry.yaml`
2. For each source, fetch `.md` files from the specified repo, branch, and path
3. Place them in `plugins/compound-engineering/agents/review/custom/`
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
  -f ref={source.branch} | base64 -d > agents/review/custom/{filename}
```

### Without `gh` (git fallback):

```bash
# Shallow clone into a temp directory
tmp=$(mktemp -d)
git clone --depth 1 --branch {source.branch} \
  https://github.com/{source.repo}.git "$tmp" 2>/dev/null

# Copy .md files from the source path
cp "$tmp"/{source.path}/*.md agents/review/custom/

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
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | A label for this source (used in status output) |
| `repo` | yes | — | GitHub owner/repo (e.g., `JumpstartLab/ce-reviewers`) |
| `branch` | no | `main` | Branch to fetch from |
| `path` | no | `.` | Directory within the repo containing reviewer `.md` files |

## Execution

1. **Read the registry** at the path shown above. Parse the YAML and extract the `sources` array.
2. **If sources is empty or missing**, report "No external reviewer sources configured" and explain how to add one.
3. **For each source**:
   a. Announce: "Syncing from {name} ({repo}@{branch}:{path})..."
   b. Determine if `gh` is available (`which gh`). Use `gh` if present, `git clone` otherwise.
   c. Fetch all `.md` files from the source path.
   d. For each file, compare with any existing file in `custom/`:
      - New file → copy and report "Added: {filename}"
      - Changed file → overwrite and report "Updated: {filename}"
      - Unchanged → report "Unchanged: {filename}"
   e. Report files in `custom/` that came from this source but are no longer in the remote (don't auto-delete — just warn).
4. **Summary**: "Synced {n} reviewers from {m} sources. {added} added, {updated} updated, {unchanged} unchanged."

## Error Handling

- If a source repo doesn't exist or the branch is wrong, report the error and continue to the next source.
- If neither `gh` nor `git` is available, stop with a clear error message.
- Never delete files from `custom/` automatically — only warn about orphans.
