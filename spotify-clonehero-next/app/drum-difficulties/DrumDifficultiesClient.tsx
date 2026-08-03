'use client';

import DifficultyGenerationFlow from '@/components/difficulty-generation/DifficultyGenerationFlow';

export default function DrumDifficultiesClient() {
  return (
    <DifficultyGenerationFlow
      instrument="drums"
      pageTitle="Drum Difficulty Generation"
      pageDescription="Drop a pro-drums chart with an Expert track to generate Hard, Medium, and Easy, then fine-tune them in the chart editor."
      dropZoneId="drum-difficulties-picker"
    />
  );
}
