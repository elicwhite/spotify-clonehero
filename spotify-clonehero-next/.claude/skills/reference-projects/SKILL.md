---
name: reference-projects
description: External repositories checked out beside this one that are the authoritative source for chart formats, game behavior, and ML models — YARG.Core, Moonscraper, GuitarGame_ChartFormats, SngFileFormat, ADTOF, demucs-next, drum-transcription, and sightkick. Use whenever you need to know how Clone Hero or YARG actually behaves, what a .chart/.mid/.sng file may contain, how a note or lyric is parsed, or how a model was trained — read the reference source rather than inferring behavior from observed output.
---

# Reference projects

These are checked out under `~/projects/`. When a question is about how the
games or the file formats _actually_ behave, read the source here rather than
inferring it from observed output — guessing at format or game behavior from
a few examples is how subtly wrong assumptions get baked in.

| Project                               | Use it for                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/projects/YARG.Core`                | YARG's own parsing and game behavior. `MoonSong`, plus vocal and lyric processing. The authority when Clone Hero and YARG might differ.    |
| `~/projects/Moonscraper-Chart-Editor` | Chart writing, highway editing UX, hotkeys, the undo/redo command pattern.                                                                 |
| `~/projects/GuitarGame_ChartFormats`  | The chart format spec — `.chart`, `.mid`, `.sng`, zip layout, audio file naming.                                                           |
| `~/projects/SngFileFormat`            | The `.sng` binary format spec plus a reference C# serializer.                                                                              |
| `~/projects/ADTOF`                    | The comparison drum transcription model (Frame_RNN). Exported to ONNX via tf2onnx.                                                         |
| `~/projects/demucs-next`              | Browser Demucs via ONNX + WebGPU. Reference for STFT/iSTFT, segmentation, and ONNX session management.                                     |
| `~/projects/drum-transcription`       | ML model README and training context for this project's own model.                                                                         |
| `~/projects/sightkick`                | Upstream for the sheet-music notation engine. The engine was ported here and has local extensions, so check both before changing notation. |

## Working with them

They are **read-only references**, not dependencies — nothing here imports from
them. Writes outside this project's directory fail under the sandbox anyway.

When behavior in this app has to match a game or a format, cite the reference
file in a code comment or commit message. A reader six months later needs to
know the behavior was copied deliberately rather than guessed.
