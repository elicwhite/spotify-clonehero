'use client';

import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';

export default function LocalScanLoaderCard({
  count,
  isScanning,
}: {
  count: number;
  isScanning: boolean;
}) {
  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            Scanning Local Charts
          </CardTitle>
          <p className="text-muted-foreground text-center text-sm">
            Scanning your local songs folder for charts...
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {count}
              </div>
              <div className="text-xs text-muted-foreground">Charts Found</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
