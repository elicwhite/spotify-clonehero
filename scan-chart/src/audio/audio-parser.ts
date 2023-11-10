import ffmpeg from 'fluent-ffmpeg'
import { Readable } from 'stream'
import { pool, WorkerPool } from 'workerpool'

import { CachedFile } from 'src/cached-file'
import { calculateFingerprint } from './audio-fingerprint'

/** Maximum number of seconds of audio to analyze per stem */
const STREAM_DURATION = 100

export class AudioParser {

	private pool: WorkerPool

	constructor(max_threads: number) {
		this.start(max_threads)
	}

	/**
	 * Used to spawn a worker pool when the service begins
	 */
	private async start(workers: number) {
		this.pool = pool(undefined, { maxWorkers: workers })
	}

	/**
	 * Used to terminate the worker pool on user action
	 */
	private stop() {
		this.pool.terminate(true)
	}

	/**
	 * @returns the audio fingerprint and audio length of each file in `audioFiles`.
	 * Includes any errors that occured during this process.
	 */
	public async getAudioFingerprint(audioFiles: CachedFile[]) {
		let audioLengths: number[]
		try {
			audioLengths = await Promise.all(audioFiles.map(audioFile => this.getAudioLength(audioFile)))
		} catch (err) {
			return { audioHash: [] as number[], audioLength: null, errors: [err as string] }
		}

		const audioLength = Math.round(Math.max.apply(null, audioLengths))
		const minLength = Math.round(Math.min.apply(null, audioLengths))

		// FFMPEG's "amerge" filter output length is always the shortest input length
		// If the shortest input length is too short, use the "amix" filter instead
		const audioFilter = (audioFiles.length > 1 && minLength < STREAM_DURATION ? 'amix' : 'amerge')

		const { audioHash, errors } = await this.pool.exec(calculateFingerprint, [audioFiles, audioFilter])

		return {
			audioHash,
			audioLength,
			errors,
		}
	}

	/**
	 * @returns the length of `audioFile` (in seconds).
	 * @throws an exception if the audio file could not be parsed.
	 */
	private async getAudioLength(audioFile: CachedFile) {
		return new Promise<number>((resolve, reject) => {
			ffmpeg(Readable.from(audioFile.data)).ffprobe((err, metadata) => {
				if (err) {
					reject(`Failed to read audio file (${audioFile.name}):\n${err}`)
				} else if (!metadata) {
					reject(`Failed to read metadata from audio file (${audioFile.name}):\n${err}`)
				} else {
					if (metadata.format.duration) {
						resolve(metadata.format.duration)
					} else {
						reject(`Failed to read duration from audio file (${audioFile.name})`)
					}
				}
			})
		})
	}
}
