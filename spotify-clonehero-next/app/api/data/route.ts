export async function GET(request: Request) {
  return Response.json({
    // Increment this if you want to force clients to redownload server data
    chartsDataVersion: 1,
  });
}
