'use client';

import {useCallback} from 'react';
import {FilePlus2, FolderInput} from 'lucide-react';
import {toast} from 'sonner';
import {pickFiles} from '@/lib/sng/read-dropped-entries';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface SngLandingProps {
  onCreate: () => void;
  onPickSng: (file: File) => void;
}

export default function SngLanding({onCreate, onPickSng}: SngLandingProps) {
  const handleModify = useCallback(async () => {
    try {
      // A distinct picker id keeps its own remembered location, separate from
      // the file/folder pickers used when building a package.
      const files = await pickFiles({
        id: 'sng-modify',
        types: [
          {
            description: 'SNG package',
            accept: {'application/octet-stream': ['.sng']},
          },
        ],
      });
      if (files?.[0]) onPickSng(files[0]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, [onPickSng]);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <section className="mb-8">
        <h1 className="text-3xl font-bold">SNG File Manager</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Create and modify <code>.sng</code> files — the packaged song format
          used by Clone Hero and YARG. Build a new package from a folder or
          loose files, or open an existing <code>.sng</code> to inspect it, add
          or remove files, and download it again as <code>.sng</code> or{' '}
          <code>.zip</code>. Everything runs in your browser.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FilePlus2 className="h-5 w-5" />
              Create SNG
            </CardTitle>
            <CardDescription>
              Start with an empty package, then drag in the files or a folder
              that make up your song.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={onCreate}>
              Create SNG
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderInput className="h-5 w-5" />
              Modify SNG
            </CardTitle>
            <CardDescription>
              Open an existing <code>.sng</code> file to see what&apos;s inside
              and make changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" onClick={handleModify}>
              Modify SNG
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
