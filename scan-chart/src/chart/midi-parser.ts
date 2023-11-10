import { createHash } from 'crypto'
import * as _ from 'lodash'
import { EVENT_DIVSYSEX, EVENT_META, EVENT_META_END_OF_TRACK, EVENT_META_LYRICS, EVENT_META_SET_TEMPO, EVENT_META_TEXT, EVENT_META_TIME_SIGNATURE, EVENT_META_TRACK_NAME, EVENT_MIDI, EVENT_MIDI_NOTE_ON, EVENT_SYSEX, MIDIEvent } from 'midievents'
import MIDIFile from 'midifile'

import { Difficulty, EventType, Instrument, NotesData, TrackEvent } from '../interfaces'
import { TrackParser } from './track-parser'

/* eslint-disable @typescript-eslint/naming-convention */
type TrackName = InstrumentName | 'PART VOCALS' | 'EVENTS'
type InstrumentName = keyof typeof instrumentNameMap
const instrumentNameMap = {
	'PART GUITAR': 'guitar',
	'PART RHYTHM': 'rhythm',
	'PART BASS': 'bass',
	'PART DRUMS': 'drums',
	'PART KEYS': 'keys',
	'PART GUITAR GHL': 'guitarghl',
	'PART GUITAR COOP GHL': 'guitarcoopghl',
	'PART RHYTHM GHL': 'rhythmghl',
	'PART BASS GHL': 'bassghl',
} as const
/* eslint-enable @typescript-eslint/naming-convention */

const sysExDifficultyMap = ['easy', 'medium', 'hard', 'expert'] as const
const fiveFretDiffStarts = { easy: 59, medium: 71, hard: 83, expert: 95 }
const sixFretDiffStarts = { easy: 58, medium: 70, hard: 82, expert: 94 }
const drumsDiffStarts = { easy: 60, medium: 72, hard: 84, expert: 96 }

interface TrackEventEnd {
	difficulty: Difficulty | null
	time: number
	type: EventType | null
	isStart: boolean
}
interface TrackEventDiff extends TrackEvent {
	difficulty: Difficulty | null
}

class MidiParser {
	private notesData: NotesData
	private tempoMap: MIDIEvent[] = []
	private timeSignatures: MIDIEvent[] = []
	private tracks: { trackIndex: number; trackName: TrackName; trackEvents: MIDIEvent[] }[]
	private splitTracks: { instrument: Instrument; difficulty: Difficulty; trackEvents: TrackEvent[] }[]

	constructor(midiFile: MIDIFile) {
		this.notesData = {
			instruments: [],
			hasSoloSections: false,
			hasLyrics: false,
			hasVocals: false,
			hasForcedNotes: false,
			hasTapNotes: false,
			hasOpenNotes: false,
			has2xKick: false,
			hasRollLanes: false,
			noteIssues: [],
			trackIssues: [],
			chartIssues: [],
			noteCounts: [],
			maxNps: [],
			hashes: [],
			tempoMapHash: '',
			tempoMarkerCount: 0,
			length: 0,
			effectiveLength: 0,
		}

		const trackNameEvents: MIDIEvent[] = []
		const trackEvents: MIDIEvent[][] = []

		const allEvents = midiFile.getEvents()
		for (const midiEvent of allEvents) {
			midiEvent.playTime = _.round(midiEvent.playTime ?? -1, 3)

			switch (midiEvent.type) {
				case EVENT_META: {
					switch (midiEvent.subtype) {
						case EVENT_META_TRACK_NAME: trackNameEvents.push(midiEvent); break
						case EVENT_META_SET_TEMPO: this.tempoMap.push(midiEvent); break
						case EVENT_META_TIME_SIGNATURE: this.timeSignatures.push(midiEvent); break
						case EVENT_META_LYRICS: break // Ignored
						case EVENT_META_END_OF_TRACK: break // Ignored
						case EVENT_META_TEXT: {
							(trackEvents[midiEvent.track!] ??= []).push(midiEvent)
							break
						}
					}
					break
				}
				case EVENT_SYSEX:
				case EVENT_DIVSYSEX: {
					(trackEvents[midiEvent.track!] ??= []).push(midiEvent)
					break
				}
				case EVENT_MIDI: {
					(trackEvents[midiEvent.track!] ??= []).push(midiEvent)
					break
				}
			}
		}

		if (this.tempoMap.length === 0) {
			this.tracks = []
			this.splitTracks = []
			this.notesData.chartIssues.push('noSyncTrackSection')
			return
		}

		this.tracks = trackNameEvents.map(event => ({
			trackIndex: event.track!,
			trackName: event.data.map(dta => String.fromCharCode(dta)).join('').trim() as TrackName,
			trackEvents: trackEvents[event.track!],
		}))

		this.splitTracks = _.chain(this.tracks)
			.filter(t => _.keys(instrumentNameMap).includes(t.trackName))
			.map(t => {
				const instrument = instrumentNameMap[t.trackName as InstrumentName]
				const trackEventGroups = _.chain(t.trackEvents)
					.map(te => this.getTrackEventEnds(te, instrument))
					.filter(te => te.type !== null) // Discard unknown event types
					.thru(te => this.applyAndRemoveOpenAndTapModifiers(te))
					.groupBy(te => te.difficulty) // Instrument-wide events have a difficulty of `null`. `groupBy` sets this to 'null'
					.toPairs()
					.map(([difficulty, te]) => [difficulty, this.getTrackEvents(te)] as const)
					.value()
				const instrumentEvents = _.remove(trackEventGroups, g => g[0] === 'null')[0]?.[1] ?? [] // Pull out instrument-wide events
				trackEventGroups.forEach(g => g[1].push(...instrumentEvents)) // ... and add each one to all difficulties

				return trackEventGroups.map(g => ({
					instrument,
					difficulty: g[0] as Difficulty,
					trackEvents: g[1].map(te => _.omit(te, 'difficulty')),
				}))
			})
			.flatMap()
			.value()

		this.applyEventLengthFix()
	}

