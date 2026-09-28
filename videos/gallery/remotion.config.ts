import {Config} from '@remotion/cli/config';
import {withProductApp} from '@musiccharts/video-kit/config';
import productApp from './productApp.config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
withProductApp(Config, productApp);
