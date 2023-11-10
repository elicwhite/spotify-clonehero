import { md5 } from 'js-md5'
import { SngHeader, SngStream } from 'parse-sng'

export class CachedFile {

	public name: string

	private constructor(
		public fileHandle: FileSystemFileHandle,
		// eslint-disable-next-line @typescript-eslint/naming-convention
		private _data: ArrayBuffer | null = null,
		// eslint-disable-next-line @typescript-eslint/naming-convention
		private _readStream: ReadableStream<Uint8Array> | null,
		name?: string,
	) {
		this.name = name ?? fileHandle.name
	}

	static async build(fileHandle: FileSystemFileHandle) {

		if (fileHandle.kind != 'file') {
			throw new Error(`Can't read file at ${fileHandle.name}; not a file`)
		}

		const file = await fileHandle.getFile()

		const fileSizeMiB = file.size / 1024 / 1024
		if (fileSizeMiB < 2048) {
			return new CachedFile(fileHandle, await file.arrayBuffer(), null)
		} else {
			return new CachedFile(fileHandle, null, file.stream())
		}
	}

	static async buildFromSng(fileHandle: FileSystemFileHandle) {

		if (fileHandle.kind != 'file') {
			throw new Error(`Can't read file at ${fileHandle.name}; not a file`)
		}

		let sngHeader: SngHeader
		let cachedFiles: Promise<CachedFile[]>

		const file = await fileHandle.getFile()
		const sngStream = new SngStream(() => file.stream())

		sngStream.on('header', header => sngHeader = header)

		await new Promise<void>((resolve, reject) => {

			sngStream.on('error', err => reject(err))

			sngStream.on('files', files => {
				cachedFiles = Promise.all(files.map(async ({ fileName, fileStream }) => {
					const fileSizeMiB = Number(sngHeader.fileMeta.find(fm => fm.filename === fileName)!.contentsLen) / 1024 / 1024

					if (fileSizeMiB < 2048) {
						const chunks: Uint8Array[] = []
						const reader = fileStream.getReader()

						// eslint-disable-next-line no-constant-condition
						while (true) {
							try {
								const result = await reader.read()
								if (result.done) { break }
								// chunks.push(result.value)
							} catch (err) {
								reject(err)
								return new CachedFile(fileHandle, null, null)
							}
						}

						return new CachedFile(fileHandle, Buffer.concat(chunks), null, fileName)
					} else {
						return new CachedFile(fileHandle, null, fileStream, fileName)
					}
				}))

				resolve()
			})

			sngStream.start()
		})

		return {
			sngMetadata: sngHeader!.metadata,
			files: await cachedFiles!,
		}
	}

	/**
	 * This will throw an exception if the file is over 2 GiB.
	 */
	get data() {
		if (!this._data) {
			throw new Error(`Can't store full file in a buffer; larger than 2 GiB.`)
		}
		return this._data
	}

	/**
	 * A stream for the file's data. Creats a read stream of the cached data if the file is less than 2 GiB.
	 */
	get readStream() {
		if (this._data) {
			return new Blob([this._data]).stream()
		} else {
			return this._readStream!
		}
	}

	async getMD5() {
		const hash = md5.create()

		const reader = this.readStream.getReader()

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await reader.read()
			if (result.done) { break }
			hash.update(result.value)
		}

		return hash.hex()
	}
}
