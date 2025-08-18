/**
 * Mathematical utilities for statistical analysis
 */

/**
 * Calculates the mean of an array of numbers
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculates the standard deviation of an array of numbers
 */
export function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;

  const avg = mean(values);
  const squaredDifferences = values.map(val => Math.pow(val - avg, 2));
  const variance = mean(squaredDifferences);

  return Math.sqrt(variance);
}

/**
 * Calculates the z-score for a value given a mean and standard deviation
 */
export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

/**
 * Calculates z-scores for an array of values
 */
export function zScores(values: number[]): number[] {
  const avg = mean(values);
  const stdDev = standardDeviation(values);

  return values.map(val => zScore(val, avg, stdDev));
}

/**
 * Calculates the covariance matrix for a 2D array of features
 * Each row is an observation, each column is a feature
 */
export function covarianceMatrix(data: number[][]): number[][] {
  if (data.length === 0) return [];

  const numFeatures = data[0].length;
  const numObservations = data.length;

  // Calculate means for each feature
  const means = new Array(numFeatures).fill(0);
  for (let i = 0; i < numObservations; i++) {
    for (let j = 0; j < numFeatures; j++) {
      means[j] += data[i][j];
    }
  }
  for (let j = 0; j < numFeatures; j++) {
    means[j] /= numObservations;
  }

  // Calculate covariance matrix
  const cov = Array(numFeatures)
    .fill(null)
    .map(() => Array(numFeatures).fill(0));

  for (let i = 0; i < numFeatures; i++) {
    for (let j = 0; j < numFeatures; j++) {
      let sum = 0;
      for (let k = 0; k < numObservations; k++) {
        sum += (data[k][i] - means[i]) * (data[k][j] - means[j]);
      }
      cov[i][j] = sum / (numObservations - 1);
    }
  }

  return cov;
}

/**
 * Inverts a matrix using Gaussian elimination
 * Returns null if matrix is singular
 */
export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  if (n === 0 || matrix[0].length !== n) {
    throw new Error('Matrix must be square');
  }

  // Create augmented matrix [A|I]
  const augmented = matrix.map((row, i) => {
    const identity = new Array(n).fill(0);
    identity[i] = 1;
    return [...row, ...identity];
  });

  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }

    // Swap rows
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    // Check for singular matrix
    if (Math.abs(augmented[i][i]) < 1e-10) {
      return null;
    }

    // Make diagonal element 1
    const pivot = augmented[i][i];
    for (let j = 0; j < 2 * n; j++) {
      augmented[i][j] /= pivot;
    }

    // Eliminate column
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = augmented[k][i];
        for (let j = 0; j < 2 * n; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }
  }

  // Extract inverse matrix
  return augmented.map(row => row.slice(n));
}

/**
 * Calculates the Mahalanobis distance
 */
export function mahalanobisDistance(
  point: number[],
  mean: number[],
  covarianceInverse: number[][],
): number {
  if (
    point.length !== mean.length ||
    mean.length !== covarianceInverse.length
  ) {
    throw new Error('Dimension mismatch');
  }

  // Calculate (x - μ)
  const diff = point.map((val, i) => val - mean[i]);

  // Calculate (x - μ)ᵀ Σ⁻¹ (x - μ)
  let distance = 0;
  for (let i = 0; i < diff.length; i++) {
    for (let j = 0; j < diff.length; j++) {
      distance += diff[i] * covarianceInverse[i][j] * diff[j];
    }
  }

  return Math.sqrt(distance);
}

/**
 * Creates a diagonal matrix with given values
 */
export function diagonalMatrix(values: number[]): number[][] {
  const n = values.length;
  const matrix = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = values[i];
  }

  return matrix;
}

/**
 * Creates an identity matrix of given size
 */
export function identityMatrix(size: number): number[][] {
  return diagonalMatrix(new Array(size).fill(1));
}

/**
 * Regularizes a covariance matrix by adding small values to diagonal
 * This prevents singular matrices
 */
export function regularizeCovariance(
  cov: number[][],
  regularization = 1e-6,
): number[][] {
  const regularized = cov.map(row => [...row]);

  for (let i = 0; i < regularized.length; i++) {
    regularized[i][i] += regularization;
  }

  return regularized;
}

/**
 * Calculates rolling mean with specified window size
 */
export function rollingMean(values: number[], windowSize: number): number[] {
  if (windowSize <= 0 || windowSize > values.length) {
    throw new Error('Invalid window size');
  }

  const result: number[] = [];

  for (let i = 0; i <= values.length - windowSize; i++) {
    const window = values.slice(i, i + windowSize);
    result.push(mean(window));
  }

  return result;
}

/**
 * Calculates rolling standard deviation with specified window size
 */
export function rollingStdDev(values: number[], windowSize: number): number[] {
  if (windowSize <= 0 || windowSize > values.length) {
    throw new Error('Invalid window size');
  }

  const result: number[] = [];

  for (let i = 0; i <= values.length - windowSize; i++) {
    const window = values.slice(i, i + windowSize);
    result.push(standardDeviation(window));
  }

  return result;
}

/**
 * Clamps a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Calculates the median of an array of numbers
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

/**
 * Calculates the inter-quartile range (IQR)
 */
export function interQuartileRange(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);

  return sorted[q3Index] - sorted[q1Index];
}

/**
 * Detects outliers using IQR method
 */
export function detectOutliers(values: number[], multiplier = 1.5): boolean[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  return values.map(val => val < lowerBound || val > upperBound);
}
