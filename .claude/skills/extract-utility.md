---
name: extract-utility
description: Extract existing code into a shared library location, update the original callsite, and commit separately. Use before reusing existing code in the drum transcription feature.
user_invocable: true
---

# Extract Shared Utility

Move existing code from a page-specific location into a shared `lib/` location so multiple pages can use it. This MUST be done in its own commit before the new code that depends on it.

The argument should describe what to extract (e.g., `/extract-utility tickToMs from chartUtils.ts`).

## Steps

1. **Identify the code to extract** — Find the function, type, or module that needs to be shared. Read the source file to understand its dependencies and exports.

2. **Choose the shared location** — Place it under `lib/` in an appropriate directory:
   - Drum note/instrument mapping → `lib/drum-mapping/`
   - Tick/time conversion → `lib/chart-utils/`
   - General chart types → use `@eliwhite/scan-chart` types directly if possible
   - Other utilities → `lib/{descriptive-name}/`

3. **Create the shared module** — Copy the code to the new location. Keep the same function signatures and types. Add any necessary imports.

4. **Update the original callsite** — Change the original file to import from the new shared location instead of defining it locally. Verify nothing broke by:
   - Running `yarn test`
   - Running `npx tsc --noEmit`
   - Checking the affected page still works (use `/validate` on the sheet-music page if that's where the code came from)

5. **Verify no other consumers exist** — Search the codebase for other files that import or duplicate the same code. Update them too.

6. **Commit this extraction separately** — Create a commit with just the extraction and callsite updates. The message should be: "refactor: extract {utility name} to lib/{path} for sharing"

7. **Report** — Confirm the extraction is complete and ready for the drum transcription code to import from the new location.

## Important

- Do NOT include any new drum transcription code in this commit
- Do NOT change behavior — this is a pure move/refactor
- Do verify the original page still works after the extraction
