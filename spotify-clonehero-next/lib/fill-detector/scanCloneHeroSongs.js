#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import os from 'os';
import {scanChartFolder} from '@eliwhite/scan-chart';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function scanSongFolder(folderPath) {
  try {
    const files = await fs.promises.readdir(folderPath);

    // Read all files in the folder and convert to the format expected by scanChartFolder
    const chartFiles = [];

    for (const fileName of files) {
      const filePath = path.join(folderPath, fileName);
      const stats = await fs.promises.stat(filePath);

      if (stats.isFile()) {
        try {
          const fileData = await fs.promises.readFile(filePath);
          chartFiles.push({
            fileName,
            data: new Uint8Array(fileData),
          });
        } catch (error) {
          // Skip files that can't be read
          console.log(
            `Warning: Could not read file ${fileName}: ${error.message}`,
          );
        }
      }
    }

    if (chartFiles.length === 0) {
      return false;
    }

    // Use scan-chart to parse the folder
    const scannedChart = scanChartFolder(chartFiles);

    // Check if we have valid song metadata
    if (scannedChart.name) {
      const songInfo = [
        scannedChart.name,
        scannedChart.artist ? `by ${scannedChart.artist}` : null,
        scannedChart.charter ? `(Charter: ${scannedChart.charter})` : null,
      ]
        .filter(Boolean)
        .join(' ');

      console.log(`Song: ${songInfo}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error scanning folder ${folderPath}:`, error.message);
    return false;
  }
}

async function scanCloneHeroSongs() {
  const homeDir = os.homedir();
  const songsPath = path.join(homeDir, 'Clone Hero', 'Songs');

  console.log(`Scanning Clone Hero songs directory: ${songsPath}\n`);

  try {
    // Check if the directory exists
    const stats = await fs.promises.stat(songsPath);
    if (!stats.isDirectory()) {
      console.error('Clone Hero Songs path is not a directory');
      return;
    }

    const entries = await fs.promises.readdir(songsPath, {withFileTypes: true});
    const directories = entries.filter(entry => entry.isDirectory());

    console.log(`Found ${directories.length} directories to scan...\n`);

    let songCount = 0;
    let processedCount = 0;

    for (const dir of directories) {
      const fullPath = path.join(songsPath, dir.name);

      try {
        // Check if this directory itself contains a song.ini
        const hasDirectSong = await scanSongFolder(fullPath);
        if (hasDirectSong) {
          songCount++;
        } else {
          // If no direct song.ini, scan subdirectories
          const subEntries = await fs.promises.readdir(fullPath, {
            withFileTypes: true,
          });
          const subDirectories = subEntries.filter(entry =>
            entry.isDirectory(),
          );

          for (const subDir of subDirectories) {
            const subPath = path.join(fullPath, subDir.name);
            const hasSubSong = await scanSongFolder(subPath);
            if (hasSubSong) {
              songCount++;
            }
          }
        }
      } catch (error) {
        console.error(`Error processing directory ${dir.name}:`, error.message);
      }

      processedCount++;
      if (processedCount % 10 === 0) {
        console.log(
          `\nProgress: ${processedCount}/${directories.length} directories processed, ${songCount} songs found so far...`,
        );
      }
    }

    console.log(`\n=== Scan Complete ===`);
    console.log(`Total directories processed: ${processedCount}`);
    console.log(`Total songs found: ${songCount}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Clone Hero Songs directory not found at: ${songsPath}`);
      console.error(
        'Please make sure Clone Hero is installed and the Songs directory exists.',
      );
    } else {
      console.error(
        'Error scanning Clone Hero Songs directory:',
        error.message,
      );
    }
  }
}

// Run the scanner
scanCloneHeroSongs().catch(console.error);
