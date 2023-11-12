import {searchForChart, searchForChartEncoreBasic} from './serverActions';
import {
  ChartResponse,
  ChartResponseEncore,
  selectChart,
} from './chartSelection';
import {useState, useTransition} from 'react';

export async function searchChorus(
  artist: string,
  song: string,
): Promise<ChartResponse> {
  // TODO this needs a useTransition
  const result = await searchForChart(artist, song);
  // const resultCompare = await searchForChartEncore(artist, song);
  // const parsed = JSON.parse(result);

  const charts: ChartResponse[] = JSON.parse(result);

  const selectedChart = selectChart(charts);
  return selectedChart;
}

export async function searchEncore(
  artist: string,
  song: string,
): Promise<ChartResponse> {
  // TODO this needs a useTransition
  const result = await searchForChartEncoreBasic(artist, song);

  const charts: ChartResponseEncore[] = JSON.parse(result);

  const selectedChart: ChartResponse = selectChart(
    charts.map(chart => ({
      ...chart,
      uploadedAt: chart.modifiedTime,
      lastModified: chart.modifiedTime,
      file: `https://files.enchor.us/${chart.md5}.sng`,
    })),
  );
  return selectedChart;
}

// Example Encore reponse:
// const js = [
//   {
//     ordering: 1,
//     name: 'This Is War',
//     artist: '30 Seconds To Mars',
//     album: 'This Is War',
//     genre: 'Rock',
//     year: '2009',
//     chartName: null,
//     chartAlbum: null,
//     chartGenre: null,
//     chartYear: null,
//     chartId: 3441,
//     songId: null,
//     chartDriveChartId: 3483,
//     albumArtMd5: '97d61980314af78a44e7cb0b61eca51c',
//     md5: '6af84320d0284fa135a4e5cd5b61b132',
//     chartMd5: 'da35c153915bf6af8024de0beb045f0d',
//     versionGroupId: 3441,
//     charter: 'XEntombmentX',
//     song_length: 329079,
//     diff_band: -1,
//     diff_guitar: 3,
//     diff_guitar_coop: -1,
//     diff_rhythm: 3,
//     diff_bass: 2,
//     diff_drums: -1,
//     diff_drums_real: -1,
//     diff_keys: -1,
//     diff_guitarghl: -1,
//     diff_guitar_coop_ghl: -1,
//     diff_rhythm_ghl: -1,
//     diff_bassghl: -1,
//     diff_vocals: -1,
//     preview_start_time: -1,
//     icon: '',
//     loading_phrase: '',
//     album_track: 16000,
//     playlist_track: 16000,
//     modchart: false,
//     delay: 0,
//     chart_offset: 0,
//     hopo_frequency: 0,
//     eighthnote_hopo: false,
//     multiplier_note: 0,
//     video_start_time: 0,
//     five_lane_drums: false,
//     pro_drums: false,
//     end_events: true,
//     notesData: {
//       instruments: ['guitar', 'rhythm', 'bass'],
//       hasSoloSections: false,
//       hasLyrics: false,
//       hasVocals: false,
//       hasForcedNotes: true,
//       hasTapNotes: true,
//       hasOpenNotes: false,
//       has2xKick: false,
//       hasRollLanes: false,
//       noteIssues: [],
//       trackIssues: [],
//       chartIssues: [],
//       noteCounts: [
//         {instrument: 'guitar', difficulty: 'expert', count: 1244},
//         {instrument: 'rhythm', difficulty: 'expert', count: 655},
//         {instrument: 'bass', difficulty: 'expert', count: 591},
//       ],
//       maxNps: [
//         {
//           instrument: 'guitar',
//           difficulty: 'expert',
//           time: 90121.622,
//           nps: 9,
//           notes: [
//             {time: 88809.122, length: 0, type: 'red'},
//             {time: 88996.622, length: 0, type: 'red'},
//             {time: 89184.122, length: 0, type: 'orange'},
//             {time: 89371.622, length: 0, type: 'orange'},
//             {time: 89559.122, length: 0, type: 'orange'},
//             {time: 89746.622, length: 0, type: 'orange'},
//             {time: 89934.122, length: 0, type: 'orange'},
//             {time: 89980.997, length: 0, type: 'blue'},
//             {time: 90027.872, length: 0, type: 'yellow'},
//             {time: 90074.747, length: 0, type: 'red'},
//             {time: 90121.622, length: 0, type: 'green'},
//             {time: 90121.622, length: 0, type: 'force'},
//             {time: 90309.122, length: 0, type: 'green'},
//             {time: 90496.622, length: 0, type: 'green'},
//           ],
//         },
//         {
//           instrument: 'rhythm',
//           difficulty: 'expert',
//           time: 82059.122,
//           nps: 6,
//           notes: [
//             {time: 81121.622, length: 0, type: 'yellow'},
//             {time: 81121.622, length: 0, type: 'orange'},
//             {time: 81309.122, length: 0, type: 'yellow'},
//             {time: 81309.122, length: 0, type: 'orange'},
//             {time: 81496.622, length: 0, type: 'yellow'},
//             {time: 81496.622, length: 0, type: 'orange'},
//             {time: 81684.122, length: 0, type: 'yellow'},
//             {time: 81684.122, length: 0, type: 'orange'},
//             {time: 81871.622, length: 0, type: 'yellow'},
//             {time: 81871.622, length: 0, type: 'orange'},
//             {time: 82059.122, length: 0, type: 'yellow'},
//             {time: 82059.122, length: 0, type: 'orange'},
//             {time: 82246.622, length: 0, type: 'yellow'},
//             {time: 82246.622, length: 0, type: 'orange'},
//             {time: 82434.122, length: 0, type: 'yellow'},
//             {time: 82434.122, length: 0, type: 'orange'},
//           ],
//         },
//         {
//           instrument: 'bass',
//           difficulty: 'expert',
//           time: 79059.122,
//           nps: 9,
//           notes: [
//             {time: 77746.622, length: 0, type: 'yellow'},
//             {time: 77934.122, length: 0, type: 'green'},
//             {time: 78121.622, length: 0, type: 'green'},
//             {time: 78168.497, length: 0, type: 'red'},
//             {time: 78215.372, length: 0, type: 'yellow'},
//             {time: 78309.122, length: 0, type: 'yellow'},
//             {time: 78496.622, length: 0, type: 'yellow'},
//             {time: 78684.122, length: 0, type: 'yellow'},
//             {time: 78871.622, length: 0, type: 'yellow'},
//             {time: 78965.372, length: 0, type: 'blue'},
//             {time: 79059.122, length: 0, type: 'blue'},
//             {time: 79246.622, length: 0, type: 'blue'},
//             {time: 79434.122, length: 0, type: 'blue'},
//           ],
//         },
//       ],
//       hashes: [
//         {
//           instrument: 'guitar',
//           difficulty: 'expert',
//           hash: 'c05759bedc6c4cdcae37456a43db6570',
//         },
//         {
//           instrument: 'rhythm',
//           difficulty: 'expert',
//           hash: '33662acf4f15a61ba6647288a389a126',
//         },
//         {
//           instrument: 'bass',
//           difficulty: 'expert',
//           hash: 'dbda99198d39b3a2649f317309225d7e',
//         },
//       ],
//       tempoMapHash: 'c9f6b11328aefe2c1da73584b4643063',
//       tempoMarkerCount: 3,
//       length: 326746,
//       effectiveLength: 293625,
//     },
//     folderIssues: [
//       {
//         folderIssue: 'albumArtSize',
//         description:
//           "This chart's album art is 1500x1500, and should be 512x512",
//       },
//     ],
//     metadataIssues: [],
//     hasVideoBackground: false,
//     modifiedTime: '2018-07-04T00:50:56.613Z',
//     applicationDriveId: '1dGkA4WRcB3pqUkBipWiYc0eWcu4tQtDE',
//     applicationUsername: 'XEntombmentX',
//     parentFolderId: '1ZdjKq3yvVjwQS351X2WSd8nqdaqLvUe4',
//     drivePath: '30 Seconds To Mars - This Is War',
//     driveFileId: null,
//     driveFileName: null,
//     driveChartIsPack: false,
//     archivePath: '',
//     chartFileName: null,
//   },
// ];
