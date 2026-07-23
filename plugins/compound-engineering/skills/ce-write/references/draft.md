# Stage: draft

Write the piece. This is where the voice guide does its heaviest work — the draft should sound, read, and look like the author wrote it, not like a competent stranger did.

## Read first

- The brief at `brief:<path>` — audience, purpose, one job, thesis, medium.
- The outline at `outline:<path>` — the section order and per-section ideas.
- The **entire** voice guide. Every section applies now. The guide is the sole
  source of voice rules — do not rely on remembered rules from previous
  versions of this skill or from other drafts; the guide compounds and old
  rules get overturned.

## Pull the exemplars

Identify the piece's register band from the brief using the guide's register
section (expressive / analytical / formal / technical). If a `rotunda` MCP
connection is available, call `voice_exemplars` with that register and keep the
returned pairs in view while drafting: each pair shows the same content as a
competent generic model wrote it and as the author actually wrote it. **Write
like the author side of the pairs.** The pairs quote private documents — never
copy them into the draft or into public files; they are reference only.

Without the MCP connection, proceed on the guide alone and note the gap in the
run output.

## Draft against the guide, deliberately

Do not write generically and hope it lands. Write *toward* the guide: identify
the register band first and apply that band's rules, reach for the signature
moves where they fit (and only where they fit — the guide's anti-pattern list
names the manufactured versions), and honor the guide's rhythm and formatting
sections. Read each paragraph aloud in your head; if it drones, re-cut before
moving on.

The architecture matters more than the words. The measured failure mode of
model drafts is structural: sentences welded long, one-beat paragraphs merged
away, questions answered instead of left standing, transitions announced
("I bring this up because…") instead of made. Check the shape of what you
just wrote, not only its vocabulary.

## Procedure

1. Read brief, outline, the full voice guide, and the register's exemplars.
2. Write the complete draft — every section from the outline, no placeholders.
3. Self-pass against the guide's diction kill-list and anti-pattern section:
   cut the slop you can already see.
4. **Lint the architecture.** If the `rotunda` MCP connection is available,
   call `voice_lint` with the draft and the register. `pass` or `borderline`
   hands off; on `fail`, restructure toward the flagged metrics (sentence mix,
   paragraph pacing, questions, punctuation habits — not word swaps) and lint
   once more. Include the final verdict in the run output. Without the
   connection, skip and note it.
5. Write `draft.md`. This file is revised in place during the review loop, so
   write it as the working copy.

## Output: draft.md

The finished prose, in the target medium's format. No meta-commentary, no
"here is the draft" preamble — the file is the piece. Lead with the governing
idea on the first line.

## Voice-guide sections this stage leans on

All of them. This is the stage the whole guide exists for.
