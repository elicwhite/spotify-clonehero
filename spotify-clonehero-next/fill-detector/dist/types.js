/**
 * Type definitions for the drum fill extractor
 */
// Voice categories for drum mapping
export var DrumVoice;
(function (DrumVoice) {
    DrumVoice["KICK"] = "kick";
    DrumVoice["SNARE"] = "snare";
    DrumVoice["HAT"] = "hat";
    DrumVoice["TOM"] = "tom";
    DrumVoice["CYMBAL"] = "cymbal";
    DrumVoice["UNKNOWN"] = "unknown";
})(DrumVoice || (DrumVoice = {}));
// Custom error types
export class DrumTrackNotFoundError extends Error {
    constructor(difficulty) {
        super(`No drum track found for difficulty: ${difficulty}`);
        this.name = 'DrumTrackNotFoundError';
    }
}
export class InvalidConfigError extends Error {
    constructor(message) {
        super(`Invalid configuration: ${message}`);
        this.name = 'InvalidConfigError';
    }
}
//# sourceMappingURL=types.js.map