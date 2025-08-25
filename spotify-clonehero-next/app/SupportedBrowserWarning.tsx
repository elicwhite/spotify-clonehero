'use client';

import {useState, useEffect} from 'react';
import {detectBrowserCapabilities, type BrowserCapabilities} from '@/lib/browser-compat/FileSystemCompat';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Info, CheckCircle, XCircle, AlertTriangle} from 'lucide-react';

export default function SupportedBrowserWarning({
  children,
}: {
  children?: React.ReactNode;
}) {
  const [capabilities, setCapabilities] = useState<BrowserCapabilities | null>(null);

  useEffect(() => {
    setCapabilities(detectBrowserCapabilities());
  }, []);

  if (!capabilities) {
    return null; // Loading
  }

  const getBrowserName = (): string => {
    if (typeof window === 'undefined') return 'Unknown';
    
    const userAgent = window.navigator.userAgent;
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
    if (userAgent.includes('Edg')) return 'Edge';
    if (userAgent.includes('Opera')) return 'Opera';
    return 'Unknown';
  };

  const getCompatibilityMessage = () => {
    switch (capabilities.mode) {
      case 'native':
        return {
          type: 'success' as const,
          title: 'Full Compatibility',
          description: 'Your browser supports all features including directory access and file downloads.',
        };
      case 'fallback':
        return {
          type: 'warning' as const,
          title: 'Limited Compatibility',
          description: 'Your browser supports most features with some limitations. File system access will use fallback methods.',
        };
      case 'unsupported':
        return {
          type: 'error' as const,
          title: 'Unsupported Browser',
          description: 'Your browser does not support the required file system APIs.',
        };
    }
  };

  const message = getCompatibilityMessage();

  if (capabilities.mode === 'unsupported') {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription>
            {message.description} Please use a supported browser like Chrome, Edge, or Opera.
          </AlertDescription>
        </Alert>
        
        <Card>
          <CardHeader>
            <CardTitle>Browser Compatibility</CardTitle>
            <CardDescription>Current browser: {getBrowserName()}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              <p className="mb-2">Supported browsers:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Google Chrome (recommended)</li>
                <li>Microsoft Edge</li>
                <li>Opera</li>
                <li>Brave Browser (with limited features)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {capabilities.mode === 'fallback' && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription>
            {message.description}
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Browser Compatibility Status
            {capabilities.mode === 'native' ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : capabilities.mode === 'fallback' ? (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
          </CardTitle>
          <CardDescription>
            Current browser: {getBrowserName()} • Mode: {capabilities.mode}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">Directory Access</span>
              <Badge variant={capabilities.canReadDirectories ? 'default' : 'destructive'}>
                {capabilities.canReadDirectories ? 'Supported' : 'Not Supported'}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">File Downloads</span>
              <Badge variant={capabilities.canDownloadFiles ? 'default' : 'destructive'}>
                {capabilities.canDownloadFiles ? 'Supported' : 'Not Supported'}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">File Writing</span>
              <Badge variant={capabilities.canWriteFiles ? 'default' : 'secondary'}>
                {capabilities.canWriteFiles ? 'Native' : 'Download Only'}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">Directory Picker</span>
              <Badge variant={capabilities.supportsDirectoryPicker ? 'default' : 'secondary'}>
                {capabilities.supportsDirectoryPicker ? 'Native' : 'Fallback'}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm">Drag & Drop</span>
              <Badge variant={capabilities.supportsDragAndDrop ? 'default' : 'destructive'}>
                {capabilities.supportsDragAndDrop ? 'Supported' : 'Not Supported'}
              </Badge>
            </div>
          </div>

          {capabilities.mode === 'fallback' && (
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                    Fallback Mode Information
                  </p>
                  <ul className="text-yellow-700 dark:text-yellow-300 space-y-1 text-xs">
                    <li>• You&#39;ll need to manually select folders using file dialogs</li>
                    <li>• Files will be downloaded instead of saved directly to folders</li>
                    <li>• Some advanced features may be limited</li>
                    <li>• For the best experience, consider using Chrome or Edge</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {children}
    </div>
  );
}
