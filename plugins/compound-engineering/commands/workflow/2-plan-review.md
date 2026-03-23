---
name: workflow:2-plan-review
description: Have multiple specialized agents review a plan in parallel
argument-hint: "[plan file path or plan content]"
---

# Plan Review

## Step 1: Analyze the Plan and Select Reviewers

Before launching reviewers, analyze the plan to determine which perspectives are most valuable. Read the plan file and classify the work.

**Available plan reviewers:**

| Agent | Perspective | Best for |
|-------|------------|----------|
| `@agent-2-plan-review-jason-fried` | Scope, simplicity, sustainability | All plans — always include |
| `@agent-2-plan-review-charles-eames` | Problem definition, systems thinking | Complex/interconnected changes, unclear problem statements |
| `@agent-2-plan-review-marty-cagan` | Validated learning, discovery | New features, user-facing changes, assumption-heavy plans |
| `@agent-2-plan-review-melissa-perri` | Outcomes over output, build trap | Roadmap items, feature requests, when "why" is unclear |
| `@agent-2-plan-review-sandy-speicher` | Human-centered design, inclusion | User-facing features, onboarding, multi-stakeholder systems |
| `@agent-2-plan-review-steve-frontend` | Frontend architecture, performance | Plans touching UI, JavaScript, CSS, Stimulus, Hotwire |
| `@agent-2-plan-review-avi-rails` | Rails architecture, ecosystem | Plans touching Rails models, services, gems, DB schema |
| `@agent-2-plan-review-greg-ai` | AI integration, LLM usage | Plans involving AI/LLM features, prompts, scoring, agents |

**Selection rules:**

1. **Always include Jason Fried** — scope and simplicity review applies to everything.
2. **Include Avi for any backend/Rails work** — models, services, jobs, migrations, gems.
3. **Include Steve for any frontend work** — views, Stimulus controllers, CSS, Hotwire.
4. **Include Greg for any AI/LLM work** — scoring, prompts, AI features, agent tools.
5. **Include Charles Eames when the problem is complex or multi-part** — systems with many interacting pieces.
6. **Include Marty Cagan when the plan is feature-driven** — new user-facing capabilities.
7. **Include Melissa Perri when the "why" is weak** — plans that list features without connecting to outcomes.
8. **Include Sandy Speicher when humans are directly affected** — UX changes, onboarding, notifications.
9. **Select 3-5 reviewers total.** More than 5 dilutes signal. Fewer than 3 misses perspectives.

## Step 2: Launch Selected Reviewers

Announce which reviewers you selected and why (one sentence each), then launch them in parallel.

Example:
> Running 4 plan reviewers:
> - **Jason Fried** — scope check (always)
> - **Avi** — heavy Rails service/model changes
> - **Greg** — AI scoring prompt design
> - **Charles Eames** — multi-plugin system with cross-cutting concerns
