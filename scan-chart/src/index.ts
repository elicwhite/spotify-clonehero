import Bottleneck from 'bottleneck'
import { EventEmitter } from 'events'
import * as _ from 'lodash'

import { CachedFile } from './cached-file'
import { scanChart } from './chart'
import { defaultMetadata, scanIni } from './ini'
import { Chart, EventType, ScanChartsConfig, ScannedChart } from './interfaces'
import { appearsToBeChartFolder, getExtension, hasSngExtension, RequireMatchingProps, Subset } from './utils'
import { scanVideo } from './video'

export * from './interfaces'

interface ScanChartsResultEvents {
	'folder': (folderName: string) => void
	'chart': (chart: ScannedChart, index: number, count: number) => void
	'error': (err: Error) => void
	'end': (result: ScannedChart[]) => void
}
export declare interface ScanChartsResult {
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

class ChartsScanner {

	public eventEmitter = new EventEmitter()

	private config: ScanChartsConfig

	constructor(private chartsFolder: FileSystemDirectoryHandle, config?: ScanChartsConfig) {
		this.config = {
			onlyScanSng: false,
			...config,
		}
	}

	/**
	 * Scans the charts in `chartsFolder` and its subfolders.
	 */
	public async scanChartsFolder() {
		const chartFolders = await this.getChartFolders(this.chartsFolder)

		if (chartFolders.length == 0) {
			this.eventEmitter.emit('end', [])
			return
		}

		const limiter = new Bottleneck({ maxConcurrent: 20 }) // Ensures memory use stays bounded
		let chartCounter = 0

		const charts: ScannedChart[] = []
		for (const chartFolder of chartFolders) {
			limiter.schedule(async () => {
				let chart: Chart
				const isSng = chartFolder.files.length === 1 && hasSngExtension(chartFolder.files[0].name)

				if (isSng) {
					throw new Error('sng files not yet supported')
					// const { sngMetadata, files } = await CachedFile.buildFromSng(join(chartFolder.path, chartFolder.files[0].name))
					// chart = await this.scanChartFolder(files, sngMetadata)
				} else {
					const chartFiles: CachedFile[] = []
					await Promise.all(chartFolder.files.map(async file => {
						chartFiles.push(await CachedFile.build(file))
					}))
					chart = await this.scanChartFolder(chartFiles)
				}

				if (chart) {
					const result: ScannedChart = {
						chart,
						chartPath: chartFolder.path,
						chartFileName: isSng ? chartFolder.files[0].name : null,
					}
					charts.push(result)
					this.eventEmitter.emit('chart', result, chartCounter, chartFolders.length)
				}
				chartCounter++
			})
		}

		let emittedError = false
		limiter.on('error', err => {
			this.eventEmitter.emit('error', err)
			emittedError = true
			limiter.stop()
		})
		limiter.on('idle', () => {
			if (!emittedError) {
				this.eventEmitter.emit('end', charts)
			}
		})
	}

	/**
	 * @returns valid chart folders in `path` and all its subdirectories.
	 */
	private async getChartFolders(directoryHandle: FileSystemDirectoryHandle) {
		const chartFolders: { path: string; files: FileSystemFileHandle[] }[] = []

		const files = []
		for await (const subHandle of directoryHandle.values()) {
			files.push(subHandle)
		}

		const subfolders = _.chain(files)
			.filter(f => f.kind == 'directory' && f.name !== '__MACOSX') // Apple should follow the principle of least astonishment (smh)
			.map((f: FileSystemDirectoryHandle) => this.getChartFolders(f))
			.value()

		chartFolders.push(..._.flatMap(await Promise.all(subfolders)))

		const sngFiles = files.filter(f => f.kind != 'directory' && hasSngExtension(f.name))
		chartFolders.push(...sngFiles.map((sf: FileSystemFileHandle) => ({ path: directoryHandle.name, files: [sf] })))

		if (
			!this.config.onlyScanSng &&
			appearsToBeChartFolder(files.map(file => getExtension(file.name).substring(1))) &&
			subfolders.length === 0 // Charts won't contain other charts
		) {
			chartFolders.push({ path: directoryHandle.name, files: files.filter(f => f.kind != 'directory') as FileSystemFileHandle[] })
			this.eventEmitter.emit('folder', directoryHandle.name)
		}

		return chartFolders
	}

