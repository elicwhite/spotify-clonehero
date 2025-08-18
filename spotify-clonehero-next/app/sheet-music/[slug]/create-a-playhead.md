Rendering an Accurate Playhead on VexFlow Sheet Music
Understanding the Challenge of Playhead Movement

When animating a playhead (a vertical cursor line) over sheet music, a key challenge is that the visual spacing of notes on the staff is not uniform with their timing. In traditional engraving (and VexFlow’s default formatting), notes with different durations may not occupy proportional horizontal space. For example, a measure of rapid 16th notes might be wider (or sometimes narrower) than a measure of whole notes, even if both measures represent the same total time. This means a playhead cannot simply sweep across the page at a constant rate – it would go out of sync with the audio. Instead, the playhead’s speed must vary (speed up through tightly spaced sections and slow down through sparse sections) to stay aligned with the music’s actual timing. The goal is to achieve a one-to-one mapping between the musical timeline and the notation positions so that “every moment in [the audio] corresponds to a distinct moment in the notation, and vice versa,” allowing the playhead to move linearly in time but correctly over the score
soundslice.com
. In other words, the distance the playhead travels on the SVG should correspond to the duration of the music being played at that moment.

Data Required for Synchronizing the Playhead

To render a smooth, accurate playhead in JavaScript, you will need to gather the following information:

Timing information for each musical event: You must know when each note (or beat or other time marker) occurs in real time (e.g. seconds or Web Audio API time). This can be derived from the score’s tempo and note durations or directly from a MIDI/audio timeline. For percussion notation, this means knowing the timestamp of each drum hit or rest duration. Essentially, you need the duration of each note (in seconds) and the cumulative time at each note’s onset.

Spatial position of each corresponding event in the SVG: You also need to know where each note is drawn on the SVG canvas – primarily the x-coordinate along the staff (and the y-coordinate if you might move the playhead across multiple lines/systems). VexFlow (and libraries built on it) provide ways to get these positions. For instance, every note in VexFlow is associated with a TickContext that determines its horizontal position. By iterating over the formatted notes, you can retrieve each note’s X position (e.g. via tickContext.getX() or StaveNote.getAbsoluteX()) and its Y position (e.g. via StaveNote.getYs() for the vertical staff line positions)
groups.google.com
. The Y coordinate may be useful if you have to draw the playhead line spanning the staff height or moving between multiple staves/lines. In short, you need a mapping of musical time → SVG coordinate for the entire piece.

Score layout structure: It helps to know the breaks between measures and systems. Often the playhead might reset to the next line at a line break or scroll the view. If your SVG is one continuous flow (very wide), you might scroll it horizontally. If it’s page-layout, you might jump the playhead to the next system (or handle the vertical movement). At minimum, know each measure’s start time and start X position (e.g. at the barline) and the end of the piece’s coordinate, so you can handle the playhead at end of lines. (Since you mentioned all percussion on one stave, we assume a single staff; multiple staves would complicate y-position logic, but the principle remains mapping time to the correct staff and x position.)

Tempo and synchronization with audio: If the tempo is constant, mapping time is straightforward. If there are tempo changes or rubato, you’d need those tempo changes to adjust the timing. In the context of the Web Audio API, you likely have a known schedule of note onsets (e.g. an array of times when each percussion hit sounds). If you’re generating the sound via the Web Audio API (perhaps scheduling Oscillator or Buffer nodes for each drum hit), you can record the scheduled times. If you use an external audio or MIDI file, you may need to pre-analyze it (e.g. using Web Audio’s timing events or a MIDI parser) to get a list of note event times. Essentially, the playhead’s motion is driven by the audio timeline, so you need the ability to query “current playback time” continuously (e.g. using AudioContext.currentTime or a high-resolution timer once playback starts).

Total duration (optional): Knowing the total duration of the piece can be useful for normalization or percentage, but not strictly necessary for the playhead itself except to know when to stop. Some libraries also compute total song duration from tempo and measures
lightrun.com
lightrun.com
, which can be a sanity check that your time mapping is correct.

In summary, the critical data is a list of time markers (in milliseconds or seconds) paired with the corresponding SVG positions (x-coordinates, and any needed y-coordinates or identifiers for staff line). Think of it as constructing a function f(t) = x that given the elapsed playback time t returns the horizontal position x for the playhead.

Implementing the Playhead Animation Logic

With the above data in hand, the task is to move a graphical line smoothly according to that time-position map. Here’s a step-by-step strategy:

Pre-compute a time-position map: Go through each note (or at least each beat or significant rhythmic division) in your score and record its start time (relative to the piece start) and its SVG X coordinate. For example, you might produce an array like positions = [{time: 0.0, x: 100}, {time: 0.5, x: 150}, {time: 1.0, x: 200}, ...] in seconds. This could be at the note level or even finer (for instance, you might include a point for the end of a measure if a long note sustains to the end). Include the last point at the end of the piece (total duration and the last note or barline x position) so the playhead knows where to end.

Attach an overlay playhead element: Typically, you do not redraw the entire sheet – instead you overlay a moving cursor. Since VexFlow renders to SVG, one easy way is to add an SVG <line> element or a absolutely-positioned HTML element on top of the SVG. Many implementations use a thin vertical line that spans the height of the staff. For instance, the open-source library alphaTab inserts a div with a class at-cursor-beat positioned at the current beat’s location
alphatab.net
, styled as a thin line (e.g. 2–3px width) with a semi-transparent highlight color. You can create a similar element and append it to the SVG or overlay it via CSS. Ensure it’s on top of the notes (higher z-index) and doesn’t interfere with the notation rendering.

Update the playhead position on each animation frame: Use requestAnimationFrame or a timed interval (e.g. 60 FPS update) to repeatedly update the playhead’s position based on the current playback time. The current playback time t can be obtained from the Web Audio API (for example, if you noted the audioContext.currentTime at the moment you started playback, you can compute offset). Using the time-position map, find the segment of the score in which t falls. For example, find two consecutive entries {time: t_i, x: x_i} and {time: t_j, x: x_j} such that t_i <= t < t_j. Then linearly interpolate: determine the fraction of time elapsed between those two known points and set the playhead’s x position accordingly. A simple linear interpolation formula would be:

let ratio = (t - t_i) / (t_j - t_i);
let currentX = x_i + ratio * (x_j - x_i);


This will smoothly move the playhead between known note positions. By iterating this each frame, the playhead will speed up or slow down over the SVG in direct proportion to the music’s tempo at that segment, eliminating jumps at note boundaries. If no interpolation is done (only moving at note onsets), the cursor tends to “jump” at each note, which is what we want to avoid. The interpolation ensures continuous motion.

Handle edge cases: If t is before the first note, you might keep the playhead at the start of the first note or hide it. If t is after the last note (song ended), you might place the playhead at the end or hide it. (Many implementations hide the cursor once playback is done or if there are long gaps, as it can look odd if a line just sits mid-air. For example, Soundslice allows hiding the playhead during silent sections
soundslice.com
.) Also, if your notation has line breaks, you might need to move the playhead vertically or handle scrolling. A simple method is to implement the playhead as a line that only covers the current system and then jump it to the next system when the time map indicates a new line. Libraries like OpenSheetMusicDisplay handle this by moving a highlight measure by measure in step; for a continuous line you’d ensure that when crossing a line break, you hide or reposition the playhead instantly to the next line’s start.

Sync with actual audio playback: Connect the updating logic to your Web Audio playback. You might start a requestAnimationFrame loop when playback begins and stop it when playback pauses or ends. Use high-resolution timing (the audio context’s time or performance.now()) to avoid drift. If using scheduled Web Audio events, you could also schedule CSS transitions instead of manual RAF – for instance, move the cursor from x_i to x_j by setting a CSS transform with a transition duration of (t_j - t_i) seconds. However, be cautious with many small transitions back-to-back, and ensure the easing is linear so the movement doesn’t ease in/out. Many developers find it simplest to just manually set the position each frame for precise control.

At this point, you will have a playhead that moves smoothly across the SVG in sync with the music. The key is the time→position map: without it, the playhead would have to assume uniform spacing (which, as we know, is incorrect). Indeed, developers on the VexFlow and OSMD forums have discussed the need for proportional spacing or such mappings. In VexFlow, one can bypass the normal formatter to enforce uniform spacing by manually setting TickContext positions, but it’s complex and usually not necessary if you can just map positions after formatting
groups.google.com
. A user of OSMD (which uses VexFlow under the hood) similarly asked for a way to “convert a timestamp to the respective x position of the sheet music staff” and to retrieve note coordinates from the rendered score
lightrun.com
 – which highlights that the solution is to compute that mapping yourself, since the library did not provide it out-of-the-box. By gathering the note positions and knowing their timings, you essentially create that mapping.

How Existing Tools Implement Playhead Sync

