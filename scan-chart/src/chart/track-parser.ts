import { md5 } from 'js-md5'
import * as _ from 'lodash'

import { Difficulty, EventType, GroupedTrackEvent, Instrument, NoteIssue, NoteIssueType, NotesData, TrackEvent, TrackIssueType } from '../interfaces'

const LEADING_SILENCE_THRESHOLD_MS = 1000
const MIN_SUSTAIN_GAP_MS = 40
const MIN_SUSTAIN_MS = 100
const NPS_GROUP_SIZE_MS = 1000

export class TrackParser {
	/** Includes all track event types except `starPower`, `soloMarker`, `activationLane`, `rollLaneSingle`, and `rollLaneDouble`. */
	private notes: TrackEvent[]
	private groupedNotes: GroupedTrackEvent[]

	private noteIssues: NoteIssue[] = []
	private trackIssues: TrackIssueType[] = []

	constructor(
		private notesData: NotesData,
		private instrument: Instrument,
		private difficulty: Difficulty,
		private trackEvents: TrackEvent[],
		private format: 'chart' | 'mid'
	) {
		if (!notesData.instruments.includes(this.instrument)) { notesData.instruments.push(this.instrument) }

		const nonNoteEvents = [
			EventType.starPower,
			EventType.soloMarker,
			EventType.activationLane,
			EventType.rollLaneSingle,
			EventType.rollLaneDouble,
		]

		this.notes = trackEvents.filter(event => !nonNoteEvents.includes(event.type))
		this.groupedNotes = _.chain(this.notes)
			.groupBy(note => note.time)
			.values()
			.map(noteGroup => ({
				time: noteGroup[0].time,
				events: noteGroup,
			}))
			.sortBy(note => note.time)
			.value()
	}

	public get firstNote() { return _.first(this.groupedNotes) ?? null }
	public get lastNote() { return _.last(this.groupedNotes) ?? null }

	private addNoteIssue(issueType: NoteIssueType, time: number) { this.noteIssues.push({ issueType, time }) }
	private addTrackIssue(issueType: TrackIssueType) { this.trackIssues.push(issueType) }

	/**
	 * Updates `notesData` with errors and other info detected in this track.
	 */
	public parseTrack() {
		if (this.instrument === 'drums') {
			this.parseDrumTrack()
		} else {
			this.parseNonDrumTrack()
		}

		// Calculate NPS properties
		this.setNpsProperties()

		if (this.groupedNotes.length > 0) {
			// Add notes hash
			this.notesData.hashes.push({
				instrument: this.instrument,
				difficulty: this.difficulty,
				hash: md5.create().update(this.trackEvents.map(n => `${n.time}_${n.type}_${n.length}`).join(':')).hex(),
			})

			// Add note count
			this.notesData.noteCounts.push({ instrument: this.instrument, difficulty: this.difficulty, count: this.groupedNotes.length })
		} else {
			this.notesData.instruments = this.notesData.instruments.filter(i => i !== this.instrument)
			this.addTrackIssue('noNotesOnNonemptyTrack')
		}

		// Check for broken notes
		if (this.instrument !== 'drums') {
			for (let i = 1; i < this.groupedNotes.length; i++) {
				const note = this.groupedNotes[i]
				const previousNote = this.groupedNotes[i - 1]
				const distance = note.time - previousNote.time
				if (distance > 0 && distance <= 15) {
					if ((this.typeCount(note, [EventType.open]) > 0 && this.typeCount(previousNote, [EventType.open]) === 0)
						|| (this.typeCount(previousNote, [EventType.open]) > 0 && this.typeCount(note, [EventType.open]) === 0)) {
						continue // Skip open notes before or after non-open notes
					}
					this.addNoteIssue('brokenNote', this.groupedNotes[i].time)
				}
			}
		}

		// Check for leading silence
		if (this.groupedNotes[0]?.time !== undefined && this.groupedNotes[0].time < LEADING_SILENCE_THRESHOLD_MS) {
			this.addTrackIssue('smallLeadingSilence')
		}

		if (this.noteIssues.length) {
			this.noteIssues = _.chain(this.noteIssues).uniqBy(n => n.issueType + n.time).sortBy(n => n.time).value()
			this.notesData.noteIssues.push({ instrument: this.instrument, difficulty: this.difficulty, noteIssues: this.noteIssues })
		}
		if (this.trackIssues.length) {
			this.notesData.trackIssues.push({ instrument: this.instrument, difficulty: this.difficulty, trackIssues: this.trackIssues })
		}
	}

