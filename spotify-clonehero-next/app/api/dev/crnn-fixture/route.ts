import {NextResponse} from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Dev-only debug endpoint: serves the committed CRNN parity fixture
 * (lib/drum-transcription/__tests__/fixtures/crnn-logits-reference-t4.json)
 * so the webgpu-vs-wasm residual check page
 * (app/drum-transcription/webgpu-check) can feed the SAME mel/context
 * inputs used by `pnpm test:onnx-parity` to a real browser session,
 * without re-running audio decode/separation. Never read by the shipped
 * transcription flow — see PARITY.md's stage-2 gate term (b).
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({error: 'dev-only endpoint'}, {status: 404});
  }
  const fixturePath = path.join(
    process.cwd(),
    'lib',
    'drum-transcription',
    '__tests__',
    'fixtures',
    'crnn-logits-reference-t4.json',
  );
  if (!fs.existsSync(fixturePath)) {
    return NextResponse.json(
      {error: `Fixture not found at ${fixturePath}`},
      {status: 404},
    );
  }
  const data = fs.readFileSync(fixturePath, 'utf8');
  return new NextResponse(data, {
    headers: {'content-type': 'application/json'},
  });
}