Both open-source and proprietary music software have tackled this problem, and their approaches align with the data-driven strategy described:

Open-Source Implementations

AlphaTab: The AlphaTab library (for rendering Guitar Pro/tab notation) includes built-in playback synchronization. It calculates precise timing for each beat and knows each beat’s position on the staff. During playback, it overlays a cursor. In fact, alphaTab uses two cursors: a bar cursor highlighting the current measure, and a beat cursor – a thin vertical line that tracks the current beat position
alphatab.net
alphatab.net
. The beat cursor is continuously animated to indicate progress through the beat. Under the hood, alphaTab’s data model ties each “beat” (rhythmic position in the measure) to a timestamp and a layout coordinate. As the audio plays, AlphaTab simply updates the cursor’s div position using that info. This confirms the need for the timing→position map: “Using the synchronization information embedded in the data model, alphaTab can then place the cursor correctly as an external media is taking over the audio.”
alphatab.net
. In practice, if you were using alphaTab’s API, you get this for free; when implementing it yourself with VexFlow, you are essentially reproducing this mechanism.

Example from alphaTab: The thin blue line (beat cursor) moves along the notation in real-time to indicate the current playback position. AlphaTab computes each beat’s timing and x-position, allowing the cursor to travel smoothly through the bar.

ABC.js: Another open source library, ABC.js, renders notation from ABC files and can synthesize audio. It provides callbacks for each note or beat during playback. The library’s author notes that “as the piece is playing, there are callbacks when the note changes”, and you can use a custom CursorControl to highlight notes or draw a cursor
paulrosen.github.io
. In the ABC.js synth demo, two techniques are shown: either highlight the current note or draw a moving line on the page
paulrosen.github.io
. The actual movement of the line is left to the implementer, but the library gives you the timing (each note event) and the association to a rendered note element. ABC.js can even identify the SVG element for the note being played, so one approach is to visually highlight that element; another is to move an independent line to that element’s position. For smooth motion, one would again interpolate between note events if needed. (Because folk tunes in ABC often have steady rhythms, some implementations simply jump from note to note, but the principle of needing time and position is the same.)

OpenSheetMusicDisplay (OSMD): OSMD uses VexFlow to render MusicXML. It has a built-in cursor feature primarily meant to highlight the current notes or measure (stepwise advancement per note). For continuous motion, OSMD doesn’t yet have an off-the-shelf solution, but it exposes the structured data needed. OSMD’s Cursor class can iterate through the score events, and each graphical note has an (x,y) position. Developers have extended it by calculating intermediate positions for smooth movement. For example, one user contributed utility functions to compute the total song duration from tempo and count of measures, to find which measure/note corresponds to a given time, and then to interpolate an exact x-coordinate
lightrun.com
lightrun.com
. This essentially mirrors the approach we described: get the sequence of notes, their timestamps (from the MusicXML timing), and their coordinates, then animate a line. The fact that OSMD now also has an AudioPlayer module suggests it maintains a timing map internally. Recent updates mention a function to start playback from a given millisecond timestamp
opensheetmusicdisplay.org
, which implies they convert that ms value to the nearest musical position – again confirming that they compute time-to-position mappings internally.

MuseScore (desktop software): As an open-source notation editor, MuseScore plays back scores and highlights the music as it plays. It typically places a light-blue cursor on the current measure or note. MuseScore’s engine knows every note’s timing from the score data and every note’s layout position from its engraving engine, so it simply updates the highlight to the note in progress. MuseScore’s UI actually jumps the highlight from note to note (it’s not a smoothly scrolling line, but a rapidly moving highlight that follows each note). However, because the playback is fast enough, it appears as a moving marker. If one were to adapt that to a continuous line, the same data (the sequence of note times and positions) would be used, just with interpolation for smoother motion.

In all these open-source cases, the core requirement is the same: synchronization data between the score and the audio. Either the library provides it (AlphaTab’s data model, ABC.js callbacks, OSMD’s cursor info), or you extract it (e.g. using VexFlow’s API to get note positions and using your known tempo to get note times). There is no magic – just careful mapping of time to X/Y coordinates.

Proprietary Tools and Techniques

