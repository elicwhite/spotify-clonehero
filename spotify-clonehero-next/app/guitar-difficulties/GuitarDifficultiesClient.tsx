'use client';

import DifficultyGenerationFlow from '@/components/difficulty-generation/DifficultyGenerationFlow';

export default function GuitarDifficultiesClient() {
  return (
    <DifficultyGenerationFlow
      instrument="guitar"
      pageTitle="Guitar Difficulty Generation"
      pageDescription="Drop a chart with an Expert guitar track to generate Hard, Medium, and Easy, then fine-tune them in the chart editor."
      dropZoneId="guitar-difficulties-picker"
    />
  );
}
