---
name: test-interaction
description: Test a specific user interaction flow in the browser via chrome-devtools MCP. Click buttons, fill inputs, verify state changes, and check for errors.
user_invocable: true
---

# Test Interaction

Test a specific user flow in the browser. The argument describes what to test (e.g., `/test-interaction upload demo file and start processing`).

## Steps

1. **Navigate** to the relevant page — `navigate_page` to `http://localhost:3000/drum-transcription` (or the page being tested).

2. **Clear console** — Note any pre-existing console errors via `list_console_messages` so you can distinguish new errors from old ones.

3. **Execute the interaction** described in the argument. Use the appropriate chrome-devtools tools:
   - `click` — Click buttons, links, or interactive elements (use CSS selectors or text content)
   - `fill` — Fill input fields
   - `type_text` — Type into focused elements
   - `press_key` — Press keyboard keys (for hotkey testing)
   - `upload_file` — Upload files to file inputs
   - `hover` — Hover over elements (for tooltips, previews)

4. **Wait for effects** — After each interaction, `wait_for` any expected state changes (loading indicators, new elements appearing, etc.).

5. **Screenshot after each step** — `take_screenshot` to verify the UI updated correctly. Describe what you see and whether it matches expectations.

6. **Check console after each step** — `list_console_messages` for any new errors triggered by the interaction. Report any errors immediately.

7. **Verify final state** — After the full flow completes:
   - Screenshot the final state
   - Check console is clean
   - Check network requests for failures
   - If OPFS was involved, optionally run `/check-opfs` to verify stored data

8. **Report** — Summarize:
   - Each step taken and its result
   - Screenshots assessment (expected vs actual)
   - Any console errors or warnings
   - Any network failures
   - Overall: PASS or FAIL with details
