import {parseChProfile, ALESIS_SURGE_PROFILE, CH_PAD_NAMES} from '../chProfile';

const ALESIS_YAML = `DeviceName: Alesis Surge
Mappings:
  Red Pad:
  - NoteNumber: 38
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 40
    Velocity: 10
    OverHitThreshold: 0
  Yellow Pad:
  - NoteNumber: 48
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 50
    Velocity: 10
    OverHitThreshold: 0
  Blue Pad:
  - NoteNumber: 45
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 47
    Velocity: 10
    OverHitThreshold: 0
  Green Pad:
  - NoteNumber: 41
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 43
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 58
    Velocity: 10
    OverHitThreshold: 0
  Kick Pad:
  - NoteNumber: 36
    Velocity: 10
    OverHitThreshold: 0
  Yellow Cymbal:
  - NoteNumber: 22
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 42
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 23
    Velocity: 10
    OverHitThreshold: 0
  Blue Cymbal:
  - NoteNumber: 51
    Velocity: 10
    OverHitThreshold: 0
  - NoteNumber: 46
    Velocity: 10
    OverHitThreshold: 0
  Green Cymbal:
  - NoteNumber: 49
    Velocity: 10
    OverHitThreshold: 0
  Start: []
  Select: []
`;

function notes(profile: ReturnType<typeof parseChProfile>, pad: string) {
  return (profile.mappings as any)[pad]?.map((m: any) => m.noteNumber);
}

describe('parseChProfile', () => {
  it('parses the Alesis Surge YAML into the expected mapping', () => {
    const p = parseChProfile(ALESIS_YAML);
    expect(p.deviceName).toBe('Alesis Surge');
    expect(notes(p, 'Kick Pad')).toEqual([36]);
    expect(notes(p, 'Red Pad')).toEqual([38, 40]);
    expect(notes(p, 'Yellow Pad')).toEqual([48, 50]);
    expect(notes(p, 'Blue Pad')).toEqual([45, 47]);
    expect(notes(p, 'Green Pad')).toEqual([41, 43, 58]);
    expect(notes(p, 'Yellow Cymbal')).toEqual([22, 42, 23]);
    expect(notes(p, 'Blue Cymbal')).toEqual([51, 46]);
    expect(notes(p, 'Green Cymbal')).toEqual([49]);
  });

  it('parses velocity and overHitThreshold fields', () => {
    const p = parseChProfile(`DeviceName: Test
Mappings:
  Red Pad:
  - NoteNumber: 38
    Velocity: 7
    OverHitThreshold: 5
`);
    const red = (p.mappings as any)['Red Pad'][0];
    expect(red).toEqual({noteNumber: 38, velocity: 7, overHitThreshold: 5});
  });

  it('parsed Alesis YAML equals the embedded default profile', () => {
    const parsed = parseChProfile(ALESIS_YAML);
    for (const pad of CH_PAD_NAMES) {
      expect(notes(parsed, pad)).toEqual(
        notes(ALESIS_SURGE_PROFILE as any, pad),
      );
    }
  });

  it('ignores unknown pad names like Start/Select', () => {
    const p = parseChProfile(ALESIS_YAML);
    expect((p.mappings as any)['Start']).toBeUndefined();
    expect((p.mappings as any)['Select']).toBeUndefined();
  });

  it('handles empty inline lists without producing entries', () => {
    const p = parseChProfile(`DeviceName: X
Mappings:
  Red Pad: []
  Kick Pad:
  - NoteNumber: 36
    Velocity: 10
    OverHitThreshold: 0
`);
    expect((p.mappings as any)['Red Pad']).toBeUndefined();
    expect(notes(p, 'Kick Pad')).toEqual([36]);
  });

  it('tolerates CRLF line endings, comments, and quoted device name', () => {
    const yaml =
      'DeviceName: "My Kit"  # comment\r\n' +
      'Mappings:\r\n' +
      '  Kick Pad:\r\n' +
      '  - NoteNumber: 36 # the kick\r\n' +
      '    Velocity: 10\r\n' +
      '    OverHitThreshold: 0\r\n';
    const p = parseChProfile(yaml);
    expect(p.deviceName).toBe('My Kit');
    expect(notes(p, 'Kick Pad')).toEqual([36]);
  });

  it('drops mappings whose note numbers are malformed', () => {
    const p = parseChProfile(`DeviceName: X
Mappings:
  Red Pad:
  - Velocity: 10
    OverHitThreshold: 0
`);
    expect((p.mappings as any)['Red Pad']).toBeUndefined();
  });

  it('the embedded default has the documented note assignments', () => {
    const m = ALESIS_SURGE_PROFILE.mappings;
    expect(m['Kick Pad']!.map(x => x.noteNumber)).toEqual([36]);
    expect(m['Green Pad']!.map(x => x.noteNumber)).toEqual([41, 43, 58]);
    expect(m['Yellow Cymbal']!.map(x => x.noteNumber)).toEqual([22, 42, 23]);
  });
});
