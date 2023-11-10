import { CachedFile } from 'src/cached-file'
import { FolderIssueType } from '../interfaces'
import { hasBadVideoName, hasVideoName } from '../utils'

class VideoScanner {

	public folderIssues: { folderIssue: FolderIssueType; description: string }[] = []
	public hasVideoBackground = false

	private addFolderIssue(folderIssue: FolderIssueType, description: string) {
		this.folderIssues.push({ folderIssue, description })
	}

	public scan(chartFolder: CachedFile[]) {
		let videoCount = 0
		for (const file of chartFolder) {
			if (hasVideoName(file.name)) {
				videoCount++
				if (hasBadVideoName(file.name)) {
					this.addFolderIssue('badVideo', `"${file.name}" will not work on Linux and should be converted to .webm.`)
				}
			}
		}

		if (videoCount > 1) {
			this.addFolderIssue('multipleVideo', `This chart has multiple video background files.`)
		}

		if (videoCount > 0) {
			this.hasVideoBackground = true
		}
	}
}

export function scanVideo(chartFolder: CachedFile[]) {
	const videoScanner = new VideoScanner()
	videoScanner.scan(chartFolder)
	return {
		hasVideoBackground: videoScanner.hasVideoBackground,
		folderIssues: videoScanner.folderIssues,
	}
}
