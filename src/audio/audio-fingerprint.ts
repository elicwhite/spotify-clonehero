/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-use-before-define */
/**
 * Calculates the audio fingerprint for `audioFiles` mixed together using `audioFilter`.
 * (this function is sent to a worker thread, so it must contain all its dependencies)
 * @returns a `number[]` that contains the results of the calculation and an array of any
 * errors that occured during the calculation. If there are errors, the `number[]` will be empty.
 */
export async function calculateFingerprint(audioFiles: { filepath: string }[], audioFilter: 'amix' | 'amerge') {
	const ffmpegPath = await require('ffmpeg-static')
	const ffmpegProbe = await require('ffprobe-static')
	const ffmpeg = await require('fluent-ffmpeg')
	const random = await require('random')
	const seedrandom = await require('seedrandom')
	const Codegen = require('stream-audio-fingerprint/codegen_landmark')

	const errors: string[] = []

	ffmpeg.setFfmpegPath(ffmpegPath.path)
	ffmpeg.setFfprobePath(ffmpegProbe.path)

	const HASH_SIZE = 32         // Each hash is 32 bits
	const HASH_COUNT = 9         // Number of hashes per song
	const STREAM_DURATION = 100  // Maximum number of seconds to analyze
	const MAX_STEMS = 4          // Maximum number of stems to process (an ffmpeg limit; increasing this causes it to crash)

	try {
		const audioHash = await getAudioFingerprint()
		return { audioHash: errors.length ? [] : audioHash, errors }
	} catch (err) {
		return { audioHash: [], errors }
	}

	async function getAudioFingerprint(): Promise<number[]> {
		const fingerprinter = new Codegen()   // Instance of stream.Transform; a two-way stream

		const audioStream = getChartAudioStream()

		const sig = newSignature(HASH_COUNT)

		let dataCount = 0
		fingerprinter.on('data', (data: { tcodes: number[]; hcodes: number[] }) => {
			dataCount++
			data.hcodes.forEach(hcode => {
				push(sig, hcode)
			})
		})

		return new Promise<number[]>((resolve, reject) => {
			fingerprinter.on('end', () => {
				if (dataCount == 0) {
					push(sig, 400); push(sig, 200) // Push some data because superMinHash doesn't work with no inputs
				}
				for (let i = 0; i < sig.h.length; i++) {
					sig.h[i] = Math.round(sig.h[i] * (HASH_SIZE ** 2))
					sig.h[i] = Math.min(sig.h[i], 2147483647) // Max int value in Postgres (in case fingerprint value is an error)
				}
				if (sig.h.length === 0) {
					errors.push(`Audio hash failed to generate`)
					reject()
				} else {
					resolve(sig.h)
				}
			})

			audioStream.pipe(fingerprinter)
		})
	}

	/**
	 * @throws an exception if none of the audio files could be input.
	 * @returns an FFMPEG audio stream of all the audio files mixed together.
	 */
	function getChartAudioStream() {
		let filterText = `-filter_complex amerge=inputs=${audioFiles.length}`
		if (audioFilter === 'amix' || audioFiles.length > MAX_STEMS) {
			// This is necessary because amerge doesn't work correctly if audio lengths are too different or if there are too many stems
			filterText = `-filter_complex amix=inputs=${audioFiles.length}:duration=longest`
		}

		let ffmpegCommand = ffmpeg()
		let audioCount = 0
		for (let i = 0; i < audioFiles.length; i++) {
			try {
				ffmpegCommand = ffmpegCommand.input(audioFiles[i].filepath)
			} catch (err) { errors.push(`Failed to process audio file (${audioFiles[i]}):\n${err}`) }
			audioCount++
		}

		if (audioCount == 0) {
			errors.push(`Failed to scan any audio files`)
			throw new Error()
		}

		return ffmpegCommand
			.inputOption(filterText)
			.inputOption(`-ac ${audioFiles.length}`)
			.audioCodec('pcm_s16le')
			.audioFrequency(22050)
			.audioChannels(1)
			.outputFormat('wav')
			.duration(STREAM_DURATION)
		// .save(`C:\\scanTest\\with${audioFiles.length}Inputs.wav`)    // Debug: save mixed audio to file
	}

	interface Signature {
		outLen: number  // Length of output signature
		h: number[]     // Array of output values (length = outLen)
		p: number[]
		q: number[]
		b: number[]
		i: number       // The index of the input value to test next
		a: number
	}

	function newSignature(outLen: number): Signature {
		if (outLen < 1) {
			throw new Error('length has to be >= 1')
		}
		const h = new Array<number>(outLen)
		const p = new Array<number>(outLen)
		const q = new Array<number>(outLen)
		const b = new Array<number>(outLen)
		for (let i = 0; i < outLen; i++) {
			h[i] = Number.MAX_SAFE_INTEGER
			p[i] = i
			q[i] = -1
			b[i] = 0
		}
		b[outLen - 1] = outLen
		return { outLen: outLen, h: h, p: p, q: q, b: b, i: 0, a: outLen - 1 }
	}

	// Algorithm derived from: https://arxiv.org/pdf/1706.05698.pdf
	function push(sig: Signature, d: number) {
		const seed = seedrandom(d)
		random.use(seed) // d is one fingerprint input

		for (let j = 0; j < sig.a; j++) {
			// r must be a uniform random number from [0,1)  (seeded by d)
			const r = random.next()

			// k must be a uniform random integer between (j) and (m-1) (seeded by d)
			const k = random.int(j, sig.outLen - 1)

			if (sig.q[j] != sig.i) {
				sig.q[j] = sig.i
				sig.p[j] = j
			}

			if (sig.q[k] != sig.i) {
				sig.q[k] = sig.i
				sig.p[k] = k
			}

			const temp = sig.p[j]
			sig.p[j] = sig.p[k]
			sig.p[k] = temp
			const rj = r + j
			const pj = sig.p[j]
			const hpj = sig.h[pj]
			if (rj < hpj) {
				const jc = Math.min(Math.floor(hpj), sig.outLen - 1)
				sig.h[pj] = rj
				if (j < jc) {
					sig.b[jc]--
					sig.b[j]++
					while (sig.b[sig.a] == 0) {
						sig.a--
					}
				}
			}
		}
		sig.i++
	}
}
