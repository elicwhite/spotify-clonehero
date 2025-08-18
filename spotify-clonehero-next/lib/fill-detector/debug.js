#!/usr/bin/env node

import {extractFills, defaultConfig} from './index';

// Create very simple test chart with clear fill pattern
function createDebugChart() {
  const resolution = 192;
  const notes = [];

  // Simple groove for 2 bars
  for (let bar = 0; bar < 2; bar++) {
    const barStart = bar * resolution * 4;

    // Basic rock pattern
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

  // Very obvious fill - 32 consecutive 16th note toms
  const fillStart = 2 * resolution * 4;
  for (let i = 0; i < 32; i++) {
    const tick = fillStart + i * (resolution / 4);
    notes.push({
      tick,
      msTime: (tick / resolution) * 500,
      length: resolution / 8,
      msLength: 62.5,
      type: 3, // Tom
      flags: 0,
    });
  }

  // More groove after fill
  for (let bar = 4; bar < 6; bar++) {
    const barStart = bar * resolution * 4;

    notes.push({
      tick: barStart,
      msTime: (barStart / resolution) * 500,
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });
  }

  return {
    name: 'Debug Chart',
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

console.log('🔍 Debug Fill Detection');

const chart = createDebugChart();
console.log(
  `Created chart with ${chart.trackData[0].noteEventGroups[0].length} notes`,
);

// Try with very sensitive settings
const sensitiveConfig = {
  ...defaultConfig,
  windowBeats: 1,
  strideBeats: 0.25,
  thresholds: {
    densityZ: 0.1, // Very low threshold
    dist: 0.5, // Very low distance requirement
    tomJump: 1.1, // Very low tom requirement
    minBeats: 0.25, // Very short minimum
    maxBeats: 8, // Allow longer fills
    mergeGapBeats: 0.5,
    burstMs: 200,
  },
};

console.log('\n🔧 Using very sensitive settings:');
console.log(JSON.stringify(sensitiveConfig.thresholds, null, 2));

const fills = extractFills(chart, sensitiveConfig);
console.log(`\n✅ Detected ${fills.length} fills`);

if (fills.length > 0) {
  fills.forEach((fill, i) => {
    console.log(`\nFill ${i + 1}:`);
    console.log(`  Ticks: ${fill.startTick} - ${fill.endTick}`);
    console.log(`  Ms: ${fill.startMs} - ${fill.endMs}`);
    console.log(`  Density Z: ${fill.densityZ.toFixed(2)}`);
    console.log(`  Tom Jump: ${fill.tomRatioJump.toFixed(2)}`);
    console.log(`  Groove Distance: ${fill.grooveDist.toFixed(2)}`);
  });
} else {
  console.log('❌ No fills detected - investigating...');

  // Try with default config too
  console.log('\n🔧 Trying with default config...');
  const defaultFills = extractFills(chart, defaultConfig);
  console.log(`Default config detected: ${defaultFills.length} fills`);
}
