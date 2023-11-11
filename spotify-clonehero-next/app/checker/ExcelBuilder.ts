import dayjs from 'dayjs';
import {Borders, Workbook} from 'exceljs';
import _ from 'lodash';
import {
  ChartIssueType,
  FolderIssueType,
  MetadataIssueType,
  NoteIssueType,
  ScannedChart,
  TrackIssueType,
} from 'scan-chart-web';

export async function getChartIssues(charts: ScannedChart[]) {
  const chartIssues: {
    path: string;
    artist: string;
    name: string;
    charter: string;
    errorName: string;
    errorDescription: string;
    fixMandatory: boolean;
  }[] = [];

  for (const chart of charts) {
    const addIssue = (
      errorName: string,
      errorDescription: string,
      fixMandatory: boolean,
    ) => {
      const path =
        chart.chartPath +
        (chart.chartFileName != null ? '/' + chart.chartFileName : '');

      chartIssues.push({
        path,
        artist: removeStyleTags(chart.chart.artist ?? ''),
        name: removeStyleTags(chart.chart.name ?? ''),
        charter: removeStyleTags(chart.chart.charter ?? ''),
        errorName,
        errorDescription,
        fixMandatory,
      });
    };

    if (chart.chart.folderIssues.length > 0) {
      for (const folderIssue of chart.chart.folderIssues) {
        if (folderIssue.folderIssue === 'albumArtSize') {
          continue;
        } // Ignored; .sng conversion fixes this
        addIssue(
          folderIssue.folderIssue,
          folderIssue.description,
          (
            [
              'noMetadata',
              'invalidMetadata',
              'noAudio',
              'badAudio',
              'noChart',
              'invalidChart',
              'badChart',
            ] satisfies FolderIssueType[] as FolderIssueType[]
          ).includes(folderIssue.folderIssue),
        );
      }
    }

    if (chart.chart.metadataIssues.length > 0) {
      for (const metadataIssue of chart.chart.metadataIssues) {
        addIssue(
          metadataIssue,
          getMetadataIssueDescription(metadataIssue),
          (
            [
              'noName',
              'noArtist',
              'noCharter',
            ] satisfies MetadataIssueType[] as MetadataIssueType[]
          ).includes(metadataIssue),
        );
      }
    }

    if ((chart.chart.notesData?.chartIssues ?? []).length > 0) {
      for (const chartIssue of chart.chart.notesData!.chartIssues) {
        addIssue(
          chartIssue,
          getChartIssueDescription(chartIssue),
          (
            [
              'noResolution',
              'noSyncTrackSection',
              'noNotes',
            ] satisfies ChartIssueType[] as ChartIssueType[]
          ).includes(chartIssue),
        );
      }
    }

    if ((chart.chart.notesData?.trackIssues ?? []).length > 0) {
      for (const trackIssue of chart.chart.notesData!.trackIssues) {
        for (const i of trackIssue.trackIssues) {
          const placementTag = `[${trackIssue.instrument}][${trackIssue.difficulty}]`;
          addIssue(i, `${placementTag}: ${getTrackIssueDescription(i)}`, false);
        }
      }
    }

    if ((chart.chart.notesData?.noteIssues ?? []).length > 0) {
      for (const noteIssue of chart.chart.notesData!.noteIssues) {
        for (const i of noteIssue.noteIssues) {
          const placementTag = `[${noteIssue.instrument}][${
            noteIssue.difficulty
          }][${msToExactTime(i.time)}]`;
          addIssue(
            i.issueType,
            `${placementTag}: ${getNoteIssueDescription(i.issueType)}`,
            false,
          );
        }
      }
    }
  }

  return chartIssues;
}

export async function getIssuesXLSX(
  chartIssues: Awaited<ReturnType<typeof getChartIssues>>,
) {
  const today = dayjs();
  const chartIssueHeaders = [
    {text: 'Artist', width: 160 / 7},
    {text: 'Name', width: 400 / 7},
    {text: 'Charter', width: 160 / 7},
    {text: 'Issue Name', width: 160 / 7},
    {text: 'Issue Description', width: 650 / 7},
    {text: 'Fix Mandatory?', width: 120 / 7},
    {text: 'Path', width: 600 / 7},
  ];
  const chartIssueRows: (string | {text: string; hyperlink: string})[][] = [];
  for (const issue of chartIssues) {
    chartIssueRows.push([
      issue.artist,
      issue.name,
      issue.charter,
      issue.errorName,
      issue.errorDescription,
      issue.fixMandatory ? 'yes' : 'no',
      issue.path,
    ]);
  }

  const gridlineBorderStyle = {
    top: {style: 'thin', color: {argb: 'FFD0D0D0'}},
    left: {style: 'thin', color: {argb: 'FFD0D0D0'}},
    bottom: {style: 'thin', color: {argb: 'FFD0D0D0'}},
    right: {style: 'thin', color: {argb: 'FFD0D0D0'}},
  } satisfies Partial<Borders>;
  const workbook = new Workbook();
  workbook.creator = 'Chorus';
  workbook.created = new Date();
  workbook.modified = new Date();

  const chartIssuesWorksheet = workbook.addWorksheet('Chart Issues', {
    views: [{state: 'frozen', ySplit: 1}], // Sticky header row
  });
  chartIssuesWorksheet.autoFilter = {
    from: {row: 1, column: 1},
    to: {row: chartIssueRows.length + 1, column: chartIssueHeaders.length},
  };
  chartIssueHeaders.forEach((header, index) => {
    const cell = chartIssuesWorksheet.getCell(1, index + 1);
    cell.value = header.text;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {argb: 'FFD3D3D3'},
    };
    cell.font = {bold: true};
    const column = chartIssuesWorksheet.getColumn(index + 1);
    column.width = header.width;
    column.border = gridlineBorderStyle;
  });
  chartIssuesWorksheet.addRows(chartIssueRows);
  chartIssuesWorksheet.addConditionalFormatting({
    ref: `A2:${columnNumberToLetter(chartIssueHeaders.length)}${
      chartIssueRows.length + 1
    }`,
    rules: [
      {
        type: 'expression',
        priority: 99999,
        formulae: ['MOD(ROW(),2)=0'],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {argb: 'FFF7F7F7'},
          },
        },
      },
    ],
  });

  return await workbook.xlsx.writeBuffer({useStyles: true});
}