	private getTrackEventEnds(event: MIDIEvent, instrument: Instrument): TrackEventEnd {
		// SysEx event (tap modifier or open)
		const eventData = event.data?.map(dta => String.fromCharCode(dta)) ?? []
		if (event.type === EVENT_SYSEX || event.type === EVENT_DIVSYSEX) {
			if (eventData[0] === 'P' && eventData[1] === 'S' && eventData[2] === '\0' && event.data[3] === 0x00) {
				// Phase Shift SysEx event
				return {
					difficulty: sysExDifficultyMap[event.data[4]],
					time: event.playTime!,
					type: event.data[5] === 0x01 ? EventType.open : event.data[5] === 0x04 ? EventType.tap : null,
					isStart: event.data[6] === 0x01,
				}
			}
		}

		const note = event.param1!
		const difficulty = note <= 66 ? 'easy' : note <= 78 ? 'medium' : note <= 90 ? 'hard' : note <= 102 ? 'expert' : null
		// Instrument event (solo marker, star power, activation lane, roll lane) (applies to all difficulties)
		if (!difficulty) {
			return {
				difficulty,
				time: event.playTime!,
				type: note === 103 ? EventType.soloMarker
					: note === 116 ? EventType.starPower
						: note >= 120 && note <= 124 ? EventType.activationLane
							: note === 126 ? EventType.rollLaneSingle
								: note === 127 ? EventType.rollLaneDouble
									: null,
				isStart: event.subtype === EVENT_MIDI_NOTE_ON,
			}
		}

		return {
			difficulty,
			time: event.playTime!,
			type: (['guitarghl', 'guitarcoopghl', 'rhythmghl', 'bassghl'].includes(instrument) ? this.get6FretNoteType(note, difficulty) :
				instrument === 'drums' ? this.getDrumsNoteType(note, difficulty) : this.get5FretNoteType(note, difficulty)) ?? null,
			isStart: event.subtype === EVENT_MIDI_NOTE_ON,
		}
	}

	private get5FretNoteType(note: number, difficulty: Difficulty) {
		switch (note - fiveFretDiffStarts[difficulty]) {
			case 1: return EventType.green
			case 2: return EventType.red
			case 3: return EventType.yellow
			case 4: return EventType.blue
			case 5: return EventType.orange
			case 6: return EventType.force // Force HOPO
			case 7: return EventType.force // Force strum
		}
	}

	private get6FretNoteType(note: number, difficulty: Difficulty) {
		switch (note - sixFretDiffStarts[difficulty]) {
			case 0: return EventType.open
			case 1: return EventType.white1
			case 2: return EventType.white2
			case 3: return EventType.white3
			case 4: return EventType.black1
			case 5: return EventType.black2
			case 6: return EventType.black3
			case 7: return EventType.force // Force HOPO
			case 8: return EventType.force // Force strum
		}
	}

