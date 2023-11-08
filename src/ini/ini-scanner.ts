import * as _ from 'lodash'

import { CachedFile } from 'src/cached-file'
import { FolderIssueType, MetadataIssueType } from '../interfaces'
import { hasIniExtension, hasIniName, isArray, removeStyleTags } from '../utils'
import { IniObject, parseIni } from './ini-parser'

type TypedSubset<O, K extends keyof O, T> = O[K] extends T ? K : never
type StringProperties<O> = { [key in keyof O as TypedSubset<O, key, string>]: string }
type NumberProperties<O> = { [key in keyof O as TypedSubset<O, key, number>]: number }
type BooleanProperties<O> = { [key in keyof O as TypedSubset<O, key, boolean>]: boolean }

type Metadata = typeof defaultMetadata
type CInputMetaStringKey = keyof StringProperties<InputMetadata>
type CMetaStringKey = keyof StringProperties<Metadata>
type CInputMetaNumberKey = keyof NumberProperties<InputMetadata>
type CMetaNumberKey = keyof NumberProperties<Metadata>
type CInputMetaBooleanKey = keyof BooleanProperties<InputMetadata>
type CMetaBooleanKey = keyof BooleanProperties<Metadata>

type InputMetadata = Metadata & {
	'frets': string
	'track': number
}
export const defaultMetadata = {
	'name': 'Unknown Name',
	'artist': 'Unknown Artist',
	'album': 'Unknown Album',
	'genre': 'Unknown Genre',
	'year': 'Unknown Year',
	'charter': 'Unknown Charter',
	/** Units of ms */ 'song_length': 0,
	'diff_band': -1,
	'diff_guitar': -1,
	'diff_guitar_coop': -1,
	'diff_rhythm': -1,
	'diff_bass': -1,
	'diff_drums': -1,
	'diff_drums_real': -1,
	'diff_keys': -1,
	'diff_guitarghl': -1,
	'diff_guitar_coop_ghl': -1,
	'diff_rhythm_ghl': -1,
	'diff_bassghl': -1,
	'diff_vocals': -1,
	/** Units of ms */ 'preview_start_time': -1,
	'icon': '',
	'loading_phrase': '',
	'album_track': 16000,
	'playlist_track': 16000,
	'modchart': false,
	/** Units of ms */ 'delay': 0,
	'hopo_frequency': 0,
	'eighthnote_hopo': false,
	'multiplier_note': 0,
	'video_start_time': 0,
	'five_lane_drums': false,
	'pro_drums': false,
	'end_events': true,
}

class IniScanner {

	public metadata: Metadata | null = null
	public folderIssues: { folderIssue: FolderIssueType; description: string }[] = []
	public metadataIssues: MetadataIssueType[] = []

	/** The ini object with parsed data from the song.ini file, or the notes.chart file if an ini doesn't exist */
	private iniObject: IniObject

	private addFolderIssue(folderIssue: FolderIssueType, description: string) {
		this.folderIssues.push({ folderIssue, description })
	}

	/**
	 * Sets `this.metadata` to the ini metadata provided in `this.chartFolder`.
	 */
	public scan(chartFolder: CachedFile[], sngMetadata?: { [key: string]: string }) {
		if (sngMetadata) {
			this.iniObject = { 'song': sngMetadata }
		} else {
			const iniChartFile = this.getIniChartFile(chartFolder)
			if (!iniChartFile) { return }

			const iniFile = this.getIniAtFile(iniChartFile)
			if (!iniFile) { return }

			this.iniObject = iniFile
			this.iniObject.song = iniFile.song || iniFile.Song || iniFile.SONG
			if (iniFile.song === undefined) {
				this.addFolderIssue('invalidMetadata', `"song.ini" doesn't have a "[Song]" section.`)
				return
			}
		}

		this.extractIniMetadata()
		this.findMetadataIssues()
	}

	/**
	 * @returns the .ini file in this chart, or `null` if one wasn't found.
	 */
	private getIniChartFile(chartFolder: CachedFile[]) {
		let iniCount = 0
		let bestIni: CachedFile | null = null
		let lastIni: CachedFile | null = null

		for (const file of chartFolder) {
			if (hasIniExtension(file.name)) {
				iniCount++
				lastIni = file
				if (!hasIniName(file.name)) {
					this.addFolderIssue('invalidIni', `"${file.name}" is not named "song.ini".`)
				} else {
					bestIni = file
				}
			}
		}

		if (iniCount > 1) {
			this.addFolderIssue('multipleIniFiles', `This chart has multiple .ini files.`)
		}

		if (bestIni !== null) {
			return bestIni
		} else if (lastIni !== null) {
			return lastIni
		} else {
			this.addFolderIssue('noMetadata', `This chart doesn't have "song.ini".`)
			return null
		}
	}

	/**
	 * @returns an `IIniObject` derived from the .ini file at `file`, or `null` if the file couldn't be read.
	 */
	private getIniAtFile(file: CachedFile) {
		const { iniObject, iniErrors } = parseIni(file)

		for (const iniError of iniErrors.slice(-5)) { // Limit this if there are too many errors
			this.addFolderIssue('badIniLine', _.truncate(iniError, { length: 200 }))
		}

		return iniObject
	}

