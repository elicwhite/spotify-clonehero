Overall feedback: If there are any utilities or libraries needed by our new project within spotify-clonehero-next that already exist, those should be first pulled out into a shared lib and the original callsite should be updated. That should be done in its own commit, before used by our new code.

Use subagents to update these different specs:

For 0001:    
Just start with writing zips. Create a separate plan that's entirely focused on writing sng files. That plan ~/projects/SngFileFormat for how to do that.

Don't use zustand for this project. Simply use react state and context. See sheet-music for examples

For 0002: 
The data structures / types, where possible, should be imported and reused from scan-chart, which exports many. 

Add a note that any question not defined in the plan should match the behavior of moonscraper with a path reference to moonscraper; ~/projects/Moonscraper-Chart-Editor Most important though is for the data to round trip cleanly through scan-chart

You can also find the spec for the chart format files at ~/projects/GuitarGame_ChartFormats

For 0004: 
don't support a fallback if webgpu isn't available. The entire transcription tool should block access if webgpu isn't available.

Store all stems separately, don't merge them back into a no_drums.pcm 

You can also find the spec for the chart format files at ~/projects/GuitarGame_ChartFormats. You can find the names of the audio files supported in charts in that spec. 

Also include in the plan that any questions about how to make demucs work in the browser not covered in the plan should read the code at ~/projects/demucs-next

For 0005:
Our custom ML model isn't ready for this workload yet, so for now, use ADTOF; ~/projects/ADTOF

The code for how that does transcription is 

```
#@markdown Transcribe the audio
from adtof.model.model import Model

modelName = "Frame_RNN" #@param ["Frame_RNN"]
model, hparams = Model.modelFactory(modelName=modelName, scenario="adtofAll", fold=0)
print("peakThreshold", hparams["peakThreshold"])
model.predictFolder("in/*.mp3", "out", **hparams)

downloadTranscription = False #@param {type:"boolean"}
if downloadTranscription:
  files.download(scorePath) 
```

You'll need to convert that model to onnx

For 0006:
Take Approach A, remove Approach B from the plan

The npm package chart-preview does not have an AudioManager. The AudioManager is in our own project at lib/preview/audioManager.ts We want to use this for managing all audio. While we will be using just the drum stem for transcription, playback and the resulting chart will have all stems. 

While the human works on transcribing, they should have an option to hear/see just the drum track/waveform, or the entire song.

We'll need to make wavesurfer integrate with the audio manager for managing the audio. We shouldn't use chart-preview npm package for managing audio. Since chart-preview from npm isn't capable of what we need, for now let's stick with the chart preview in our project: app/sheet-music/[slug]/CloneHeroRenderer.tsx

For real time updates, you must not reprocess the audio. You can make this work with the CloneHeroRenderer in our project.

Remove all references to the chart-preview npm package from this plan

For 0007: 
Don't use zustand, just use regular React state and context

Don't duplicate code from convertToVexFlow or any other file, move those out to a shared library and update the original callsite to point to that before moving forward with this new page.

It should use audioManager directly, don't copy that file or its patterns

Update the tech stack section. Nothing here should be unique to the project. This is a route within our  NextJS app that uses yarn. 

All styling should be done with tailwind

Don't use the chart-preview npm package itself, reuse CloneHeroRenderer.tsx. Remove all references to the chart-preview npm package from this plan

Your lanes on the grid should match the exact same lanes as the SheetMusic component. You should likely be pulling that code out into a library so both callsites can be sharing that logic.

Instead of editing the transcription via the sheet music UI, we'll need to edit the transcription on the Clone Hero highway itself, just like Moonscraper does ~/projects/Moonscraper-Chart-Editor This is needed so that placed notes can be aligned perfectly to the audio. 

The background of the highway needs to render the waveform, just like Moonscraper. The wavesurfer waveform is just for seeking around, but we'll use the waveform on the highway to help us align notes. 

Add a new plan focused on how to make our highway support editing. That means we need to be able to select elements, move them, add them, and add toms or cymbals. Look at the Moonscraper code closely for how to accomplish this. Support all the same hotkeys as moonscraper.

Wavesurfer is not the primary audio source. AudioManager is the primary audio source.

Don't create your own DrumLaneGrid. Reuse SheetMusic

Just like moonscraper, we must have a way to create and edit BPM markers and time signatures.

Split this plan into multiple plans that can be implemented and tested incrementally.

For 0009:
Update the plan with a reference to these projects:

You can find the spec for the zip/sng formats at ~/projects/GuitarGame_ChartFormats, as well as a CLI tool with logic for how to create these files

You can also read the code for Moonscraper to see how it writes these files: 
~/projects/Moonscraper-Chart-Editor

