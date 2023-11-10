import detect from 'charset-detector'

/** Overwrites the type of a nested property in `T` with `U`. */
export type Overwrite<T, U> = U extends object ? (
	T extends object ? {
		[K in keyof T]: K extends keyof U ? Overwrite<T[K], U[K]> : T[K];
	} : U
) : U
export type Subset<K> = {
	[attr in keyof K]?: NonNullable<K[attr]> extends object ? Subset<K[attr]> : K[attr]
}
export type RequireMatchingProps<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> }
export type OptionalMatchingProps<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] }

/**
 * @returns the most likely text encoding for text in `buffer`.
 */
export function getEncoding(buffer: Buffer) {
	const matchingCharset = detect(buffer)[0]
	switch (matchingCharset.charsetName) {
		case 'UTF-8': return 'utf8'
		case 'ISO-8859-1': return 'latin1'
		case 'ISO-8859-2': return 'latin1'
		case 'ISO-8859-9': return 'utf8'
		case 'windows-1252': return 'utf8'
		case 'UTF-16LE': return 'utf16le'
		default: return 'utf8'
	}
}

/**
 * @returns true if the list of filename `extensions` appears to be intended as a chart folder.
 */
export function appearsToBeChartFolder(extensions: string[]) {
	const ext = extensions.map(extension => extension.toLowerCase())
	const containsNotes = (ext.includes('chart') || ext.includes('mid'))
	const containsAudio = (ext.includes('ogg') || ext.includes('mp3') || ext.includes('wav') || ext.includes('opus'))
	return (containsNotes || containsAudio)
}

export function getExtension(fileName: string) {
	return '.' + fileName.split('.').pop()!
}

export function getBasename(fileName: string) {
	return fileName.slice(0, fileName.indexOf('.'))
}

/**
 * @returns `true` if `name` has a valid sng file extension.
 */
export function hasSngExtension(name: string) {
	return '.sng' === getExtension(name).toLowerCase()
}

/**
 * @returns `true` if `name` has a valid ini file extension.
 */
export function hasIniExtension(name: string) {
	return ('.ini' === getExtension(name).toLowerCase())
}

/**
 * @returns `true` if `name` is a valid ini filename.
 */
export function hasIniName(name: string) {
	return name === 'song.ini'
}

/**
 * @returns `true` if `name` has a valid chart file extension.
 */
export function hasChartExtension(name: string) {
	return (['.chart', '.mid'].includes(getExtension(name).toLowerCase()))
}

/**
 * @returns `true` if `name` is a valid chart filename.
 */
export function hasChartName(name: string) {
	return ['notes.chart', 'notes.mid'].includes(name)
}

/**
 * @returns `true` if `name` has a valid chart audio file extension.
 */
export function hasAudioExtension(name: string) {
	return (['.ogg', '.mp3', '.wav', '.opus'].includes(getExtension(name).toLowerCase()))
}

/**
 * @returns `true` if `name` has a valid chart audio filename.
 */
export function hasAudioName(name: string) {
	return (['song', 'guitar', 'bass', 'rhythm', 'keys', 'vocals', 'vocals_1', 'vocals_2',
		'drums', 'drums_1', 'drums_2', 'drums_3', 'drums_4', 'crowd', 'preview'].includes(getBasename(name)))
		&& (['.ogg', '.mp3', '.wav', '.opus'].includes(getExtension(name)))
}

/**
 * @returns `true` if `name` is a valid album filename.
 */
export function hasAlbumName(name: string) {
	return ['album.jpg', 'album.png'].includes(name)
}

/**
 * @returns `true` if `name` is a valid video filename.
 */
export function hasVideoName(name: string) {
	return getBasename(name) === 'video' && (['.mp4', '.avi', '.webm', '.vp8', '.ogv', '.mpeg'].includes(getExtension(name)))
}

/**
 * @returns `true` if `name` is a video filename that is not supported on Linux.
 */
export function hasBadVideoName(name: string) {
	return getBasename(name) === 'video' && (['.mp4', '.avi', '.mpeg'].includes(getExtension(name)))
}

/**
 * @returns `text` with all style tags removed. (e.g. "<color=#AEFFFF>Aren Eternal</color> & Geo" -> "Aren Eternal & Geo")
 */
export function removeStyleTags(text: string) {
	let oldText = text
	let newText = text
	do {
		oldText = newText
		newText = newText.replace(/<\s*[^>]+>(.*?)<\s*\/\s*[^>]+>/g, '$1')
		newText = newText.replace(/<\s*\/\s*[^>]+>(.*?)<\s*[^>]+>/g, '$1')
	} while (newText != oldText)
	return newText
}

/**
 * @returns `true` if `value` is an array of `T` items.
 */
export function isArray<T>(value: T | readonly T[]): value is readonly T[] {
	return Array.isArray(value)
}
