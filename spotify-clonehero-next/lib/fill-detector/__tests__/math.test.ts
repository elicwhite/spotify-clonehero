/**
 * Unit tests for mathematical utilities
 */

import {
  mean,
  standardDeviation,
  zScore,
  zScores,
  covarianceMatrix,
  invertMatrix,
  mahalanobisDistance,
  diagonalMatrix,
  identityMatrix,
  regularizeCovariance,
  rollingMean,
  rollingStdDev,
  clamp,
  lerp,
  median,
  interQuartileRange,
  detectOutliers,
} from '../utils/math';

describe('Mathematical Utilities', () => {
  describe('mean', () => {
    it('should calculate the mean of an array', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
      expect(mean([10, 20])).toBe(15);
      expect(mean([5])).toBe(5);
    });

    it('should return 0 for empty array', () => {
      expect(mean([])).toBe(0);
    });
  });

  describe('standardDeviation', () => {
    it('should calculate standard deviation', () => {
      const result = standardDeviation([1, 2, 3, 4, 5]);
      expect(result).toBeCloseTo(1.414, 2); // √2 ≈ 1.414
    });

    it('should return 0 for arrays with one or zero elements', () => {
      expect(standardDeviation([])).toBe(0);
      expect(standardDeviation([5])).toBe(0);
    });
  });

  describe('zScore', () => {
    it('should calculate z-score correctly', () => {
      expect(zScore(5, 3, 2)).toBe(1);
      expect(zScore(1, 3, 2)).toBe(-1);
      expect(zScore(3, 3, 2)).toBe(0);
    });

    it('should return 0 when standard deviation is 0', () => {
      expect(zScore(5, 3, 0)).toBe(0);
    });
  });

  describe('zScores', () => {
    it('should calculate z-scores for an array', () => {
      const values = [1, 2, 3, 4, 5];
      const scores = zScores(values);

      expect(scores).toHaveLength(5);
      expect(scores[2]).toBeCloseTo(0, 2); // Middle value should be ~0
      expect(scores[0]).toBeLessThan(0); // First value should be negative
      expect(scores[4]).toBeGreaterThan(0); // Last value should be positive
    });
  });

  describe('covarianceMatrix', () => {
    it('should calculate covariance matrix', () => {
      const data = [
        [1, 2],
        [3, 4],
        [5, 6],
      ];

      const cov = covarianceMatrix(data);
      expect(cov).toHaveLength(2);
      expect(cov[0]).toHaveLength(2);
      expect(cov[1]).toHaveLength(2);

      // Covariance matrix should be symmetric
      expect(cov[0][1]).toBeCloseTo(cov[1][0], 6);
    });

    it('should return empty array for empty data', () => {
      expect(covarianceMatrix([])).toEqual([]);
    });
  });

  describe('invertMatrix', () => {
    it('should invert a 2x2 matrix', () => {
      const matrix = [
        [4, 2],
        [7, 6],
      ];

      const inverse = invertMatrix(matrix);
      expect(inverse).not.toBeNull();

      if (inverse) {
        // Multiply matrix by its inverse should give identity matrix
        const product = [
          [0, 0],
          [0, 0],
        ];

        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            for (let k = 0; k < 2; k++) {
              product[i][j] += matrix[i][k] * inverse[k][j];
            }
          }
        }

        expect(product[0][0]).toBeCloseTo(1, 6);
        expect(product[1][1]).toBeCloseTo(1, 6);
        expect(product[0][1]).toBeCloseTo(0, 6);
        expect(product[1][0]).toBeCloseTo(0, 6);
      }
    });

    it('should return null for singular matrix', () => {
      const singularMatrix = [
        [1, 2],
        [2, 4], // Second row is multiple of first
      ];

      expect(invertMatrix(singularMatrix)).toBeNull();
    });
  });

  describe('mahalanobisDistance', () => {
    it('should calculate Mahalanobis distance', () => {
      const point = [1, 2];
      const mean = [0, 0];
      const covInverse = [
        [1, 0],
        [0, 1],
      ]; // Identity matrix

      const distance = mahalanobisDistance(point, mean, covInverse);
      expect(distance).toBeCloseTo(Math.sqrt(5), 6);
    });

    it('should throw error for dimension mismatch', () => {
      expect(() => {
        mahalanobisDistance([1, 2], [0], [[1]]);
      }).toThrow('Dimension mismatch');
    });
  });

  describe('identityMatrix', () => {
    it('should create identity matrix', () => {
      const identity = identityMatrix(3);

      expect(identity).toHaveLength(3);
      expect(identity[0]).toEqual([1, 0, 0]);
      expect(identity[1]).toEqual([0, 1, 0]);
      expect(identity[2]).toEqual([0, 0, 1]);
    });
  });

  describe('diagonalMatrix', () => {
    it('should create diagonal matrix', () => {
      const diagonal = diagonalMatrix([1, 2, 3]);

      expect(diagonal).toHaveLength(3);
      expect(diagonal[0]).toEqual([1, 0, 0]);
      expect(diagonal[1]).toEqual([0, 2, 0]);
      expect(diagonal[2]).toEqual([0, 0, 3]);
    });
  });

  describe('regularizeCovariance', () => {
    it('should add regularization to diagonal', () => {
      const matrix = [
        [1, 0.5],
        [0.5, 1],
      ];

      const regularized = regularizeCovariance(matrix, 0.1);

      expect(regularized[0][0]).toBe(1.1);
      expect(regularized[1][1]).toBe(1.1);
      expect(regularized[0][1]).toBe(0.5);
      expect(regularized[1][0]).toBe(0.5);
    });
  });

  describe('rollingMean', () => {
    it('should calculate rolling mean', () => {
      const values = [1, 2, 3, 4, 5];
      const rolling = rollingMean(values, 3);

      expect(rolling).toHaveLength(3);
      expect(rolling[0]).toBe(2); // (1+2+3)/3
      expect(rolling[1]).toBe(3); // (2+3+4)/3
      expect(rolling[2]).toBe(4); // (3+4+5)/3
    });

    it('should throw error for invalid window size', () => {
      expect(() => rollingMean([1, 2, 3], 0)).toThrow('Invalid window size');
      expect(() => rollingMean([1, 2, 3], 5)).toThrow('Invalid window size');
    });
  });

  describe('clamp', () => {
    it('should clamp values to range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('lerp', () => {
    it('should interpolate between values', () => {
      expect(lerp(0, 10, 0)).toBe(0);
      expect(lerp(0, 10, 1)).toBe(10);
      expect(lerp(0, 10, 0.5)).toBe(5);
    });
  });

  describe('median', () => {
    it('should calculate median for odd length array', () => {
      expect(median([1, 3, 2])).toBe(2);
      expect(median([5, 1, 3, 9, 7])).toBe(5);
    });

    it('should calculate median for even length array', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('should return 0 for empty array', () => {
      expect(median([])).toBe(0);
    });
  });

  describe('interQuartileRange', () => {
    it('should calculate IQR', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const iqr = interQuartileRange(values);
      expect(iqr).toBeGreaterThan(0);
    });

    it('should return 0 for empty array', () => {
      expect(interQuartileRange([])).toBe(0);
    });
  });

  describe('detectOutliers', () => {
    it('should detect outliers using IQR method', () => {
      const values = [1, 2, 3, 4, 5, 100]; // 100 is an outlier
      const outliers = detectOutliers(values);

      expect(outliers).toHaveLength(6);
      expect(outliers[5]).toBe(true); // Last value should be detected as outlier
    });
  });
});
