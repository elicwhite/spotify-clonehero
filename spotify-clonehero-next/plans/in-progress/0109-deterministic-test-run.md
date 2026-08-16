# 0109 — Make a full `pnpm test` run deterministic

Status: in-progress

A full `pnpm test` run failed intermittently. Three unrelated suites each
failed once and passed when run alone, and the collected test count moved
between runs (4148 against 4153).

## What the failures were

Two separate causes, neither of them shared state between test files.

### 1. A V8 garbage-collector crash in Jest workers (the reported symptom)

A worker died with `SIGSEGV`, and Jest reported the suite that worker held as
"Test suite failed to run". The victim is whichever suite the dead worker was
holding, so it is unrelated to the crash and passes alone. Its tests are never
collected, which is why the total moved.

macOS recorded the crash. Every report has the same stack:

```
v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers
v8::internal::InternalFrame::Iterate
v8::internal::Isolate::Iterate
v8::internal::Heap::IterateRoots
v8::internal::MarkCompactCollector::MarkRoots
```

`EXC_BAD_ACCESS at 0xe`, with no application frames and no native addon. This
is a defect in the Node runtime, not in this repository.

Tightening the heap forces continuous major collections and reproduces it:

```bash
NODE_OPTIONS=--max-old-space-size=200 npx jest
```

On Node 24.11.1 that crashed on 3 runs of 3, with 2 to 6 dead workers each and
random victims.

**This one is still open.** Nothing tried so far fixes it:

- **Node 24.19.0 does not fix it.** It crashed with the same stack on run 12 of
  12. The reproducer looked clean on 24.19.0 only because a 200 MB cap makes
  that version exhaust its heap and lose workers to `SIGTERM` first, which
  hides the crash. At 400 MB, where neither version runs out of heap, neither
  version crashes either, so the reproducer cannot tell the two apart. Telling
  them apart needs ~50 plain runs per version, because the rate is about 1 in
  12 to 1 in 30.
- **V8 flag workarounds.** `--no-conservative-stack-scanning` and
  `--no-concurrent-marking` both still crashed.

Ruled out as causes:

- **A memory leak across test files.** Under `--expose-gc`, a serial run holds
  a flat ~270 MB across all 391 files. The ~1.7 GB that `--logHeapUsage` shows
  on its own is uncollected garbage, not retained state.
- **Shared state between test files.** 15 full runs on `main` and 12 in a copy
  of `HEAD` were all clean at one collected count.

Next step: a Node major with a different V8 (22 LTS), measured over enough runs
to beat the base rate.

### 2. An aborted pipeline run that still creates a project

Separate from the crash, and found with `jest --randomize`.

`lib/drum-transcription/pipeline/runner.ts` checked its abort signal before
decoding audio and again after storing it, but created the project between
those two checks with no check of its own. An aborted run therefore still
created a project and wrote its audio.

`useAssistRunner` aborts the active run when the page unmounts, so in tests the
orphan project arrives during a *later* test, after that test has reset the
storage double. In
`app/drum-transcription/__tests__/drum-transcription-home.test.tsx`, "names the
stages it shares with a resumed run identically" starts a run and asserts only
on labels, so its run is still going when the test ends. When the randomized
order puts it before "keeps a failed run on screen with a retry that resumes
its project", that test reads `[...__projects.keys()][0]` and gets the orphan
instead of its own project.

For a user, the same gap leaves a junk project in OPFS after cancelling during
the decode step.

## Work

1. Done — check the abort signal in `runner.ts` after the decode await, before
   the project is created, with a regression test in `decoded-onsets.test.ts`.
2. Open — the worker crash. See above.

## Verification

Of the abort fix:

- The regression test fails against the unfixed runner and passes against the
  fixed one.
- 25 randomized runs of `drum-transcription-home.test.tsx`, which used to fail
  about 1 in 10, all clean.
- 11 consecutive full runs at a stable 4157, with a 12th lost to the worker
  crash above.
- `pnpm typecheck` and `pnpm lint` at exit 0.
