import {Config} from '@remotion/cli/config';
import {withProductApp} from '@musiccharts/video-kit/config';
import productApp from './productApp.config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
// The app's aliases, its TypeScript semantics, one copy of each shared
// library, ANGLE for the WebGL highway, and the public folder.
withProductApp(Config, productApp);
