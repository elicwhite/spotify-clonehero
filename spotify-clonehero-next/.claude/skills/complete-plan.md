---
name: complete-plan
description: Complete the current in-progress plan. Runs tests, validates in browser, moves plan to completed, and creates a git commit.
user_invocable: true
---

# Complete a Plan

Finalize the current in-progress plan with verification and a clean commit.

## Steps

1. **Identify the plan** — Find the plan file in `plans/in-progress/`. If none exists, stop and report that there's no plan in progress.

2. **Run tests** — Execute `yarn test` and verify all tests pass. If any tests fail, fix them before proceeding. Do not skip failing tests.

3. **Run linting** — Execute `yarn lint` and fix any issues.

4. **Run type checking** — Execute `npx tsc --noEmit` and fix any type errors.

5. **Validate in browser** — Run `/validate` to check the UI for console errors, network failures, and visual correctness. Fix any issues found.

6. **Review the plan's deliverables** — Re-read the plan and verify every deliverable mentioned has been completed:
   - All files listed in the plan exist
   - All test cases described in the plan have been implemented
   - All integration points mentioned work correctly

7. **Move the plan** — `mv plans/in-progress/{plan-file} plans/completed/{plan-file}`

8. **Create the commit** — Stage all relevant files and create a commit. The commit message should reference the plan number and briefly describe what was built. Include the plan file move in the commit.