	private typeCount(note: GroupedTrackEvent, types: EventType[]) {
		let count = 0
		for (const event of note.events) {
			if (types.includes(event.type)) {
				count++
			}
		}
		return count
	}

	private parseDrumTrack() {
		let trackHasStarPower = false
		let trackHasActivationLanes = false
		// Check for drum note type properties
		for (const event of this.trackEvents) {
			if (event.type === EventType.starPower) { trackHasStarPower = true }
			// GH1/GH2 charts represent star power using solo marker events
			if (event.type === EventType.soloMarker && this.format === 'mid') { trackHasStarPower = true }
			if (event.type === EventType.activationLane) { trackHasActivationLanes = true }
			if (event.type === EventType.kick2x) { this.notesData.has2xKick = true }
			if (event.type === EventType.rollLaneSingle || event.type === EventType.rollLaneDouble) { this.notesData.hasRollLanes = true }
		}
		const nonKickDrumNoteIds = [EventType.green, EventType.red, EventType.yellow, EventType.blue, EventType.orange]
		const kickDrumNoteIds = [EventType.kick]
		const kick2xDrumNoteIds = [EventType.kick2x]
		for (const note of this.groupedNotes) {
			// Check for three-note drum chords (not including kicks)
			if (this.typeCount(note, nonKickDrumNoteIds) >= 3) { this.addNoteIssue('threeNoteDrumChord', note.time) }
			// Check for notes forbidden on lower difficulties
			if (this.difficulty !== 'expert') {
				if (this.typeCount(note, kick2xDrumNoteIds) > 0) { this.addNoteIssue('difficultyForbiddenNote', note.time) }
			}
			if (this.difficulty === 'easy') {
				if (this.typeCount(note, nonKickDrumNoteIds) === 2 && this.typeCount(note, kickDrumNoteIds) > 0) {
					this.addNoteIssue('difficultyForbiddenNote', note.time)
				}
			}
		}
		if (
			!trackHasStarPower
			&& this.firstNote
			&& this.lastNote
			&& this.lastNote.time - this.firstNote.time > 60000
			&& this.groupedNotes.length > 50
		) { this.addTrackIssue('noStarPower') }
		if (!trackHasActivationLanes) { this.addTrackIssue('noDrumActivationLanes') }
	}

