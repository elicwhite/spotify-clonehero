---
name: validate
description: Validate current UI changes in the browser via chrome-devtools MCP. Screenshots the page, checks for console errors and network failures, and reports issues.
user_invocable: true
---

# Browser Validation

Run a full browser validation check on the current state of the app. Use after every meaningful UI change.

## Steps

1. **Navigate** to the page being worked on. If an argument is provided (e.g., `/validate /drum-transcription`), navigate to `http://localhost:3000{arg}`. Otherwise navigate to `http://localhost:3000/drum-transcription`.

2. **Wait for page load** — use `wait_for` to ensure the page has rendered (wait for a key element like `main` or a specific component).

3. **Take a screenshot** — capture the current state with `take_screenshot`. Examine it to verify:
   - The page renders without a blank screen
   - Layout looks correct (no overlapping elements, broken grids)
   - Expected UI elements are visible
   - No visual glitches

4. **Check console for errors** — use `list_console_messages`. Look for:
   - React errors (hydration mismatches, hook violations, missing keys)
   - Runtime exceptions (TypeError, ReferenceError, etc.)
   - Failed module imports
   - CORS errors
   - WebGPU/AudioContext warnings
   - Report ALL errors and warnings found. Do not ignore any.

5. **Check network requests** — use `list_network_requests`. Look for:
   - 404 Not Found (missing assets, wrong import paths)
   - CORS blocks
   - Failed fetches (ONNX models, audio files)
   - Excessive or unexpected requests

6. **Report** — Summarize findings:
   - Screenshot assessment (looks correct / has issues)
   - Console errors (count and details)
   - Network failures (count and details)
   - If any issues found, fix them before continuing with other work