Ultimate Guitar / Songsterr / Guitar Pro: These guitar tablature players (either in-browser like Songsterr or in apps like Guitar Pro) also implement a moving playhead or viewport. Typically, tab player apps will scroll the tablature or standard notation horizontally while a cursor indicates the current beat. Guitar Pro (a desktop app) scrolls the music in realtime, aligning the current beat under a stationary cursor, whereas Songsterr (web) moves a highlight bar across the screen. The implementation details aren’t published, but given these apps can also slow down or speed up playback, they certainly rely on the underlying MIDI timing of the notes and a layout map. Guitar Pro file formats explicitly store the timing of each note (in ticks) and when rendering the tab/notation, the software knows the x-position of each note group. Thus, they can map tick positions to pixel offsets. Songsterr’s web player likely uses a preprocessed JSON of the song that includes timing for each beat, and as the audio plays, it advances a vertical line. Users have observed that the playhead in these apps speeds up or slows down across sections, indicating a non-linear motion – exactly because it’s syncing to the rhythmic values.

Soundslice: Soundslice is a web-based interactive sheet music player. It allows syncing either synthesized audio or real recordings with sheet music. Soundslice’s approach to syncing real recordings involves setting syncpoints – essentially mapping specific moments in the audio (timestamps in the MP3/YouTube) to specific points in the notation (typically measure start positions)
soundslice.com
. With a series of syncpoints (e.g. each barline matched to a timestamp), Soundslice internally interpolates the position of the orange playhead line between those points during playback. This lets the playhead move smoothly even if the recording isn’t perfectly metronomic. In their documentation they note that with a complete transcription (one-to-one mapping of every note in the audio to notation), “the playhead moves consistently during playback, in a linear fashion.”
soundslice.com
 – which is the ideal scenario where timing and notation are fully aligned. Soundslice’s player is essentially doing the same thing we propose: given a current playback time, find the corresponding place in notation. The mention of the “orange vertical line that moves over notation during playback”
soundslice.com
 is exactly our playhead. For synthetic playback (MIDI) on Soundslice, the timing comes from the MIDI events; for real audio, the timing comes from those user-defined syncpoints. But in both cases, the cursor’s position is computed from a time→position map and updated continuously. Soundslice even allows cases where the playhead jumps or pauses (via non-sequential syncpoints) to accommodate tutorials, which again is handled by manipulating that mapping (e.g. temporarily not moving the line when there is a long pause in music, or hiding it)
soundslice.com
.

Tomplay: Tomplay is an app that provides interactive sheet music with audio accompaniments. It shows a cursor or highlighted measure that follows the music. While details aren’t public, it’s likely using the MusicXML/MIDI of the piece to know each note’s timing. Tomplay might scroll the sheet vertically (some implementations do vertical scrolling of notation) but still, the principle stands: they must calculate how far to scroll or where to put the highlight at each moment, based on the tempo map and layout. User experiences of Tomplay indicate the cursor is very smooth and always in sync, which suggests interpolation rather than jumping.

Noteflight (Web-based notation editor): Noteflight’s player highlights notes in orange as they are played. It doesn’t show a continuous bar, but the highlight jumps note-to-note. Internally, Noteflight has all note timings (since it uses MIDI for playback) and knows DOM coordinates for notes (since the notation is rendered in the browser). To highlight, it likely just finds the DOM element of the note at the current playback index and adds a highlight class. This is similar to what you could do with VexFlow: each note could be given an element ID, and then as you play, add a CSS class to the note to highlight it. To adapt to a moving bar, you would instead move a separate line element. The data needed is effectively the same, only the presentation differs.

In summary, every solution boils down to linking musical time with canvas position. Proprietary tools just have their own optimized data structures for this. The open-source tools demonstrate how you can achieve it with available libraries. For your implementation with VexFlow and the Web Audio API, you will be following the same fundamentals:

Extract or calculate note timing from your source (MIDI or known rhythm & tempo).

Extract note (or beat) positions from VexFlow’s output (e.g. via tick contexts or by tagging SVG elements).

Use JavaScript to update an SVG line or HTML element’s position in real time as the audio plays, interpolating between note positions so the motion is smooth.

By ensuring you have the precise timing for each note and the exact X coordinates of those notes on the SVG, you can synchronize the playhead perfectly. The playhead will naturally speed up in dense passages and slow down in sparse ones, because your time→position mapping will reflect shorter intervals between notes (but perhaps larger X distances) versus longer intervals (with maybe smaller X travel). This data-driven approach is exactly how existing interactive sheet music apps keep their cursors in sync with what you hear
soundslice.com
. Good luck with implementing it – once your playhead is using real musical timing, the result should look fluid and professional, much like in Ultimate Guitar’s or Soundslice’s players!