	private getDrumsNoteType(note: number, difficulty: Difficulty) {
		switch (note - drumsDiffStarts[difficulty]) {
			case -1: return EventType.kick2x
			case 0: return EventType.kick
			case 1: return EventType.red
			case 2: return EventType.yellow
			case 3: return EventType.blue
			case 4: return EventType.orange
			case 5: return EventType.green
		}
	}

	/** Any note that begins during an open/tap SYSEX event is converted to an open/tap. */
	private applyAndRemoveOpenAndTapModifiers(trackEventEnds: TrackEventEnd[]) {
		const reducedTrackEventEnds: TrackEventEnd[] = []

		let [openEnabled, tapEnabled] = [false, false]
		for (const trackEventEnd of _.sortBy(trackEventEnds, te => te.time)) {
			switch (trackEventEnd.type) {
				case EventType.open: openEnabled = trackEventEnd.isStart; continue
				case EventType.tap: tapEnabled = trackEventEnd.isStart; continue
				case EventType.starPower: break
				case EventType.soloMarker: break
				case EventType.activationLane: break
				case EventType.rollLaneSingle: break
				case EventType.rollLaneDouble: break
				case EventType.force: break
				default: {
					if (openEnabled) { trackEventEnd.type = EventType.open }
					if (tapEnabled && trackEventEnd.isStart) {
						const tapMarker = _.clone(trackEventEnd)
						tapMarker.type = EventType.tap
						reducedTrackEventEnds.push(tapMarker)
					}
				}
			}
			reducedTrackEventEnds.push(trackEventEnd)
		}
		return reducedTrackEventEnds
	}

	/** Assumes `trackEventEnds` are all events belonging to the same instrument and difficulty. */
	private getTrackEvents(trackEventEnds: TrackEventEnd[]) {
		const trackEvents: TrackEventDiff[] = []
		const lastTrackEventEnds: Partial<{ [type in EventType]: TrackEventEnd }> = {}
		const zeroLengthEventTypes = [EventType.force, EventType.soloMarker, EventType.activationLane, EventType.kick, EventType.kick2x]

		for (const trackEventEnd of trackEventEnds) {
			const lastTrackEventEnd = lastTrackEventEnds[trackEventEnd.type!]
			if (trackEventEnd.isStart) {
				if (zeroLengthEventTypes.includes(trackEventEnd.type!)) {
					trackEvents.push({
						difficulty: trackEventEnd.difficulty!,
						time: trackEventEnd.time,
						length: 0,
						type: trackEventEnd.type!,
					})
				} else {
					lastTrackEventEnds[trackEventEnd.type!] = trackEventEnd
				}
			} else if (lastTrackEventEnd) {
				trackEvents.push({
					difficulty: trackEventEnd.difficulty!,
					time: lastTrackEventEnd.time,
					length: _.round(trackEventEnd.time - lastTrackEventEnd.time, 3),
					type: lastTrackEventEnd.type!,
				})
				delete lastTrackEventEnds[trackEventEnd.type!]
			}
		}
		return trackEvents
	}

	/** Sustains shorter than a 1/12th step are cut off and turned into a normal (non-sustain) note. */
	private applyEventLengthFix() {
		const events = _.chain(this.splitTracks)
			.flatMap(st => st.trackEvents.filter(te => te.length > 0 && te.type !== EventType.starPower))
			.sortBy(te => te.time)
			.value()

		let currentBpmIndex = 0
		for (const event of events) {
			while (this.tempoMap[currentBpmIndex + 1] && this.tempoMap[currentBpmIndex + 1].playTime! <= event.time) {
				currentBpmIndex++ // Increment currentBpmIndex to the index of the most recent BPM marker
			}

			// Assumes the BPM doesn't change across the duration of the sustain.
			// This will rarely happen, and will be incorrectly interpreted even less often.
			const lengthInTwelfthNotes = event.length * 1000 * (1 / this.tempoMap[currentBpmIndex].tempo!) * 3
			if (lengthInTwelfthNotes < 1) {
				event.length = 0
			}
		}
	}

