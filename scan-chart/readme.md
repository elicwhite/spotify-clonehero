This is a fork of https://github.com/Geomitron/scan-chart to work with Web APIs instead of local `fs` calls. Ideally we'll upstream changes to be able to reuse.

This package scans charts for rhythm games like Clone Hero and produces useful metadata about them.

# API

```ts
/**
 * Scans the charts in the `chartsFolder` directory and returns an event emitter that emits the results.
 */
function scanCharts(chartsFolder: string, config?: ScanChartsConfig): ScanChartsResult

interface ScanChartsConfig {
	/** Ignore scanning all charts except ones found in .sng files. Defaults to `false`. */
	onlyScanSng?: boolean
}

interface ScanChartsResult {
	/**
	 * Registers `listener` to be called when a chart folder has been found.
	 * The name of the chart folder is passed to `listener`. No `chart` events are emitted before this.
	 */
	on(event: 'folder', listener: (folderName: string) => void): void
	/**
	 * Registers `listener` to be called when a chart has been scanned.
	 * The `ScannedChart` is passed to `listener`, along with the index of this chart and the total number of charts to be scanned.
	 * No `folder` events are emitted after this.
	 */
	on(event: 'chart', listener: (chart: ScannedChart, index: number, count: number) => void): void

	/**
	 * Registers `listener` to be called if the filesystem failed to read a file. If this is called, the "end" event won't happen.
	 */
	on(event: 'error', listener: (err: Error) => void): void

	/**
	 * Registers `listener` to be called when all charts in `chartsFolder` have been scanned.
	 * The `ScannedChart[]` is passed to `listener`.
	 * If this is called, the "error" event won't happen.
	 */
	on(event: 'end', listener: (charts: ScannedChart[]) => void): void
}

interface ScannedChart {
	/** Data scanned from the chart. */
	chart: Chart
	/**
	 * The relative path from `chartsFolder` to the folder containing the chart file(s).
	 *
	 * Doesn't contain `chartsFolder`, the .sng filename (if any), or leading/trailing slashes.
	 */
	chartPath: string
	/** The name of the .sng file. `null` if the chart is not in the .sng format. */
	chartFileName: string | null
}

interface Chart {
	/** An MD5 hash of the names and binary contents of every file in the chart. */
	md5: string
	/** An MD5 hash of just the chart file. If this changes, the score is reset. */
	chartMd5: string
	/** If the chart is able to be played in-game. This is `false` if `notesData` is `undefined`. */
	playable: boolean

	/** The song name. */
	name?: string
	/** The song artist. */
	artist?: string
	/** The song album. */
	album?: string
	/** The song genre. */
	genre?: string
	/** The song year. */
	year?: string
	/** The chart's charter(s). */
	charter?: string
	/** The length of the chart's audio, in milliseconds. If there are stems, this is the length of the longest stem. */
	song_length?: number
	/** The difficulty rating of the chart as a whole. Usually an integer between 0 and 6 (inclusive) */
	diff_band?: number
	/** The difficulty rating of the lead guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_guitar?: number
	/** The difficulty rating of the co-op guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_guitar_coop?: number
	/** The difficulty rating of the rhythm guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_rhythm?: number
	/** The difficulty rating of the bass guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_bass?: number
	/** The difficulty rating of the drums chart. Usually an integer between 0 and 6 (inclusive) */
	diff_drums?: number
	/** The difficulty rating of the Phase Shift "real drums" chart. Usually an integer between 0 and 6 (inclusive) */
	diff_drums_real?: number
	/** The difficulty rating of the keys chart. Usually an integer between 0 and 6 (inclusive) */
	diff_keys?: number
	/** The difficulty rating of the GHL (6-fret) lead guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_guitarghl?: number
	/** The difficulty rating of the GHL (6-fret) co-op guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_guitar_coop_ghl?: number
	/** The difficulty rating of the GHL (6-fret) rhythm guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_rhythm_ghl?: number
	/** The difficulty rating of the GHL (6-fret) bass guitar chart. Usually an integer between 0 and 6 (inclusive) */
	diff_bassghl?: number
	/** The difficulty rating of the vocals chart. Usually an integer between 0 and 6 (inclusive) */
	diff_vocals?: number
	/** The number of milliseconds into the song where the chart's audio preview should start playing. */
	preview_start_time?: number
	/** The name of the icon to be displayed on the chart. Usually represents a charter or setlist. */
	icon?: string
	/** A text phrase that will be displayed before the chart begins. */
	loading_phrase?: string
	/** The ordinal position of the song on the album. This is `undefined` if it's not on an album. */
	album_track?: number
	/** The ordinal position of the chart in its setlist. This is `undefined` if it's not on a setlist. */
	playlist_track?: number
	/** `true` if the chart is a modchart. This only affects how the chart is filtered and displayed, and doesn't impact gameplay. */
	modchart?: boolean
	/** The amount of time the game should delay the start of the track in milliseconds. */
	delay?: number
	/** The amount of time the game should delay the start of the track in seconds. */
	chart_offset?: number
	/** Overrides the default HOPO threshold with a specified value in ticks. Only applies to .mid charts. */
	hopo_frequency?: number
	/** Sets the HOPO threshold to be a 1/8th step. Only applies to .mid charts. */
	eighthnote_hopo?: boolean
	/** Overrides the .mid note number for Star Power on 5-Fret Guitar. Valid values are 103 and 116. Only applies to .mid charts. */
	multiplier_note?: number
	/**
	 * The amount of time that should be skipped from the beginning of the video background in milliseconds.
	 * A negative value will delay the start of the video by that many milliseconds.
	 */
	video_start_time?: number
	/** `true` if the "drums" track should be interpreted as 5-lane drums. */
	five_lane_drums?: boolean
	/** `true` if the "drums" track should be interpreted as 4-lane pro drums. */
	pro_drums?: boolean
	/** `true` if the chart's end events should be used to end the chart early. Only applies to .mid charts. */
	end_events?: boolean

	/** The chart's album art. */
	albumArt?: AlbumArt
	/** Data describing properties of the .chart or .mid file. `undefined` if the .chart or .mid file couldn't be parsed. */
	notesData?: NotesData
	/** Issues with the chart files. */
	folderIssues: { folderIssue: FolderIssueType; description: string }[]
	/** Issues with the chart's metadata. */
	metadataIssues: MetadataIssueType[]
	/** `true` if the chart has a video background. */
	hasVideoBackground: boolean
}

interface AlbumArt {
	/** The binary buffer of the album art image, in the .jpg format (quality 75%), resized to 512x512. */
	data: Uint8Array
	/** The MD5 hash of `data`. */
	md5: string
}

interface NotesData {
	/** The list of instruments that contain more than zero track events. */
	instruments: Instrument[]
	/** If a solo section event occurs in any track. */
	hasSoloSections: boolean
	/** If the chart contains any lyric events. */
	hasLyrics: boolean
	/** If the chart contains a "vocals" track. */
	hasVocals: boolean
	/** If a forced note event occurs in any track. */
	hasForcedNotes: boolean
	/** If a tap note event occurs in any track. */
	hasTapNotes: boolean
	/** If an open note event occurs in any track. */
	hasOpenNotes: boolean
	/** If a 2xKick event occurs in any "drums" track. */
	has2xKick: boolean
	/** If a single or double roll lane event occurs in any "drums" track. */
	hasRollLanes: boolean
	/** Issues with individual notes in the chart. */
	noteIssues: {
		instrument: Instrument
		difficulty: Difficulty
		noteIssues: NoteIssue[]
	}[]
	/** Issues with specific tracks in the chart. */
	trackIssues: {
		instrument: Instrument
		difficulty: Difficulty
		trackIssues: TrackIssueType[]
	}[]
	/** Issues with the overall chart. */
	chartIssues: ChartIssueType[]
	/** The number of individual notes in the chart. Does not include star power, solo markers, or ativation lanes. */
	noteCounts: {
		instrument: Instrument
		difficulty: Difficulty
		count: number
	}[]
	/** The one-second region in each track where the notes-per-second is highest. */
	maxNps: {
		instrument: Instrument
		difficulty: Difficulty
		/** Time of the end of the high NPS region in milliseconds. Rounded to 3 decimal places. */
		time: number
		/** The notes-per-second in this region. Equivalent to `notes.length`. */
		nps: number
		/** The notes in the high NPS region, sorted by `TrackEvent.time` in ascending order. */
		notes: TrackEvent[]
	}[]
	/** MD5 hashes of each track. This only accounts for events in `EventType`. */
	hashes: {
		instrument: Instrument
		difficulty: Difficulty
		hash: string
	}[]
	/** MD5 hash of the chart's tempo map, including BPM markers and time signature markers. */
	tempoMapHash: string
	/** The number of BPM markers in the chart. */
	tempoMarkerCount: number
	/**
	 * The amount of time between the start of the chart and the last note in milliseconds. Rounded to 3 decimal places.
	 * If there are multiple tracks, the last note is the latest last note across all the tracks.
	 */
	length: number
	/**
	 * The amount of time between the chart's first and last notes in milliseconds. Rounded to 3 decimal places.
	 * If there are multiple tracks, the first note is the earliest first note across all the tracks,
	 * and the last note is the latest last note across all the tracks.
	 */
	effectiveLength: number
}

type Instrument =
	'guitar' |        // Lead Guitar
	'guitarcoop' |    // Co-op Guitar
	'rhythm' |        // Rhythm Guitar
	'bass' |          // Bass Guitar
	'drums' |         // Drums
	'keys' |          // Keys
	'guitarghl' |     // GHL (6-fret) Lead Guitar
	'guitarcoopghl' | // GHL (6-fret) Co-op Guitar
	'rhythmghl' |     // GHL (6-fret) Rhythm Guitar
	'bassghl'         // GHL (6-fret) Bass Guitar

type Difficulty =
	'expert' |
	'hard' |
	'medium' |
	'easy'

interface NoteIssue {
	issueType: NoteIssueType
	/** Time of the issue in milliseconds. Rounded to 3 decimal places. */
	time: number
}

type NoteIssueType =
	'fiveNoteChord' |           // This is a five-note chord
	'difficultyForbiddenNote' | // This is a note that isn't allowed on the track's difficulty
	'threeNoteDrumChord' |      // This is a three-note chord on the "drums" instrument
	'brokenNote' |              // This note is so close to the previous note that this was likely a charting mistake
	'badSustainGap' |           // This note is not far enough ahead of the previous sustain
	'babySustain'               // The sustain on this note is too short

type TrackIssueType =
	'noStarPower' |           // This track has no star power
	'noDrumActivationLanes' | // This drums track has no activation lanes
	'smallLeadingSilence' |   // This track has a note that is less than 2000ms after the start of the track
	'noNotesOnNonemptyTrack'  // This track has star power, solo markers, or drum lanes, but no notes

type ChartIssueType =
	'noResolution' |             // This chart has no resolution
	'noSyncTrackSection' |       // This chart has no tempo map information
	'noNotes' |                  // This chart has no notes
	'noExpert' |                 // One of this chart's instruments has Easy, Medium, or Hard charted but not Expert
	'isDefaultBPM' |             // This chart has only one 120 BPM marker and only one 4/4 time signature
	'misalignedTimeSignatures' | // This chart has a time signature marker that doesn't appear at the start of a measure
	'noSections'                 // This chart has no sections

interface TrackEvent {
	/** Time of the event in milliseconds. Rounded to 3 decimal places. */
	time: number
	/** Length of the event in milliseconds. Rounded to 3 decimal places. Some events have a length of zero. */
	length: number
	type: EventType
}

type EventType =
	// 5 fret
	'starPower' |
	'tap' |
	'force' |
	'orange' |
	'blue' |
	'yellow' |
	'red' |
	'green' |
	'open' |
	'soloMarker' |

	// 6 fret
	'black3' |
	'black2' |
	'black1' |
	'white3' |
	'white2' |
	'white1' |

	// Drums
	'activationLane' |
	'kick' |
	'kick2x' |
	'rollLaneSingle' |
	'rollLaneDouble'

type FolderIssueType =
	'noMetadata' |       // This chart doesn't have "song.ini"
	'invalidIni' |       // .ini file is not named "song.ini"
	'invalidMetadata' |  // "song.ini" doesn't have a "[Song]" section
	'badIniLine' |       // This line in "song.ini" couldn't be parsed
	'multipleIniFiles' | // This chart has multiple .ini files
	'noAlbumArt' |       // This chart doesn't have album art
	'albumArtSize' |     // This chart's album art is not 500x500 or 512x512
	'badAlbumArt' |      // This chart's album art couldn't be parsed
	'multipleAlbumArt' | // This chart has multiple album art files
	'noAudio' |          // This chart doesn't have an audio file
	'invalidAudio' |     // Audio file is not a valid audio stem name
	'badAudio' |         // This chart's audio couldn't be parsed
	'multipleAudio' |    // This chart has multiple audio files of the same stem
	'noChart' |          // This chart doesn't have "notes.chart"/"notes.mid"
	'invalidChart' |     // .chart/.mid file is not named "notes.chart"/"notes.mid"
	'badChart' |         // This chart's .chart/.mid file couldn't be parsed
	'multipleChart' |    // This chart has multiple .chart/.mid files
	'badVideo' |         // This chart has a video background that will not work on Linux
	'multipleVideo'      // This chart has multiple video background files

type MetadataIssueType =
	'noName' |                // Metadata is missing the "name" property
	'noArtist' |              // Metadata is missing the "artist" property
	'noAlbum' |               // Metadata is missing the "album" property
	'noGenre' |               // Metadata is missing the "genre" property
	'noYear' |                // Metadata is missing the "year" property
	'noCharter' |             // Metadata is missing the "charter" property
	'missingInstrumentDiff' | // Metadata is missing a "diff_" property
	'extraInstrumentDiff' |   // Metadata contains a "diff_" property for an uncharted instrument
	'nonzeroDelay' |          // Metadata contains a "delay" property that is not zero
	'nonzeroOffset'           // Chart file contains an "Offset" property that is not zero
```
