import {parse, $NoSection} from '../ini-parser';

const INI = '[Song]\nname = Test Song\nartist = Test Band\n';

function utf16le(text: string) {
  const body = new Uint8Array(text.length * 2);
  const view = new DataView(body.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return new Uint8Array([0xff, 0xfe, ...body]);
}

function utf16be(text: string) {
  const body = new Uint8Array(text.length * 2);
  const view = new DataView(body.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), false);
  }
  return new Uint8Array([0xfe, 0xff, ...body]);
}

describe('ini-parser encodings', () => {
  it('parses UTF-8', () => {
    const {iniObject} = parse(new TextEncoder().encode(INI));
    expect(iniObject['Song']).toEqual({name: 'Test Song', artist: 'Test Band'});
  });

  // A UTF-8 byte-order mark is dropped by TextDecoder itself. Without that,
  // the mark stays on the `[Song]` line and the section is lost.
  it('parses UTF-8 with a byte-order mark', () => {
    const bytes = new TextEncoder().encode(INI);
    const {iniObject} = parse(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]));
    expect(iniObject['Song']).toEqual({name: 'Test Song', artist: 'Test Band'});
  });

  // Windows chart tools write song.ini as UTF-16. Decoded as UTF-8 these
  // files parse to no sections at all, which loses the chart silently.
  it('parses UTF-16 LE', () => {
    const {iniObject} = parse(utf16le(INI));
    expect(iniObject['Song']).toEqual({name: 'Test Song', artist: 'Test Band'});
    expect(iniObject[$NoSection]).toBeUndefined();
  });

  it('parses UTF-16 BE', () => {
    const {iniObject} = parse(utf16be(INI));
    expect(iniObject['Song']).toEqual({name: 'Test Song', artist: 'Test Band'});
  });

  it('handles a file too short to hold a byte-order mark', () => {
    expect(parse(new Uint8Array([]))).toEqual({iniObject: {}, iniErrors: []});
  });
});