	private parseNonDrumTrack() {
		let trackHasStarPower = false
		// Check for guitar note type properties
		for (const event of this.trackEvents) {
			if (event.type === EventType.soloMarker) { this.notesData.hasSoloSections = true }
			if (event.type === EventType.force) { this.notesData.hasForcedNotes = true }
			if (event.type === EventType.open) { this.notesData.hasOpenNotes = true }
			if (event.type === EventType.starPower) { trackHasStarPower = true }
			if (event.type === EventType.tap) { this.notesData.hasTapNotes = true }
		}
		// Check for sustain properties
		this.setSustainProperties()
		if (!['guitarghl', 'guitarcoopghl', 'rhythmghl', 'bassghl'].includes(this.instrument)) {
			const fiveNoteChordIds = [EventType.green, EventType.red, EventType.yellow, EventType.blue, EventType.orange]
			const greenBlueChordIds = [EventType.green, EventType.blue]
			const greenOrangeChordIds = [EventType.green, EventType.orange]
			const orangeIds = [EventType.orange]
			const orangeBlueIds = [EventType.orange, EventType.blue]
			for (const note of this.groupedNotes) {
				// Check for five-note chords
				if (this.typeCount(note, fiveNoteChordIds) === 5) { this.addNoteIssue('fiveNoteChord', note.time) }
				// Check for notes forbidden on lower difficulties
				if (this.difficulty === 'hard') {
					if (this.typeCount(note, greenOrangeChordIds) === 2) { this.addNoteIssue('difficultyForbiddenNote', note.time) }
				} else if (this.difficulty === 'medium') {
					if (this.typeCount(note, orangeIds) > 0) { this.addNoteIssue('difficultyForbiddenNote', note.time) }
					if (this.typeCount(note, greenBlueChordIds) === 2) { this.addNoteIssue('difficultyForbiddenNote', note.time) }
				} else if (this.difficulty === 'easy') {
					if (this.typeCount(note, orangeBlueIds) > 0) { this.addNoteIssue('difficultyForbiddenNote', note.time) }
				}
			}
		}
		if (
			!trackHasStarPower
			&& this.firstNote
			&& this.lastNote
			&& this.lastNote.time - this.firstNote.time > 60000
			&& this.groupedNotes.length > 50
		) { this.addTrackIssue('noStarPower') }
	}

	private setSustainProperties() {
		/** Sustain gaps at the end of notes already checked in the for loop. `startTime` is inclusive, `endTime` is exclusive. */
		const futureSustainGaps: { startTime: number; endTime: number }[] = []
		for (let i = 0; i < this.notes.length; i++) {
			const note = this.notes[i]

			_.remove(futureSustainGaps, r => r.endTime <= note.time)
			if (futureSustainGaps.find(r => note.time >= r.startTime && note.time < r.endTime)) {
				this.addNoteIssue('badSustainGap', note.time)
			}

			if (note.length > 0) {
				if (note.type !== EventType.open) { // ignore gaps of open sustains
					futureSustainGaps.push({
						startTime: note.time + note.length,
						endTime: note.time + note.length + MIN_SUSTAIN_GAP_MS,
					})
				}
				if (note.length < MIN_SUSTAIN_MS) {
					let overlapsHopoOpen = false
					for (let j = i + 1; j < this.notes.length && this.notes[j].time <= note.time + note.length; j++) {
						if (this.notes[j].type === EventType.open) {
							const matchingEvents = this.trackEvents.filter(te => te.time === this.notes[j].time)
							if (!matchingEvents.find(e => e.type === EventType.force)) {
								overlapsHopoOpen = true
							}
						}
					}

					if (!overlapsHopoOpen) {
						this.addNoteIssue('babySustain', note.time)
					}
				}
			}
		}
	}

	private setNpsProperties() {
		if (!this.groupedNotes.length) { return }
		/** The list of ticks that contain previous notes that are within `NPS_GROUP_SIZE_MS` milliseconds of `note`. */
		const recentNoteTimes: number[] = []
		/** Last note in the highest-nps group. */
		let highestNpsNote = { noteCount: 1, note: this.groupedNotes[0] }
		for (const note of this.groupedNotes) {
			_.remove(recentNoteTimes, r => r <= note.time - NPS_GROUP_SIZE_MS)
			recentNoteTimes.push(note.time)

			if (highestNpsNote.noteCount < recentNoteTimes.length) {
				highestNpsNote = { noteCount: recentNoteTimes.length, note }
			}
		}

		const noteRegionMin = highestNpsNote.note.time - NPS_GROUP_SIZE_MS - 500
		const noteRegionMax = highestNpsNote.note.time + 500
		this.notesData.maxNps.push({
			instrument: this.instrument,
			difficulty: this.difficulty,
			time: highestNpsNote.note.time,
			nps: _.round((highestNpsNote.noteCount * 1000) / NPS_GROUP_SIZE_MS, 3),
			notes: this.notes.filter(n => n.time > noteRegionMin && n.time <= noteRegionMax),
		})
	}
}
