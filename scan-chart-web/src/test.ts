import { inspect } from 'util'

import { scanCharts } from './'

async function main() {
	console.time('Scan function')
	const result = scanCharts('C:\\dev\\test-scan')
	result.on('error', err => console.log(err))
	result.on('folder', folderName => {
		console.log(`Scanned: ${folderName}`)
	})
	result.on('chart', (chart, index, count) => {
		console.log(`Scanned chart [${index + 1}/${count}] (${chart.chart.artist} - ${chart.chart.name} (${chart.chart.charter}))`)
	})
	result.on('end', charts => {
		console.log('Charts:\n', inspect(charts, undefined, 300))
		console.timeEnd('Scan function')
	})
}

main()
