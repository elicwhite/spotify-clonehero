/**
 * Candidate window detection using threshold-based rules
 */
/**
 * Applies threshold-based rules to identify fill candidate windows
 */
export function detectCandidateWindows(windows, config) {
    const updatedWindows = windows.map(window => {
        const result = evaluateWindow(window, config);
        return {
            ...window,
            isCandidate: result.isCandidate,
        };
    });
    return updatedWindows;
}
/**
 * Evaluates a single window against detection criteria
 */
export function evaluateWindow(window, config) {
    const features = window.features;
    const thresholds = config.thresholds || {};
    const reasons = [];
    let confidence = 0;
    // Primary detection criteria (from design document)
    let primaryMatch = false;
    // Rule 1: High density + groove deviation
    if (features.densityZ > (thresholds.densityZ || 1.2) && features.grooveDist > (thresholds.dist || 2.0)) {
        reasons.push('High density with groove deviation');
        confidence += 0.4;
        primaryMatch = true;
    }
    // Rule 2: Tom ratio jump
    if (features.tomRatioJump > (thresholds.tomJump || 1.5)) {
        reasons.push('Tom ratio spike');
        confidence += 0.3;
        primaryMatch = true;
    }
    // Rule 3: Fallback - very high absolute density (for early song detection)
    if (features.noteDensity > 8) { // 8+ notes per beat is very dense
        reasons.push('Very high absolute density');
        confidence += 0.4;
        primaryMatch = true;
    }
    // Rule 4: Fallback - high tom content without comparison
    if (features.noteDensity > 4 && window.notes.length > 0) {
        const tomCount = window.notes.filter(n => n.type === 3 || n.type === 5).length; // Tom notes
        const tomRatio = tomCount / window.notes.length;
        if (tomRatio > 0.6) { // 60%+ toms
            reasons.push('High tom content');
            confidence += 0.3;
            primaryMatch = true;
        }
    }
    // Secondary criteria (bonus scoring but not mandatory)
    if (features.hatDropout > 0.5) {
        reasons.push('Hat dropout');
        confidence += 0.1;
    }
    if (features.kickDrop > 0.3) {
        reasons.push('Kick drop');
        confidence += 0.1;
    }
    if (features.ioiStdZ > 1.5) {
        reasons.push('Irregular timing');
        confidence += 0.1;
    }
    if (features.ngramNovelty > 0) {
        reasons.push('Novel patterns');
        confidence += 0.1;
    }
    if (features.samePadBurst) {
        reasons.push('Same pad burst');
        confidence += 0.2;
    }
    if (features.crashResolve) {
        reasons.push('Crash resolution');
        confidence += 0.1;
    }
    // Apply additional heuristics
    const heuristicBonus = applyAdditionalHeuristics(window, config);
    confidence += heuristicBonus.confidenceBonus;
    reasons.push(...heuristicBonus.reasons);
    // Clamp confidence to [0, 1]
    confidence = Math.min(1, Math.max(0, confidence));
    return {
        isCandidate: primaryMatch,
        reasons,
        confidence,
    };
}
/**
 * Applies additional heuristic rules beyond the basic thresholds
 */
function applyAdditionalHeuristics(window, config) {
    const features = window.features;
    const reasons = [];
    let confidenceBonus = 0;
    // Very high density is almost certainly a fill
    if (features.noteDensity > 8) { // 8 hits per beat is very dense
        reasons.push('Extremely high density');
        confidenceBonus += 0.3;
    }
    // Combination rules
    if (features.densityZ > 0.8 && features.tomRatioJump > 1.2) {
        reasons.push('Density + tom combo');
        confidenceBonus += 0.2;
    }
    if (features.hatDropout > 0.3 && features.kickDrop > 0.2) {
        reasons.push('Rhythm section dropout');
        confidenceBonus += 0.15;
    }
    if (features.samePadBurst && features.ioiStdZ > 1.0) {
        reasons.push('Complex burst pattern');
        confidenceBonus += 0.2;
    }
    // Penalize very low activity (likely not a fill)
    if (features.noteDensity < 1.0 && features.grooveDist < 1.0) {
        reasons.push('Low activity penalty');
        confidenceBonus -= 0.2;
    }
    return { confidenceBonus, reasons };
}
/**
 * Applies post-processing rules to refine candidate detection
 */
export function postProcessCandidates(windows, config) {
    let processedWindows = [...windows];
    // Remove isolated single candidates (likely false positives)
    processedWindows = removeIsolatedCandidates(processedWindows);
    // Apply temporal constraints
    processedWindows = applyTemporalConstraints(processedWindows, config);
    return processedWindows;
}
/**
 * Removes isolated candidate windows that are likely false positives
 */
