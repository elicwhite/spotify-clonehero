import {CHART_DB_DATA_VERSION} from '@/lib/chorusChartDb/chartDbAssets';

export async function GET() {
  return Response.json({
    // Bumped when clients must discard their stored catalog and re-ingest the
    // published dump. See CHART_DB_DATA_VERSION for what counts.
    chartsDataVersion: CHART_DB_DATA_VERSION,
  });
}

// Revision 6: Track-backed instrument presence. has_drums and
// has_other_instruments cannot be recomputed from stored rows, so the
// catalog has to be re-ingested from a dump carrying notesData.
// Revision 5: undocumented
// Revision 4: Encore went from 55k to 65k charts. Bulk update
// Revision 3: Encore went from 35k to 55k charts. Bulk update
// Revision 2: Dedupe by groupId and not my md5. Was previously
// showing multiple charts for the same song/charter
// Revision 1: Initial revision
