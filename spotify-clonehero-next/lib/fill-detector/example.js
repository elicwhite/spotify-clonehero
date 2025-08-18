#!/usr/bin/env node

/**
 * Example usage of the drum fill extractor
 */

import {extractFills, defaultConfig} from './index';

// Create a simple synthetic chart for demonstration
function createExampleChart() {
  const resolution = 192; // Ticks per quarter note
  const notes = [];

  // Create a simple rock beat pattern for 4 bars
  for (let bar = 0; bar < 4; bar++) {
    const barStart = bar * resolution * 4;

    // Kick on beats 1 and 3
    notes.push({
      tick: barStart,
      msTime: (barStart / resolution) * 500, // 120 BPM
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });

    notes.push({
      tick: barStart + resolution * 2,
      msTime: ((barStart + resolution * 2) / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });

    // Snare on beats 2 and 4
    notes.push({
      tick: barStart + resolution,
      msTime: ((barStart + resolution) / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 1, // Snare
      flags: 0,
    });

    notes.push({
      tick: barStart + resolution * 3,
      msTime: ((barStart + resolution * 3) / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 1, // Snare
      flags: 0,
    });
  }

  // Add a dense tom fill in the 5th bar
  const fillStart = 4 * resolution * 4;
  for (let i = 0; i < 16; i++) {
    // 16th notes
    notes.push({
      tick: fillStart + i * (resolution / 4),
      msTime: ((fillStart + i * (resolution / 4)) / resolution) * 500,
      length: resolution / 8,
      msLength: 62.5,
      type: 3, // Tom
      flags: 0,
    });
  }

  // Add more groove after the fill
  for (let bar = 5; bar < 8; bar++) {
    const barStart = bar * resolution * 4;

    // Continue the rock pattern
    notes.push({
      tick: barStart,
      msTime: (barStart / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });

    notes.push({
      tick: barStart + resolution,
      msTime: ((barStart + resolution) / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 1, // Snare
      flags: 0,
    });
  }

  return {
    name: 'Example Song',
    artist: 'Demo Artist',
    resolution,
    tempos: [{tick: 0, bpm: 120, msTime: 0}],
    trackData: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        noteEventGroups: [notes],
      },
    ],
  };
}

async function runExample() {
  console.log('🥁 Drum Fill Extractor Example\n');

  // Create example chart
  const chart = createExampleChart();
  console.log(`📊 Created example chart: "${chart.name}" by ${chart.artist}`);
  console.log(
    `📈 Chart contains ${chart.trackData[0].noteEventGroups[0].length} drum notes\n`,
  );

  // Extract fills with default configuration
  console.log('🔍 Extracting drum fills with default settings...');
  const startTime = performance.now();
  const fills = extractFills(chart, defaultConfig);
  const endTime = performance.now();

  console.log(`⚡ Processing took ${(endTime - startTime).toFixed(2)}ms\n`);

  // Display results
  if (fills.length === 0) {
    console.log('❌ No drum fills detected');
    console.log('💡 Try adjusting thresholds or using more complex patterns\n');
  } else {
    console.log(
      `✅ Found ${fills.length} drum fill${fills.length > 1 ? 's' : ''}:\n`,
    );

    fills.forEach((fill, index) => {
      const duration = (fill.endMs - fill.startMs) / 1000;
      console.log(`Fill #${index + 1}:`);
      console.log(
        `  📍 Time: ${(fill.startMs / 1000).toFixed(2)}s - ${(fill.endMs / 1000).toFixed(2)}s (${duration.toFixed(2)}s)`,
      );
      console.log(`  🎵 Ticks: ${fill.startTick} - ${fill.endTick}`);
      console.log(`  📊 Density Z-Score: ${fill.densityZ.toFixed(2)}`);
      console.log(`  🥁 Tom Ratio Jump: ${fill.tomRatioJump.toFixed(2)}`);
      console.log(`  🚀 Groove Distance: ${fill.grooveDist.toFixed(2)}`);
      console.log(
        `  🎯 Features: ${JSON.stringify(
          {
            samePadBurst: fill.samePadBurst,
            crashResolve: fill.crashResolve,
            ngramNovelty: fill.ngramNovelty,
          },
          null,
          2,
        )}`,
      );
      console.log('');
    });
  }

  // Try with more sensitive settings
  console.log('🔧 Trying with more sensitive settings...');
  const sensitiveConfig = {
    ...defaultConfig,
    thresholds: {
      ...defaultConfig.thresholds,
      densityZ: 0.8, // Lower threshold
      dist: 1.5, // Lower groove distance requirement
      minBeats: 0.5, // Shorter minimum duration
    },
  };

  const sensitiveFills = extractFills(chart, sensitiveConfig);
  console.log(`🔍 Sensitive detection found ${sensitiveFills.length} fills\n`);

  if (sensitiveFills.length > fills.length) {
    console.log('📈 More sensitive settings detected additional fills:');
    sensitiveFills.slice(fills.length).forEach((fill, index) => {
      const duration = (fill.endMs - fill.startMs) / 1000;
      console.log(
        `  Additional Fill #${index + 1}: ${(fill.startMs / 1000).toFixed(2)}s - ${(fill.endMs / 1000).toFixed(2)}s`,
      );
    });
    console.log('');
  }

  console.log('🎉 Example completed successfully!');
  console.log('\n💡 Tips for using the fill detector:');
  console.log('  • Adjust thresholds based on your music style');
  console.log('  • Lower densityZ for more sensitive detection');
  console.log('  • Increase minBeats to avoid short false positives');
  console.log('  • Use different difficulty levels for different complexity');
}

// Run the example
runExample().catch(console.error);
