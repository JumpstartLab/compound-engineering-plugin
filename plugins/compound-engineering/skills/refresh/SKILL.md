---
name: ce:refresh
description: "Sync reviewer personas from external Git repos into the local plugin. Reads sources from reviewer-registry.yaml, fetches .md files, and places them in agents/review/. Use when setting up the plugin for the first time, after updating your reviewer repo, or to pull in new reviewer personas."
---

# Refresh Reviewers

Syncs reviewer persona files from external Git repositories into the plugin's `agents/review/` directory.

## Step 1: Locate plugin

Find the plugin's install location in the Claude plugin cache:

```bash
PLUGIN_DIR=$(find "$HOME/.claude" "$HOME/.claude-"* -path "*/compound-engineering/*/agents/review" -type d 2>/dev/null | head -1 | sed 's|/agents/review$||')
```

Fall back to relative path if not found (e.g., running from source repo):

```bash
PLUGIN_DIR="${PLUGIN_DIR:-plugins/compound-engineering}"
```

## Step 2: Interactive source configuration

Read the user's source config at `~/.config/compound-engineering/reviewer-sources.yaml`. If it doesn't exist, the sync script will create it on first run — skip this step and go directly to Step 3.

If the file exists, parse it and present the current sources to the user like this:

Present the options using AskUserQuestion with these exact choices. Use the source names and repos to build the list dynamically:

```
1. Sync now
2. Toggle [source-name] ([owner/repo]) on/off
3. Toggle [source-name] ([owner/repo]) on/off
... (one per source)
N. Add a new source
N+1. Edit config file
```

For toggled-off sources (commented out in YAML), show "[OFF]" in the toggle label.

Handle the user's choice:
- **Sync now** — proceed to Step 3
- **Toggle** — comment out (prefix `# ` to every line of that source entry) or uncomment in the YAML. Write the file. Present the list again.
- **Add a new source** — ask for: repo (required, format `owner/repo`), branch (default: main), name (default: derived from repo). Add the entry at the TOP of the sources list (highest priority). Present the list again.
- **Edit config file** — open `~/.config/compound-engineering/reviewer-sources.yaml` in the user's editor. Try `code` (VS Code) first, then fall back to `$EDITOR`, then `nano`. Run via Bash: `${EDITOR:-$(command -v code 2>/dev/null || echo nano)} ~/.config/compound-engineering/reviewer-sources.yaml`. Re-read the file and present the list again.

Keep looping until the user chooses "Sync now".

## Step 3: Sync

Run the sync script:

```bash
bash "$PLUGIN_DIR/skills/refresh/sync-reviewers.sh" \
  "$PLUGIN_DIR/skills/ce-review/references/reviewer-registry.yaml" \
  "$PLUGIN_DIR/agents/review"
```

## Step 4: Show results

The script writes a summary to `~/.config/compound-engineering/last-refresh-summary.md`. Read that file and **output its contents to the user exactly as written**. The summary is already formatted as markdown — do not summarize, paraphrase, or reformat it. Just show it.

## Source YAML Format

```yaml
sources:
  - name: my-reviewers
    repo: username/repo-name
    branch: main
    path: .

  - name: community-reviewers
    repo: SomeOrg/ce-reviewers
    except:
      - kieran-python-reviewer
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | Label for this source |
| `repo` | yes | — | GitHub owner/repo |
| `branch` | no | `main` | Branch to fetch from |
| `path` | no | `.` | Directory in the repo containing .md files |
| `except` | no | `[]` | Reviewer filenames (without .md) to skip |

## Conflict Resolution

Sources listed first have higher priority. If two sources have a file with the same name, the first source's version is kept.

## Requirements

- `gh` CLI (preferred) or `git` for fetching
- `python3` for YAML parsing