export function getMetadataIssueDescription(metadataIssue: MetadataIssueType) {
  switch (metadataIssue) {
    case 'noName':
      return 'Metadata is missing the "name" property.';
    case 'noArtist':
      return 'Metadata is missing the "artist" property.';
    case 'noAlbum':
      return 'Metadata is missing the "album" property.';
    case 'noGenre':
      return 'Metadata is missing the "genre" property.';
    case 'noYear':
      return 'Metadata is missing the "year" property.';
    case 'noCharter':
      return 'Metadata is missing the "charter" property.';
    case 'missingInstrumentDiff':
      return 'Metadata is missing a "diff_" property.';
    case 'extraInstrumentDiff':
      return 'Metadata contains a "diff_" property for an uncharted instrument.';
    case 'nonzeroDelay':
      return 'Metadata contains a "delay" property that is not zero.';
    case 'nonzeroOffset':
      return 'Chart file contains an "Offset" property that is not zero.';
  }
}

export function getChartIssueDescription(chartIssue: ChartIssueType) {
  switch (chartIssue) {
    case 'noResolution':
      return `This .chart file has no resolution.`;
    case 'noSyncTrackSection':
      return `This .chart file has no tempo map information.`;
    case 'noNotes':
      return `This chart has no notes.`;
    case 'noExpert':
      return `One of this chart's instruments has Easy, Medium, or Hard charted but not Expert.`;
    case 'isDefaultBPM':
      return (
        `This chart has only one 120 BPM marker and only one 4/4 time signature. This usually means the chart ` +
        `wasn't tempo-mapped, but you can ignore this if the song is a constant 120 BPM.`
      );
    case 'misalignedTimeSignatures':
      return (
        `This chart has a time signature marker that doesn't appear at the start of a measure. ` +
        `This can't be interpreted correctly in Clone Hero.`
      );
    case 'noSections':
      return `This chart has no sections.`;
  }
}

export function getTrackIssueDescription(trackIssue: TrackIssueType) {
  switch (trackIssue) {
    case 'noStarPower':
      return 'This track has no star power.';
    case 'noDrumActivationLanes':
      return 'This drums track has no activation lanes.';
    case 'smallLeadingSilence':
      return 'This track has a note that is less than 2000ms after the start of the track.';
    case 'noNotesOnNonemptyTrack':
      return 'This track has star power, solo markers, or drum lanes, but no notes.';
  }
}

export function getNoteIssueDescription(noteIssue: NoteIssueType) {
  switch (noteIssue) {
    case 'fiveNoteChord':
      return `This is a five-note chord.`;
    case 'difficultyForbiddenNote':
      return `This is a note that isn't allowed on the track's difficulty.`;
    case 'threeNoteDrumChord':
      return `This is a three-note chord on the "drums" instrument.`;
    case 'brokenNote':
      return `This note is so close to the previous note that this was likely a charting mistake.`;
    case 'badSustainGap':
      return `This note is not far enough ahead of the previous sustain.`;
    case 'babySustain':
      return `The sustain on this note is too short.`;
  }
}

export function columnNumberToLetter(column: number) {
  let temp,
    letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

/**
 * @returns an string representation of `ms` that looks like HH:MM:SS.mm
 */
export function msToExactTime(ms: number) {
  const seconds = _.round((ms / 1000) % 60, 2);
  const minutes = Math.floor((ms / 1000 / 60) % 60);
  const hours = Math.floor((ms / 1000 / 60 / 60) % 24);
  return `${hours ? `${hours}:` : ''}${_.padStart(
    minutes + '',
    2,
    '0',
  )}:${_.padStart(seconds.toFixed(2), 5, '0')}`;
}

const allowedTags = [
  'align',
  'allcaps',
  'alpha',
  'b',
  'br',
  'color',
  'cspace',
  'font',
  'font-weight',
  'gradient',
  'i',
  'indent',
  'line-height',
  'line-indent',
  'link',
  'lowercase',
  'margin',
  'mark',
  'mspace',
  'nobr',
  'noparse',
  'page',
  'pos',
  'rotate',
  's',
  'size',
  'smallcaps',
  'space',
  'sprite',
  'strikethrough',
  'style',
  'sub',
  'sup',
  'u',
  'uppercase',
  'voffset',
  'width',
];
const tagPattern = allowedTags.map(tag => `\\b${tag}\\b`).join('|');
/**
 * @returns `text` with all style tags removed. (e.g. "<color=#AEFFFF>Aren Eternal</color> & Geo" -> "Aren Eternal & Geo")
 */
export function removeStyleTags(text: string) {
  let oldText = text;
  let newText = text;
  do {
    oldText = newText;
    newText = newText
      .replace(new RegExp(`<\\s*\\/?\\s*(?:${tagPattern})[^>]*>`, 'gi'), '')
      .trim();
  } while (newText !== oldText);
  return newText;
}
