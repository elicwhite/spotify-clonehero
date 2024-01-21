export async function GET(request: Request) {
  return Response.json({
    // Increment this if you want to force clients to redownload server data
    chartsDataVersion: 3,
  });
}

// Revision 3: Encore went from 35k to 55k charts. Bulk update
// Revision 2: Dedupe by groupId and not my md5. Was previously
// showing multiple charts for the same song/charter
// Revision 1: Initial revision
