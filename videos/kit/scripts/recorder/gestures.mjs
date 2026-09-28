// Scripted pointer and keyboard input, placed on film frames.
//
// A plan is a list of steps (glide, press, release, key, wheel, park, call).
// Targets are functions of the live app state (whatever the take's `live`
// expression reads from the page that frame), so a drag lands on what the
// app drew, not on a guessed pixel. Glides ease with the kit's easings
// (src/motion). The executor turns the plan into CDP input events frame by
// frame and records where the pointer was, which the manifest exports so a
// film can draw its own cursor over the recording.

import {toFrames} from '../../src/format/format.ts';
import {inOutCubic, linear} from '../../src/motion/easing.ts';
import {pressKey} from './session.mjs';

/** How long a click holds the button, and a drag holds still before its release. */
const CLICK_HOLD_SEC = 0.05;
const DRAG_HOLD_SEC = 0.03;

export class Plan {
  /** `fps`: the take's frame rate, which the default holds are converted with. */
  constructor({fps}) {
    if (!(fps > 0)) throw new Error(`a Plan needs the take's fps, got ${fps}`);
    this.fps = fps;
    this.steps = [];
    this.notes = [];
  }
  /** Whole frames (at least one) lasting `sec`. */
  framesOf(sec) {
    return Math.max(1, Math.round(toFrames(sec, this.fps)));
  }
  /** Describe an interaction for the manifest (frames are film frames). */
  note(from, to, kind, description) {
    this.notes.push({from, to, kind, description});
    return this;
  }
  /** Glide the pointer from wherever it is at `from` to `target` by `to`, eased by `ease` (a kit easing). */
  glide(target, from, to, ease = inOutCubic) {
    if (typeof ease !== 'function')
      throw new Error(
        `glide takes an easing function (src/motion), got ${ease}`,
      );
    this.steps.push({kind: 'glide', target, from, to, ease});
    return this;
  }
  /** Jump the pointer to `target` (no travel). */
  place(target, frame) {
    this.steps.push({
      kind: 'glide',
      target,
      from: frame,
      to: frame,
      ease: linear,
    });
    return this;
  }
  press(frame, {button = 'left', modifiers = 0} = {}) {
    this.steps.push({kind: 'press', from: frame, to: frame, button, modifiers});
    return this;
  }
  release(frame, {button = 'left', modifiers = 0} = {}) {
    this.steps.push({
      kind: 'release',
      from: frame,
      to: frame,
      button,
      modifiers,
    });
    return this;
  }
  /**
   * Press on `fromTarget`, drag to `toTarget` (eased), hold still for
   * `holdFrames` (default 0.03 s), release on `releaseFrame`.
   */
  drag(
    fromTarget,
    toTarget,
    pressFrame,
    releaseFrame,
    {
      ease = inOutCubic,
      modifiers = 0,
      holdFrames = this.framesOf(DRAG_HOLD_SEC),
    } = {},
  ) {
    this.place(fromTarget, pressFrame);
    this.press(pressFrame, {modifiers});
    this.glide(toTarget, pressFrame + 1, releaseFrame - holdFrames, ease);
    this.release(releaseFrame, {modifiers});
    return this;
  }
  /** Click `target` on `frame`, holding the button `holdFrames` (default 0.05 s). */
  click(
    target,
    frame,
    {holdFrames = this.framesOf(CLICK_HOLD_SEC), modifiers = 0} = {},
  ) {
    this.place(target, frame);
    this.press(frame, {modifiers});
    this.release(frame + holdFrames, {modifiers});
    return this;
  }
  key(frame, key, {modifiers = 0, code, keyCode, text} = {}) {
    this.steps.push({
      kind: 'key',
      from: frame,
      to: frame,
      key,
      modifiers,
      code,
      keyCode,
      text,
    });
    return this;
  }
  /** A wheel event over `target`; deltas may be functions of the live state. */
  wheel(frame, target, {deltaX = 0, deltaY = 0, hidden = false} = {}) {
    this.steps.push({
      kind: 'wheel',
      from: frame,
      to: frame,
      target,
      deltaX,
      deltaY,
      hidden,
    });
    return this;
  }
  /** Send the pointer back to its parking spot off the app. */
  park(frame) {
    this.steps.push({kind: 'park', from: frame, to: frame});
    return this;
  }
  /** Run harness code `fn(page, live)` on a frame (after input, before the paint). */
  call(frame, fn) {
    this.steps.push({kind: 'call', from: frame, to: frame, fn});
    return this;
  }
  /** Whether any step on frame `f` reads the live state. */
  needsLive(f) {
    return this.steps.some(
      s =>
        s.from <= f &&
        f <= s.to &&
        (s.kind === 'glide' || s.kind === 'wheel' || s.kind === 'call'),
    );
  }
}