function removeIsolatedCandidates(windows) {
    const result = [...windows];
    for (let i = 0; i < result.length; i++) {
        if (!result[i].isCandidate)
            continue;
        // Check if this candidate has neighbors
        const hasLeftNeighbor = i > 0 && result[i - 1].isCandidate;
        const hasRightNeighbor = i < result.length - 1 && result[i + 1].isCandidate;
        // If isolated and not extremely confident, remove
        if (!hasLeftNeighbor && !hasRightNeighbor) {
            // Only keep if very high confidence or density
            const features = result[i].features;
            const isHighConfidence = features.densityZ > 2.0 || features.noteDensity > 10;
            if (!isHighConfidence) {
                result[i] = { ...result[i], isCandidate: false };
            }
        }
    }
    return result;
}
/**
 * Applies temporal constraints based on musical structure
 */
function applyTemporalConstraints(windows, config) {
    const result = [...windows];
    // Group consecutive candidates
    const candidateGroups = [];
    let currentGroup = [];
    for (let i = 0; i < result.length; i++) {
        if (result[i].isCandidate) {
            currentGroup.push(i);
        }
        else {
            if (currentGroup.length > 0) {
                candidateGroups.push(currentGroup);
                currentGroup = [];
            }
        }
    }
    if (currentGroup.length > 0) {
        candidateGroups.push(currentGroup);
    }
    // Apply constraints to each group
    for (const group of candidateGroups) {
        if (group.length === 0)
            continue;
        const startWindow = result[group[0]];
        const endWindow = result[group[group.length - 1]];
        const durationBeats = (endWindow.endTick - startWindow.startTick) /
            (startWindow.endTick - startWindow.startTick); // Approximate
        // Remove groups that are too short or too long
        if (durationBeats < config.thresholds.minBeats || durationBeats > config.thresholds.maxBeats) {
            for (const windowIndex of group) {
                result[windowIndex] = { ...result[windowIndex], isCandidate: false };
            }
        }
    }
    return result;
}
/**
 * Gets statistics about candidate detection results
 */
export function getCandidateStatistics(windows) {
    const totalWindows = windows.length;
    const candidateWindows = windows.filter(w => w.isCandidate).length;
    const candidateRatio = totalWindows > 0 ? candidateWindows / totalWindows : 0;
    // Calculate average confidence (would need to store this info)
    const averageConfidence = 0; // Placeholder - would need to modify data structure
    // Count candidate groups
    let candidateGroups = 0;
    let inGroup = false;
    for (const window of windows) {
        if (window.isCandidate && !inGroup) {
            candidateGroups++;
            inGroup = true;
        }
        else if (!window.isCandidate) {
            inGroup = false;
        }
    }
    return {
        totalWindows,
        candidateWindows,
        candidateRatio,
        averageConfidence,
        candidateGroups,
    };
}
/**
 * Validates detection parameters
 */
export function validateDetectionConfig(config) {
    const errors = [];
    const t = config.thresholds;
    if (t.densityZ <= 0) {
        errors.push('densityZ threshold must be positive');
    }
    if (t.dist <= 0) {
        errors.push('dist threshold must be positive');
    }
    if (t.tomJump <= 1) {
        errors.push('tomJump threshold should be > 1 (ratio multiplier)');
    }
    if (t.minBeats <= 0) {
        errors.push('minBeats must be positive');
    }
    if (t.maxBeats <= t.minBeats) {
        errors.push('maxBeats must be greater than minBeats');
    }
    if (t.mergeGapBeats < 0) {
        errors.push('mergeGapBeats must be non-negative');
    }
    if (t.burstMs <= 0) {
        errors.push('burstMs must be positive');
    }
    return errors;
}
/**
 * Creates a debug report for candidate detection
 */
export function createDetectionReport(windows, config) {
    const stats = getCandidateStatistics(windows);
    const configErrors = validateDetectionConfig(config);
    let report = '=== Fill Detection Report ===\n\n';
    report += `Total Windows: ${stats.totalWindows}\n`;
    report += `Candidate Windows: ${stats.candidateWindows}\n`;
    report += `Candidate Ratio: ${(stats.candidateRatio * 100).toFixed(1)}%\n`;
    report += `Candidate Groups: ${stats.candidateGroups}\n\n`;
    if (configErrors.length > 0) {
        report += 'Configuration Errors:\n';
        for (const error of configErrors) {
            report += `  - ${error}\n`;
        }
        report += '\n';
    }
    report += 'Thresholds Used:\n';
    report += `  Density Z-Score: ${config.thresholds.densityZ}\n`;
    report += `  Groove Distance: ${config.thresholds.dist}\n`;
    report += `  Tom Jump Ratio: ${config.thresholds.tomJump}\n`;
    report += `  Duration Range: ${config.thresholds.minBeats} - ${config.thresholds.maxBeats} beats\n`;
    return report;
}
//# sourceMappingURL=candidateMask.js.map