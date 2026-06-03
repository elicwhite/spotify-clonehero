'use client';

import {useRouter} from 'next/navigation';
import {useSng} from '../SngContext';
import SngEditor from '../components/SngEditor';

export default function SngManageRoute() {
  const router = useRouter();
  const {files, addEntries, removeFile, download} = useSng();

  return (
    <SngEditor
      files={files}
      onAdd={addEntries}
      onDelete={removeFile}
      onDownload={download}
      onBack={() => router.push('/sng')}
    />
  );
}