/**
 * Drives a Plan against a page. Call `frame(f, live)` once per film frame,
 * in order, after the clock has advanced and before the frame is painted.
 * The pointer starts parked at `parkAt` ({x, y} CSS px, see `parkPoint`).
 */
export class Executor {
  constructor(page, plan, parkAt) {
    this.page = page;
    this.plan = plan;
    this.parkAt = {...parkAt};
    this.pos = {...parkAt};
    this.parked = true;
    this.down = null; // button held
    this.glideStart = new Map(); // step -> start position
    this.lastSent = null;
  }

  async mouse(type, extra = {}) {
    const held = this.down;
    const params = {
      type,
      x: this.pos.x,
      y: this.pos.y,
      modifiers: extra.modifiers ?? 0,
      button:
        extra.button ?? (type === 'mouseMoved' ? (held ?? 'none') : 'left'),
      buttons: extra.buttons ?? (held ? 1 : 0),
      clickCount: extra.clickCount ?? (type === 'mouseMoved' ? 0 : 1),
      pointerType: 'mouse',
    };
    if (type === 'mouseWheel') {
      params.deltaX = extra.deltaX ?? 0;
      params.deltaY = extra.deltaY ?? 0;
    }
    await this.page.send('Input.dispatchMouseEvent', params);
    this.lastSent = {x: this.pos.x, y: this.pos.y};
  }

  /** Dispatch everything the plan puts on frame `f`. Returns the pointer state. */
  async frame(f, live) {
    const events = [];
    const active = this.plan.steps.filter(s => s.from <= f && f <= s.to);
    // Position first (glides), then buttons/keys/wheels in plan order.
    let moved = false;
    for (const step of active.filter(s => s.kind === 'glide')) {
      if (!this.glideStart.has(step)) this.glideStart.set(step, {...this.pos});
      const start = this.glideStart.get(step);
      const end = step.target(live);
      const span = step.to - step.from;
      const t = span <= 0 ? 1 : (f - step.from) / span;
      const e = step.ease(Math.min(1, Math.max(0, t)));
      this.pos = {
        x: start.x + (end.x - start.x) * e,
        y: start.y + (end.y - start.y) * e,
      };
      this.parked = false;
      moved = true;
    }
    if (
      moved &&
      (!this.lastSent ||
        this.lastSent.x !== this.pos.x ||
        this.lastSent.y !== this.pos.y)
    ) {
      await this.mouse('mouseMoved');
      events.push('move');
    }
    for (const step of active) {
      switch (step.kind) {
        case 'press':
          this.down = step.button;
          await this.mouse('mousePressed', {
            button: step.button,
            buttons: 1,
            clickCount: 1,
            modifiers: step.modifiers,
          });
          events.push('press');
          break;
        case 'release':
          this.down = null;
          await this.mouse('mouseReleased', {
            button: step.button,
            buttons: 0,
            clickCount: 1,
            modifiers: step.modifiers,
          });
          events.push('release');
          break;
        case 'wheel': {
          if (step.target) {
            this.pos = step.target(live);
            // A hidden wheel is a setup scroll: the exported pointer stays
            // where it was (parked stays parked).
            if (!step.hidden) this.parked = false;
          }
          const value = d => (typeof d === 'function' ? d(live) : d);
          await this.mouse('mouseWheel', {
            deltaX: value(step.deltaX),
            deltaY: value(step.deltaY),
            button: 'none',
            buttons: 0,
            clickCount: 0,
          });
          events.push('wheel');
          break;
        }
        case 'park':
          this.pos = {...this.parkAt};
          this.parked = true;
          await this.mouse('mouseMoved');
          events.push('park');
          break;
        case 'key':
          await pressKey(this.page, step.key, step);
          events.push(
            `key:${step.modifiers ? step.modifiers + '+' : ''}${step.key}`,
          );
          break;
        case 'call':
          await step.fn(this.page, live);
          events.push('call');
          break;
        default:
          break;
      }
    }
    return {
      x: this.pos.x,
      y: this.pos.y,
      down: Boolean(this.down),
      parked: this.parked,
      events,
    };
  }
}
