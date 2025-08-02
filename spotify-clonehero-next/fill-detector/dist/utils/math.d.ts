/**
 * Mathematical utilities for statistical analysis
 */
/**
 * Calculates the mean of an array of numbers
 */
export declare function mean(values: number[]): number;
/**
 * Calculates the standard deviation of an array of numbers
 */
export declare function standardDeviation(values: number[]): number;
/**
 * Calculates the z-score for a value given a mean and standard deviation
 */
export declare function zScore(value: number, mean: number, stdDev: number): number;
/**
 * Calculates z-scores for an array of values
 */
export declare function zScores(values: number[]): number[];
/**
 * Calculates the covariance matrix for a 2D array of features
 * Each row is an observation, each column is a feature
 */
export declare function covarianceMatrix(data: number[][]): number[][];
/**
 * Inverts a matrix using Gaussian elimination
 * Returns null if matrix is singular
 */
export declare function invertMatrix(matrix: number[][]): number[][] | null;
/**
 * Calculates the Mahalanobis distance
 */
export declare function mahalanobisDistance(point: number[], mean: number[], covarianceInverse: number[][]): number;
/**
 * Creates a diagonal matrix with given values
 */
export declare function diagonalMatrix(values: number[]): number[][];
/**
 * Creates an identity matrix of given size
 */
export declare function identityMatrix(size: number): number[][];
/**
 * Regularizes a covariance matrix by adding small values to diagonal
 * This prevents singular matrices
 */
export declare function regularizeCovariance(cov: number[][], regularization?: number): number[][];
/**
 * Calculates rolling mean with specified window size
 */
export declare function rollingMean(values: number[], windowSize: number): number[];
/**
 * Calculates rolling standard deviation with specified window size
 */
export declare function rollingStdDev(values: number[], windowSize: number): number[];
/**
 * Clamps a value between min and max
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Linear interpolation between two values
 */
export declare function lerp(a: number, b: number, t: number): number;
/**
 * Calculates the median of an array of numbers
 */
export declare function median(values: number[]): number;
/**
 * Calculates the inter-quartile range (IQR)
 */
export declare function interQuartileRange(values: number[]): number;
/**
 * Detects outliers using IQR method
 */
export declare function detectOutliers(values: number[], multiplier?: number): boolean[];
//# sourceMappingURL=math.d.ts.map