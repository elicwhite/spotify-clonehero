export async function GET(request: Request) {
  const {searchParams} = new URL(request.url);
  const id = searchParams.get('id');

  const product = {
    productId: id,
  };

  return Response.json({product});
}
