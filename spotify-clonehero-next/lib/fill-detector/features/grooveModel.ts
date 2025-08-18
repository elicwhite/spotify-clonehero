/**
 * Adaptive groove model for detecting deviations from established patterns
 */

import {AnalysisWindow, ValidatedConfig} from '../types';
import {
  mean,
  covarianceMatrix,
  invertMatrix,
  mahalanobisDistance,
  regularizeCovariance,
  identityMatrix,
} from '../utils/math';

/**
 * Represents the statistical model of the groove
 */
export interface GrooveModel {
  mean: number[];
  covariance: number[][];
  covarianceInverse: number[][] | null;
  sampleCount: number;
  isValid: boolean;
}

/**
 * Creates an empty groove model
 */
export function createEmptyGrooveModel(featureCount: number): GrooveModel {
  return {
    mean: new Array(featureCount).fill(0),
    covariance: identityMatrix(featureCount),
    covarianceInverse: identityMatrix(featureCount),
    sampleCount: 0,
    isValid: false,
  };
}

/**
 * Extracts feature vector from window for groove modeling
 * Uses continuous features only (excludes boolean features)
 */
function extractGrooveFeatures(window: AnalysisWindow): number[] {
  const features = window.features;
  return [
    features.noteDensity,
    features.tomRatioJump,
    features.hatDropout,
    features.kickDrop,
    features.ioiStdZ,
    features.ngramNovelty,
  ];
}

/**
 * Updates the groove model with new training windows
 */
export function updateGrooveModel(
  model: GrooveModel,
  trainingWindows: AnalysisWindow[],
): GrooveModel {
  if (trainingWindows.length === 0) {
    return model;
  }

  // Extract feature vectors from training windows
  const featureVectors = trainingWindows.map(extractGrooveFeatures);
  const featureCount = featureVectors[0].length;

  if (featureVectors.some(vec => vec.length !== featureCount)) {
    throw new Error('Inconsistent feature vector dimensions');
  }

  // Calculate mean
  const newMean = new Array(featureCount).fill(0);
  for (const vector of featureVectors) {
    for (let i = 0; i < featureCount; i++) {
      newMean[i] += vector[i];
    }
  }
  for (let i = 0; i < featureCount; i++) {
    newMean[i] /= featureVectors.length;
  }

  // Calculate covariance matrix
  let newCovariance: number[][];

  if (featureVectors.length < 2) {
    // Not enough samples for covariance, use identity matrix
    newCovariance = identityMatrix(featureCount);
  } else {
    newCovariance = covarianceMatrix(featureVectors);
    // Regularize to prevent singular matrices
    newCovariance = regularizeCovariance(newCovariance);
  }

  // Attempt to invert covariance matrix
  const newCovarianceInverse = invertMatrix(newCovariance);

  return {
    mean: newMean,
    covariance: newCovariance,
    covarianceInverse: newCovarianceInverse,
    sampleCount: featureVectors.length,
    isValid: newCovarianceInverse !== null && featureVectors.length >= 2,
  };
}

/**
 * Calculates Mahalanobis distance for a window relative to the groove model
 */
export function calculateGrooveDistance(
  window: AnalysisWindow,
  model: GrooveModel,
): number {
  if (!model.isValid || !model.covarianceInverse) {
    return 0; // No valid model, return neutral distance
  }

  const features = extractGrooveFeatures(window);

  try {
    return mahalanobisDistance(features, model.mean, model.covarianceInverse);
  } catch (error) {
    // Fallback to Euclidean distance if Mahalanobis fails
    let euclideanDistance = 0;
    for (let i = 0; i < features.length; i++) {
      const diff = features[i] - model.mean[i];
      euclideanDistance += diff * diff;
    }
    return Math.sqrt(euclideanDistance);
  }
}

/**
 * Updates groove distances for all windows using rolling groove model
 */
