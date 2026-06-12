import {
  initialTempoPct,
  nextTempoPct,
  isSpeedTrainerComplete,
  SpeedAttempt,
  DEFAULT_SPEED_TRAINER_OPTIONS,
} from '../speedTrainer';

const P: SpeedAttempt = {passed: true};
const F: SpeedAttempt = {passed: false};

describe('speedTrainer', () => {
  it('starts at 70%', () => {
    expect(initialTempoPct()).toBe(70);
  });

  it('steps up +5 after 3 consecutive passes', () => {
    expect(nextTempoPct(70, [P, P, P])).toBe(75);
  });

  it('does not step up before 3 passes', () => {
    expect(nextTempoPct(70, [P, P])).toBe(70);
  });

  it('only counts the trailing run', () => {
    // A fail then 2 passes is not yet a 3-pass run.
    expect(nextTempoPct(70, [P, F, P, P])).toBe(70);
    // 3 fresh passes after earlier fail does step up.
    expect(nextTempoPct(70, [F, P, P, P])).toBe(75);
  });

  it('steps down after 3 consecutive fails', () => {
    expect(nextTempoPct(85, [F, F, F])).toBe(82);
  });

  it('caps at maxTempoPct (default 110)', () => {
    expect(nextTempoPct(110, [P, P, P])).toBe(110);
    expect(nextTempoPct(108, [P, P, P])).toBe(110);
    expect(DEFAULT_SPEED_TRAINER_OPTIONS.maxTempoPct).toBe(110);
  });

  it('floors at minTempoPct', () => {
    expect(nextTempoPct(51, [F, F, F])).toBe(50);
    expect(nextTempoPct(50, [F, F, F])).toBe(50);
  });

  it('honours a custom cap', () => {
    expect(nextTempoPct(100, [P, P, P], {maxTempoPct: 100})).toBe(100);
    expect(nextTempoPct(98, [P, P, P], {maxTempoPct: 120})).toBe(103);
  });

  it('empty history leaves tempo unchanged', () => {
    expect(nextTempoPct(70, [])).toBe(70);
  });

  it('isSpeedTrainerComplete requires full speed + a passing run', () => {
    expect(isSpeedTrainerComplete(100, [P, P, P])).toBe(true);
    expect(isSpeedTrainerComplete(95, [P, P, P])).toBe(false);
    expect(isSpeedTrainerComplete(100, [P, P])).toBe(false);
    expect(isSpeedTrainerComplete(110, [F, P, P, P])).toBe(true);
  });
});
