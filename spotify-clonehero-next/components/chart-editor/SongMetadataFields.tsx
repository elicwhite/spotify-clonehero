'use client';

import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

/** The editable song metadata shared by the export and metadata dialogs. */
export interface SongMetadataValue {
  name: string;
  artist: string;
  charter: string;
}

interface SongMetadataFieldsProps {
  value: SongMetadataValue;
  onChange: (value: SongMetadataValue) => void;
  /** Prefix for input ids so multiple instances stay unique. */
  idPrefix?: string;
}

/**
 * Three labeled inputs (Song / Artist / Charter) laid out on the chart-editor
 * dialog grid. Presentational only — the parent owns the value and persistence.
 */
export default function SongMetadataFields({
  value,
  onChange,
  idPrefix = 'metadata',
}: SongMetadataFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-song`} className="text-right">
          Song
        </Label>
        <Input
          id={`${idPrefix}-song`}
          className="col-span-3"
          value={value.name}
          onChange={e => onChange({...value, name: e.target.value})}
          placeholder="Song title"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-artist`} className="text-right">
          Artist
        </Label>
        <Input
          id={`${idPrefix}-artist`}
          className="col-span-3"
          value={value.artist}
          onChange={e => onChange({...value, artist: e.target.value})}
          placeholder="Artist name"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-charter`} className="text-right">
          Charter
        </Label>
        <Input
          id={`${idPrefix}-charter`}
          className="col-span-3"
          value={value.charter}
          onChange={e => onChange({...value, charter: e.target.value})}
          placeholder="MusicCharts.tools"
        />
      </div>
    </>
  );
}