export function updateGrooveDistances(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
): void {
  const lookbackWindowCount = Math.max(
    1,
    Math.floor((config.lookbackBars! * 4) / config.strideBeats!),
  );
  const featureCount = 6; // Number of continuous features

  for (let i = 0; i < windows.length; i++) {
    const lookbackStart = Math.max(0, i - lookbackWindowCount);
    const lookbackEnd = i; // Exclude current window from training

    if (lookbackEnd <= lookbackStart) {
      // Not enough history, set neutral distance
      windows[i].features.grooveDist = 0;
      continue;
    }

    // Get training windows (excluding candidates to avoid bias)
    const trainingWindows = windows
      .slice(lookbackStart, lookbackEnd)
      .filter(w => !w.isCandidate); // Exclude already-identified candidates

    if (trainingWindows.length < 2) {
      // Not enough training data
      windows[i].features.grooveDist = 0;
      continue;
    }

    // Build groove model from training windows
    const model = createEmptyGrooveModel(featureCount);
    const updatedModel = updateGrooveModel(model, trainingWindows);

    // Calculate groove distance for current window
    windows[i].features.grooveDist = calculateGrooveDistance(
      windows[i],
      updatedModel,
    );
  }
}

/**
 * Identifies windows that are likely part of the main groove pattern
 * These are used as reliable training data for the model
 */
export function identifyGrooveWindows(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
): boolean[] {
  const isGrooveWindow = new Array(windows.length).fill(true);

  if (windows.length === 0) return isGrooveWindow;

  // Extract feature vectors for clustering
  const densities = windows.map(w => w.features.noteDensity);
  const tomRatios = windows.map(w => w.features.tomRatioJump);

  // Simple heuristic: exclude windows with very high density or tom ratio
  // These are likely fills or unusual patterns
  const densityMean = mean(densities);
  const tomRatioMean = mean(tomRatios);

  for (let i = 0; i < windows.length; i++) {
    const density = windows[i].features.noteDensity;
    const tomRatio = windows[i].features.tomRatioJump;

    // Exclude if significantly above average density or tom usage
    if (density > densityMean * 1.5 || tomRatio > tomRatioMean * 2.0) {
      isGrooveWindow[i] = false;
    }

    // Exclude if already marked as candidate
    if (windows[i].isCandidate) {
      isGrooveWindow[i] = false;
    }
  }

  return isGrooveWindow;
}

/**
 * Builds a global groove model from the most stable windows
 */
export function buildGlobalGrooveModel(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
): GrooveModel {
  const featureCount = 6;

  if (windows.length === 0) {
    return createEmptyGrooveModel(featureCount);
  }

  // Identify stable groove windows
  const isGroove = identifyGrooveWindows(windows, config);
  const grooveWindows = windows.filter((_, i) => isGroove[i]);

  if (grooveWindows.length < 2) {
    // Fall back to using all windows if we don't have enough groove windows
    return updateGrooveModel(createEmptyGrooveModel(featureCount), windows);
  }

  return updateGrooveModel(createEmptyGrooveModel(featureCount), grooveWindows);
}

/**
 * Validates a groove model for consistency
 */
export function validateGrooveModel(model: GrooveModel): boolean {
  if (!model || !model.mean || !model.covariance) {
    return false;
  }

  const featureCount = model.mean.length;

  // Check dimensions
  if (model.covariance.length !== featureCount) {
    return false;
  }

  for (const row of model.covariance) {
    if (row.length !== featureCount) {
      return false;
    }
  }

  // Check for NaN or infinite values
  for (const value of model.mean) {
    if (!isFinite(value)) {
      return false;
    }
  }

  for (const row of model.covariance) {
    for (const value of row) {
      if (!isFinite(value)) {
        return false;
      }
    }
  }

  return model.sampleCount > 0;
}

/**
 * Computes confidence score for groove distance measurement
 * Higher confidence means the model is more reliable
 */
export function getModelConfidence(model: GrooveModel): number {
  if (!model.isValid) {
    return 0;
  }

  // Confidence increases with sample count, up to a reasonable maximum
  const sampleConfidence = Math.min(1.0, model.sampleCount / 20);

  // Confidence decreases if covariance matrix is poorly conditioned
  // (This is a simplified check - could be more sophisticated)
  const matrixConfidence = model.covarianceInverse ? 1.0 : 0.5;

  return sampleConfidence * matrixConfidence;
}