	public parse(): NotesData {

		const trackParsers = _.chain(this.splitTracks)
			.map(track => new TrackParser(
				this.notesData,
				track.instrument,
				track.difficulty,
				track.trackEvents,
				'mid'
			))
			.value()

		trackParsers.forEach(p => p.parseTrack())

		const globalFirstNote = _.minBy(trackParsers, p => p.firstNote?.time ?? Infinity)?.firstNote ?? null
		const globalLastNote = _.maxBy(trackParsers, p => p.lastNote?.time ?? -Infinity)?.lastNote ?? null

		if (globalFirstNote === null || globalLastNote === null) {
			this.notesData.chartIssues.push('noNotes')
			return this.notesData
		}

		const vocalEvents = this.tracks.find(t => t.trackName === 'PART VOCALS')?.trackEvents
		if (vocalEvents?.length) {
			this.notesData.hasLyrics = true
			if (vocalEvents.find(te => te.param1! !== 105 && te.param1! !== 106)) {
				this.notesData.hasVocals = true
			}
		}
		const sectionEvents = _.chain(this.tracks.find(t => t.trackName === 'EVENTS')?.trackEvents ?? [])
			.map(ete => ete.data?.map(dta => String.fromCharCode(dta)).join('') ?? '')
			.filter(name => name.includes('[section') || name.includes('[prc_'))
			.value()
		if (!sectionEvents.length) { this.notesData.chartIssues.push('noSections') }

		this.notesData.tempoMapHash = createHash('md5')
			.update(this.tempoMap.map(t => `${t.playTime}_${_.round(t.tempoBPM!, 3)}`).join(':'))
			.update(this.timeSignatures.map(t => t.param1! / Math.pow(2, t.param2!)).join(':'))
			.digest('hex')
		this.notesData.tempoMarkerCount = this.tempoMap.length

		if (this.tempoMap.length === 1 && _.round(this.tempoMap[0].tempoBPM!, 3) === 120 && this.timeSignatures.length === 1) {
			this.notesData.chartIssues.push('isDefaultBPM')
		}

		this.notesData.length = Math.floor(globalLastNote.time)
		this.notesData.effectiveLength = Math.floor(globalLastNote.time - globalFirstNote.time)

		this.setMissingExperts()
		this.setTimeSignatureProperties()

		return this.notesData
	}

	private setMissingExperts() {
		const missingExperts = _.chain(this.splitTracks)
			.groupBy(trackSection => trackSection.instrument)
			.mapValues(trackSections => trackSections.map(trackSection => trackSection.difficulty))
			.toPairs()
			.filter(([, difficulties]) => !difficulties.includes('expert') && difficulties.length > 0)
			.map(([instrument]) => instrument as Instrument)
			.value()

		if (missingExperts.length > 0) {
			this.notesData.chartIssues.push('noExpert')
		}
	}

	private setTimeSignatureProperties() {
		const events = _.sortBy([..._.drop(this.tempoMap, 1), ...this.timeSignatures], e => e.playTime)
		const timeSignatures: (MIDIEvent & { tick: number })[] = []
		let currentTempo = this.tempoMap[0].tempo!
		const resolution = 480 // Arbitrarily chosen value for ticks in each quarter note
		let currentTick = 0
		for (let i = 0; i < events.length; i++) {
			const deltaTimeMs = events[i].playTime! - (events[i - 1]?.playTime ?? 0)
			currentTick += deltaTimeMs * 1000 * (1 / currentTempo) * resolution
			if (events[i].tempo) {
				currentTempo = events[i].tempo!
			} else if (events[i].param1) {
				timeSignatures.push({ ...events[i], tick: _.round(currentTick) })
			}
		}

		let previousBeatlineTick = 0
		for (let i = 0; i < timeSignatures.length; i++) {
			if (_.round(previousBeatlineTick, 5) !== _.round(timeSignatures[i].tick, 5)) {
				this.notesData.chartIssues.push('misalignedTimeSignatures')
				break
			}
			while (timeSignatures[i + 1] && previousBeatlineTick < timeSignatures[i + 1].tick) {
				const timeSignatureFraction = timeSignatures[i].param1! / Math.pow(2, timeSignatures[i].param2!)
				previousBeatlineTick += resolution * timeSignatureFraction * 4
			}
		}
	}
}

/**
 * @returns the `notesData` object corresponding with the ".mid" file in `buffer`.
 */
export function parseMidi(buffer: ArrayBuffer) {
	const midiFile = new MIDIFile(buffer)
	return new MidiParser(midiFile).parse()
}
