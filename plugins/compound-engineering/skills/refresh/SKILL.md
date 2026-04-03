---
name: ce:refresh
description: "Sync reviewer personas from external Git repos into the local plugin. Reads sources from reviewer-registry.yaml, fetches .md files, and places them in agents/review/. Use when setting up the plugin for the first time, after updating your reviewer repo, or to pull in new reviewer personas."
---

# Refresh Reviewers

Syncs reviewer persona files from external Git repositories into the plugin's `agents/review/` directory.

## Execution

Run the sync script:

```bash
bash plugins/compound-engineering/skills/refresh/sync-reviewers.sh \
  plugins/compound-engineering/skills/ce-review/references/reviewer-registry.yaml \
  plugins/compound-engineering/agents/review
```

The script handles everything: reading sources from the registry, fetching files via `gh` (with `git` fallback), filtering by `except` lists, resolving conflicts (first source wins), and reporting results.

## Source Configuration

Sources are defined in `reviewer-registry.yaml`:

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
      - kieran-typescript-reviewer
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
- `python3` or `yq` for YAML parsing