	/**
	 * Stores all the metadata found in `this.iniFile.song` into `this.metadata` (uses default values if not found).
	 */
	private extractIniMetadata() {
		this.metadata = Object.assign({}, defaultMetadata)

		// Charter may be stored in `this.iniFile.song.frets`
		const strings = ['name', 'artist', 'album', 'genre', 'year', ['frets', 'charter'], 'icon', 'loading_phrase'] as const
		this.extractMetadataField<CInputMetaStringKey, CMetaStringKey>(this.extractMetadataString.bind(this), strings)
		this.metadata.icon = this.metadata.icon?.toLowerCase() // Icons are interpreted as lowercase in CH
		if (this.metadata.icon === this.metadata.charter?.toLowerCase()) { this.metadata.icon = '' } // Setting `icon` can be redundant

		// album_track may be stored in `this.iniFile.song.track`
		const integers = ['song_length', 'diff_band', 'diff_guitar', 'diff_guitar_coop', 'diff_rhythm', 'diff_bass', 'diff_drums',
			'diff_drums_real', 'diff_keys', 'diff_guitarghl', 'diff_guitar_coop_ghl', 'diff_rhythm_ghl', 'diff_bassghl', 'diff_vocals',
			'preview_start_time', ['track', 'album_track'], 'playlist_track', 'delay', 'hopo_frequency', 'multiplier_note',
			'video_start_time'] as const
		this.extractMetadataField<CInputMetaNumberKey, CMetaNumberKey>(this.extractMetadataInteger.bind(this), integers)

		const booleans = ['modchart', 'eighthnote_hopo', 'five_lane_drums', 'pro_drums', 'end_events'] as const
		this.extractMetadataField<CInputMetaBooleanKey, CMetaBooleanKey>(this.extractMetadataBoolean.bind(this), booleans)
	}

	/**
	 * Extracts `fields` from `this.metadata` using `extractFunction`.
	 * @param fields
	 * An array of single keys and two key tuple arrays.
	 * With a single key, the field will be extracted from the ini file at that key.
	 * It will then be saved in the metadata object at the same key.
	 * With an array of two keys, the field will be extracted from the ini file at both keys.
	 * (If both are defined, the second field is used)
	 * It will then be saved in the metadata object at the second key.
	 */
	private extractMetadataField<I, K extends I>(
		extractFunction: ((metadataField: K, iniField?: Exclude<I, K>) => void),
		fields: readonly (K | readonly [Exclude<I, K>, K])[]
	) {
		fields.forEach(value => {
			if (isArray(value)) {
				extractFunction(value[1], value[0])
				extractFunction(value[1])
			} else {
				extractFunction(value)
			}
		})
	}

	/**
	 * Stores `this.iniFile.song[iniField ?? metadataField]` into `this.metadata[metadataField]` if that field has an actual string value.
	 * Any style tags are removed from the string.
	 */
	private extractMetadataString(metadataField: CMetaStringKey, iniField?: Exclude<CInputMetaStringKey, CMetaStringKey>): void {
		const value = this.iniObject.song[iniField ?? metadataField]
		if (value && !['', '0', '-1'].includes(value)) {
			this.metadata![metadataField] = removeStyleTags(value)
		}
	}

	/**
	 * Stores `this.iniFile.song[iniField ?? metadataField]` into `this.metadata[metadataField]` if that field has an actual number value.
	 * All numbers are rounded to the nearest integer.
	 */
	private extractMetadataInteger(metadataField: CMetaNumberKey, iniField?: Exclude<CInputMetaNumberKey, CMetaNumberKey>): void {
		const value = parseFloat(this.iniObject.song[iniField ?? metadataField])
		if (!isNaN(value) && value !== -1) {
			const int = Math.round(value)
			if (int !== value) {
				this.addFolderIssue('badIniLine', `The "${iniField}" value in "song.ini" is "${value}", which is not an integer.`)
			}
			this.metadata![metadataField] = int
		}
	}

	/**
	 * Stores `this.iniFile.song[iniField ?? metadataField]` into `this.metadata[metadataField]` if that field has an actual boolean value.
	 */
	private extractMetadataBoolean(metadataField: CMetaBooleanKey, iniField?: Exclude<CInputMetaBooleanKey, CMetaBooleanKey>): void {
		const value = this.iniObject.song[iniField ?? metadataField]
		if (value === 'True' || value === '1') {
			this.metadata![metadataField] = true
		} else if (value === 'False' || value === '0') {
			this.metadata![metadataField] = false
		}
	}

	private findMetadataIssues() {
		if (this.metadata!.name === defaultMetadata.name) { this.metadataIssues.push('noName') }
		if (this.metadata!.artist === defaultMetadata.artist) { this.metadataIssues.push('noArtist') }
		if (this.metadata!.album === defaultMetadata.album) { this.metadataIssues.push('noAlbum') }
		if (this.metadata!.genre === defaultMetadata.genre) { this.metadataIssues.push('noGenre') }
		if (this.metadata!.year === defaultMetadata.year) { this.metadataIssues.push('noYear') }
		if (this.metadata!.charter === defaultMetadata.charter) { this.metadataIssues.push('noCharter') }
		if (this.metadata!.delay !== 0) { this.metadataIssues.push('nonzeroDelay') }
	}
}

export function scanIni(chartFolder: CachedFile[], sngMetadata?: { [key: string]: string }) {
	const iniScanner = new IniScanner()
	iniScanner.scan(chartFolder, sngMetadata)
	return {
		metadata: iniScanner.metadata,
		folderIssues: iniScanner.folderIssues,
		metadataIssues: iniScanner.metadataIssues,
	}
}