	private async scanChartFolder(chartFolder: CachedFile[], sngMetadata?: { [key: string]: string }) {
		const chart: RequireMatchingProps<Subset<Chart>, 'folderIssues' | 'metadataIssues' | 'playable'> = {
			folderIssues: [],
			metadataIssues: [],
			playable: true,
		}

		// chart.md5 = await this.getChartMD5(chartFolder)

		const iniData = scanIni(chartFolder, sngMetadata)
		chart.folderIssues.push(...iniData.folderIssues)
		chart.metadataIssues.push(...iniData.metadataIssues)

		const chartData = await scanChart(chartFolder)
		chart.chartMd5 = chartData.chartMd5 ?? undefined
		chart.folderIssues.push(...chartData.folderIssues)
		chart.metadataIssues.push(...chartData.metadataIssues)
		if (chartData.notesData) {
			chart.notesData = {
				...chartData.notesData,
				maxNps: chartData.notesData.maxNps.map(item => ({
					...item,
					notes: item.notes.map(note => ({
						...note,
						type: EventType[note.type] as keyof typeof EventType, // Replace enum with string equivalent
					})),
				})),
			}
			const instruments = chartData.notesData.instruments
			if (iniData.metadata && (
				(instruments.includes('guitar') && iniData.metadata.diff_guitar === defaultMetadata.diff_guitar) ||
				(instruments.includes('guitarcoop') && iniData.metadata.diff_guitar_coop === defaultMetadata.diff_guitar_coop) ||
				(instruments.includes('rhythm') && iniData.metadata.diff_rhythm === defaultMetadata.diff_rhythm) ||
				(instruments.includes('bass') && iniData.metadata.diff_bass === defaultMetadata.diff_bass) ||
				(instruments.includes('drums') && iniData.metadata.diff_drums === defaultMetadata.diff_drums) ||
				(instruments.includes('keys') && iniData.metadata.diff_keys === defaultMetadata.diff_keys) ||
				(instruments.includes('guitarghl') && iniData.metadata.diff_guitarghl === defaultMetadata.diff_guitarghl) ||
				(instruments.includes('guitarcoopghl') && iniData.metadata.diff_guitar_coop_ghl === defaultMetadata.diff_guitar_coop_ghl) ||
				(instruments.includes('rhythmghl') && iniData.metadata.diff_rhythm_ghl === defaultMetadata.diff_rhythm_ghl) ||
				(instruments.includes('bassghl') && iniData.metadata.diff_bassghl === defaultMetadata.diff_bassghl) ||
				(chartData.notesData.hasVocals && iniData.metadata.diff_vocals === defaultMetadata.diff_vocals)
			)) { chart.metadataIssues.push('missingInstrumentDiff') }
			if (iniData.metadata && (
				iniData.metadata.diff_guitar !== defaultMetadata.diff_guitar && !instruments.includes('guitar') ||
				iniData.metadata.diff_guitar_coop !== defaultMetadata.diff_guitar_coop && !instruments.includes('guitarcoop') ||
				iniData.metadata.diff_rhythm !== defaultMetadata.diff_rhythm && !instruments.includes('rhythm') ||
				iniData.metadata.diff_bass !== defaultMetadata.diff_bass && !instruments.includes('bass') ||
				iniData.metadata.diff_drums !== defaultMetadata.diff_drums && !instruments.includes('drums') ||
				iniData.metadata.diff_keys !== defaultMetadata.diff_keys && !instruments.includes('keys') ||
				iniData.metadata.diff_guitarghl !== defaultMetadata.diff_guitarghl && !instruments.includes('guitarghl') ||
				iniData.metadata.diff_guitar_coop_ghl !== defaultMetadata.diff_guitar_coop_ghl && !instruments.includes('guitarcoopghl') ||
				iniData.metadata.diff_rhythm_ghl !== defaultMetadata.diff_rhythm_ghl && !instruments.includes('rhythmghl') ||
				iniData.metadata.diff_bassghl !== defaultMetadata.diff_bassghl && !instruments.includes('bassghl')
			)) { chart.metadataIssues.push('extraInstrumentDiff') }
		}

		if (iniData.metadata) {
			// Use metadata from .ini file if it exists (filled in with defaults for properties that are not included)
			_.assign(chart, iniData.metadata)
		} else if (chartData.metadata) {
			// Use metadata from .chart file if it exists
			_.assign(chart, chartData.metadata)
		} else { // No metadata available
			chart.playable = false
		}
		chart.chart_offset = chartData.metadata?.delay ?? 0

		// const imageData = await scanImage(chartFolder)
		// chart.folderIssues.push(...imageData.folderIssues)
		// if (imageData.albumBuffer) {
		// 	chart.albumArt = {
		// 		md5: createHash('md5').update(imageData.albumBuffer).digest('hex'),
		// 		data: imageData.albumBuffer,
		// 	}
		// }

		// const audioData = await scanAudio(chartFolder, cpus().length - 1)
		// chart.folderIssues.push(...audioData.folderIssues)

		// if (!chartData.notesData || chart.folderIssues.find(i => i!.folderIssue === 'noAudio') /* TODO: || !audioData.audioHash */) {
		// 	chart.playable = false
		// }

		const videoData = scanVideo(chartFolder)
		chart.folderIssues.push(...videoData.folderIssues)
		chart.hasVideoBackground = videoData.hasVideoBackground

		return chart as Chart
	}

	// private async getChartMD5(chartFolder: CachedFile[]) {
	// 	const hash = createHash('md5')
	// 	for (const file of _.orderBy(chartFolder, f => f.name)) {
	// 		hash.update(file.name)
	// 		hash.update(await file.getMD5())
	// 	}
	// 	return hash.digest('hex')
	// }
}

/**
 * Scans the charts in the `chartsFolder` directory and returns an event emitter that emits the results.
 */
export function scanCharts(chartsFolder: FileSystemDirectoryHandle, config?: ScanChartsConfig) {
	const chartsScanner = new ChartsScanner(chartsFolder, config)
	chartsScanner.scanChartsFolder()

	return {
		on: <T extends keyof ScanChartsResultEvents>(event: T, listener: ScanChartsResultEvents[T]) => {
			chartsScanner.eventEmitter.on(event, listener)
		},
	}
}
