'use client';

import {signIn, signOut, useSession} from 'next-auth/react';
import {useState, useEffect} from 'react';
import {Button} from '@/components/ui/button';
import {Icons} from '@/components/icons';
import {detectBrowserCapabilities, type BrowserCapabilities} from '@/lib/browser-compat/FileSystemCompat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {Badge} from '@/components/ui/badge';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {AlertTriangle, Info, CheckCircle, XCircle} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import spotifyLogoBlack from '@/public/assets/spotify/logo_black.png';
import spotifyLogoWhite from '@/public/assets/spotify/logo_white.png';

export default function GlobalHeader() {
  const session = useSession();
  const [capabilities, setCapabilities] = useState<BrowserCapabilities | null>(null);
  const [isCompatModalOpen, setIsCompatModalOpen] = useState(false);

  // Detect browser capabilities on client side only to avoid hydration mismatch
  useEffect(() => {
    setCapabilities(detectBrowserCapabilities());
  }, []);

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
    if (!capabilities) return null;
    
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

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left side - Logo/Brand */}
        <div className="flex items-center space-x-4">
          <Link href='/'>
            <h1 className="text-xl font-bold">Music Chart Tools</h1>
          </Link>
          <div className="hidden md:flex items-center space-x-2">
            <Button variant="ghost" size="icon" className="w-9 px-0" asChild>
              <a
                href="https://discord.gg/EDxu95B98s"
                target="_blank"
                rel="noreferrer">
                <Icons.discord className="h-4 w-4" />
                <span className="sr-only">Discord</span>
              </a>
            </Button>
            <Button variant="ghost" size="icon" className="w-9 px-0" asChild>
              <a
                href="https://github.com/TheSavior/spotify-clonehero"
                target="_blank"
                rel="noreferrer">
                <Icons.gitHub className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </a>
            </Button>
          </div>
        </div>

        {/* Center - Spotify branding when authenticated */}
        {session?.status === 'authenticated' && (
          <div className="flex items-center text-sm text-muted-foreground">
            <span>Powered by</span>
            <Image
              src={spotifyLogoBlack}
              sizes="6em"
              className="inline dark:hidden px-2"
              priority={true}
              style={{
                width: 'auto',
                height: 'auto',
              }}
              alt="Spotify"
            />
            <Image
              src={spotifyLogoWhite}
              sizes="6em"
              className="dark:inline px-2"
              priority={true}
              style={{
                width: 'auto',
                height: 'auto',
              }}
              alt="Spotify"
            />
          </div>
        )}

        {/* Right side - Auth and compatibility */}
        <div className="flex items-center space-x-2">
          {/* Browser compatibility warning */}
          {capabilities && capabilities.mode !== 'native' && (
            <Dialog open={isCompatModalOpen} onOpenChange={setIsCompatModalOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  className={capabilities?.mode === 'fallback' ? 'text-yellow-600' : 'text-red-600'}
                >
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Browser Compatibility Status
                    {capabilities?.mode === 'native' ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : capabilities?.mode === 'fallback' ? (
                      <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    Current browser: {getBrowserName()} • Mode: {capabilities?.mode || 'Loading...'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  {capabilities && message && capabilities.mode !== 'native' && (
                    <Alert variant={capabilities.mode === 'fallback' ? 'default' : 'destructive'}>
                      {capabilities.mode === 'fallback' ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      <AlertTitle>{message.title}</AlertTitle>
                      <AlertDescription>
                        {message.description}
                      </AlertDescription>
                    </Alert>
                  )}

                  {capabilities && (
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
                  )}

                  {capabilities?.mode === 'fallback' && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                            Fallback Mode Information
                          </p>
                          <ul className="text-yellow-700 dark:text-yellow-300 space-y-1 text-xs">
                            <li>• Chart scanning will be skipped - all songs will be available for download</li>
                            <li>• Files will be downloaded instead of saved directly to folders</li>
                            <li>• Advanced folder management features are not available</li>
                            <li>• For the best experience, consider using Chrome or Edge</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {capabilities?.mode === 'unsupported' && (
                    <div className="text-sm text-muted-foreground">
                      <p className="mb-2">Supported browsers:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Google Chrome (recommended)</li>
                        <li>Microsoft Edge</li>
                        <li>Opera</li>
                        <li>Brave Browser (with limited features)</li>
                      </ul>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* Authentication */}
          {session?.status === 'loading' ? (
            <div>Loading...</div>
          ) : session?.status === 'authenticated' ? (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">
                {session.data?.user?.name}
              </span>
              <Button onClick={() => signOut()} variant="outline" size="sm">
                Sign out
              </Button>
            </div>
          ) : (
            <Button onClick={() => signIn('spotify')} size="sm">
              <Icons.spotify className="h-4 w-4 mr-2" />
              Sign in with Spotify
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
