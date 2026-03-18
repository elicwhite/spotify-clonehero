---
name: claim-plan
description: Claim a plan from plans/todo/ by moving it to plans/in-progress/, read it, and prepare to execute it.
user_invocable: true
---

# Claim a Plan

Start working on a plan by claiming it.

## Steps

1. **Identify the plan** — If an argument is provided (e.g., `/claim-plan 0002`), use that plan number. Otherwise, look at `plans/todo/` and identify the next plan whose dependencies are all in `plans/completed/`.

2. **Check prerequisites** — Verify all dependency plans listed in the plan's header are in `plans/completed/`. If any are still in `todo/` or `in-progress/`, stop and report which dependencies are missing.

3. **Check for conflicts** — Verify `plans/in-progress/` is empty. Only one plan should be in-progress at a time. If another plan is already in-progress, stop and report it.

4. **Move the plan** — `mv plans/todo/{plan-file} plans/in-progress/{plan-file}`

5. **Read the full plan** — Read the entire plan file from `plans/in-progress/`. Understand every section.

6. **Check for shared utility extractions** — If the plan mentions extracting existing code to shared libraries, those extractions must happen first in their own commit before writing new code.

7. **Report** — Summarize:
   - Plan name and description
   - Key deliverables
   - Files that will be created or modified
   - Any shared utility extractions needed first
   - Suggested implementation order from the plan
