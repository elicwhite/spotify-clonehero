// A virtual clock for recording a web app frame by frame.
//
// Injected with Page.addScriptToEvaluateOnNewDocument, so it runs before any
// page script. Until the harness calls `__recClock.enter()` every API behaves
// normally (the page loads, decodes audio, and so on in real time). After
// `enter()`, time only moves when the harness says so:
//
// - performance.now() returns the virtual time. `enter({at})` starts it at
//   `at` ms: a fixed start makes takes byte-identical even for pages that
//   draw from absolute timestamps (a canvas loop spinning by its rAF time).
// - The date is fixed too: Date.now(), `new Date()` and `Date()` read the
//   harness's date base (`window.__recClockConfig.dateBaseMs`, the date
//   when the tab opened) plus the time since. Before `enter()` that is real
//   time since the tab opened (`realAnchorMs`), so the date runs on through
//   the page's reloads; from `enter({at})` on it is `at` plus virtual time,
//   so a page shows the same dates in every take, and never the real one.
//   (Without a config: the real date.)
// - Timers and animation frames the page scheduled before `enter()` move onto
//   the virtual clock, so nothing the page queued fires on real time during a
//   take. A moved timer restarts there: a timeout fires its whole delay after
//   `enter()`, an interval ticks from `enter()`. (What was left of them in
//   real time depends on how long setup took, which differs between takes.)
//   What the page did in real time before `enter()` stays done: state it
//   built from real time (a count of ticks, say) differs between takes.
// - requestAnimationFrame callbacks queue up and run once per `frame()`, with
//   the virtual frame time as their timestamp. They run inside a real
//   animation frame (one real rAF per queued callback), so the browser's own
//   rendering pipeline paints what they draw, exactly as in live playback.
// - setTimeout / setInterval fire when the virtual time passes their due
//   time, each as its own task, in due-time order.
// - Every AudioContext gets a virtual `state` and `currentTime`: resume() and
//   suspend() flip the virtual state without touching the real context (so
//   nothing is heard), and currentTime advances with the virtual clock while
//   the virtual state is "running". At `enter()` every context reads
//   `at / 1000` (as if it had run since the page's clock read 0, which never
//   moves its time back); a context created later starts suspended at 0.
//   Output latency reads as 0, because a film's soundtrack is aligned to the
//   app's time exactly.
// - CSS transitions and animations (and any Web Animation) are paused and
//   seeked to the virtual time elapsed since they started.
//
// What it does NOT cover (all of these still run on real time):
//
// - Web Workers (and SharedWorkers, worklets): their clocks and timers are
//   their own, and their messages arrive whenever they are posted. The
//   worker gate below holds one worker's messages for the harness to hand
//   over on planned frames.
// - requestIdleCallback: callbacks run whenever the real browser is idle.
// - Media elements (<video>, <audio>): currentTime and playback advance in
//   real time; the harness has to seek them itself if a take shows one.
// - `performance.timeOrigin`, `Event.timeStamp` and
//   `document.timeline.currentTime` read the real clock.
// - Audio rendering: a real AudioContext is suspended on `enter()`, so
//   nothing is heard and AudioWorklets do not run.
// - Animations the page drives from any of the above.
//
// The harness drives it per film frame: `advance(ms)` (fires due timers),
// then its input events, then `frame()` (rAF callbacks, settle, paint). A
// frame the browser did not paint in time (a hidden or throttled window)
// still runs, and is reported through `errors()`. Nothing here knows about
// any particular app.

(() => {
  'use strict';
  if (window.__recClock) return;

  const config = window.__recClockConfig || {};
  delete window.__recClockConfig;

  const perf = window.performance;
  const realNow = perf.now.bind(perf);
  const RealDate = window.Date;
  const realDateNow = RealDate.now.bind(RealDate);
  /** The page's date when the tab opened, and the real date then. */
  const DATE_BASE = Number.isFinite(config.dateBaseMs)
    ? config.dateBaseMs
    : realDateNow();
  const REAL_ANCHOR = Number.isFinite(config.realAnchorMs)
    ? config.realAnchorMs
    : DATE_BASE;
  /** Real ms since the tab opened: it runs on through reloads. */
  const sinceOpen = () => realDateNow() - REAL_ANCHOR;
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);

  // Handles at or above this belong to the virtual queues. Chrome's own
  // timer and rAF handles are small positive integers.
  const VIRTUAL_ID = 1e9;

  const s = {
    virtual: false,
    now: 0, // virtual performance.now(), ms
    frames: 0,
    rafs: new Map(), // id -> callback, for the next frame (insertion order)
    running: new Map(), // id -> callback, the frame being flushed
    nextRaf: VIRTUAL_ID,
    timers: new Map(), // id -> {due, fn, args, every, seq}
    nextTimer: VIRTUAL_ID,
    realRafs: new Map(), // real id -> callback, queued before enter()
    realTimers: new Map(), // real id -> {delay, fn, args, every}
    seq: 0,
    errors: [],
    animations: new WeakMap(), // Animation -> virtual ms it started at
    contexts: [], // WeakRef<AudioContext>
    audio: new WeakMap(), // AudioContext -> {state, base, since}
  };

  const report = (where, error) => {
    s.errors.push(
      `${where}: ${error && error.stack ? error.stack : String(error)}`.slice(
        0,
        2000,
      ),
    );
    // Surface it the way the browser would, without breaking our loop.
    realSetTimeout(() => {
      throw error;
    }, 0);
  };

  // A macrotask boundary: lets queued tasks (React's scheduler posts to a
  // MessageChannel) and every microtask run, like a real turn of the loop.
  const channel = new MessageChannel();
  const waiting = [];
  channel.port1.onmessage = () => {
    const resolve = waiting.shift();
    if (resolve) resolve();
  };
  const macrotask = () =>
    new Promise(resolve => {
      waiting.push(resolve);
      channel.port2.postMessage(0);
    });
  /** A problem the harness should hear about that is not a page error. */
  const note = message => s.errors.push(message.slice(0, 2000));
  const realFrame = () =>
    new Promise(resolve => {
      const timer = realSetTimeout(() => {
        note(
          `frame ${s.frames}: no real animation frame came within 1 s (hidden or throttled window?); went on without the paint`,
        );
        resolve();
      }, 1000);
      realRAF(() => {
        realClearTimeout(timer);
        resolve();
      });
    });

  // -------------------------------------------------------------------------
  // performance.now and the date
  // -------------------------------------------------------------------------

  perf.now = function now() {
    return s.virtual ? s.now : realNow();
  };

  const dateNow = () =>
    Math.floor(DATE_BASE + (s.virtual ? s.now : sinceOpen()));
  // `Date()` and `new Date()` read the fixed date; with arguments, and as a
  // prototype, it is the real Date.
  function Date(...args) {
    if (!new.target) return new RealDate(dateNow()).toString();
    return Reflect.construct(
      RealDate,
      args.length === 0 ? [dateNow()] : args,
      new.target,
    );
  }
  Object.setPrototypeOf(Date, RealDate);
  Date.prototype = RealDate.prototype;
  Date.now = dateNow;
  Object.defineProperty(Date, 'length', {value: RealDate.length});
  Object.defineProperty(RealDate.prototype, 'constructor', {
    value: Date,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  window.Date = Date;

  // -------------------------------------------------------------------------
  // requestAnimationFrame
  // -------------------------------------------------------------------------

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!s.virtual) {
      const id = realRAF(ts => {
        s.realRafs.delete(id);
        callback(ts);
      });
      s.realRafs.set(id, callback);
      return id;
    }
    const id = ++s.nextRaf;
    s.rafs.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const queued = s.rafs.delete(id);
    const running = s.running.delete(id);
    if (queued || running) return;
    s.realRafs.delete(id);
    realCAF(id);
  };

  // -------------------------------------------------------------------------
  // setTimeout / setInterval
  // -------------------------------------------------------------------------

  const callable = fn =>
    typeof fn === 'function' ? fn : new Function(String(fn));
  // Browsers clamp repeating timers; a 0 ms interval must not spin.
  const repeatEvery = (delay, repeat) => (repeat ? Math.max(4, delay) : null);

  const addTimer = (fn, ms, args, repeat) => {
    const delay = Math.max(0, Number(ms) || 0);
    const id = ++s.nextTimer;
    s.timers.set(id, {
      due: s.now + delay,
      fn: callable(fn),
      args,
      every: repeatEvery(delay, repeat),
      seq: ++s.seq,
    });
    return id;
  };
  // Before enter(): a real timer, remembered so enter() can move it.
  const addRealTimer = (fn, ms, args, repeat) => {
    const delay = Math.max(0, Number(ms) || 0);
    const entry = {
      delay,
      fn: callable(fn),
      args,
      every: repeatEvery(delay, repeat),
    };
    const run = () => {
      if (entry.every === null) s.realTimers.delete(id);
      entry.fn.apply(window, entry.args);
    };
    const id = repeat
      ? realSetInterval(run, delay)
      : realSetTimeout(run, delay);
    s.realTimers.set(id, entry);
    return id;
  };
  window.setTimeout = function setTimeout(fn, ms, ...args) {
    return s.virtual
      ? addTimer(fn, ms, args, false)
      : addRealTimer(fn, ms, args, false);
  };
  window.setInterval = function setInterval(fn, ms, ...args) {
    return s.virtual
      ? addTimer(fn, ms, args, true)
      : addRealTimer(fn, ms, args, true);
  };
  window.clearTimeout = function clearTimeout(id) {
    if (s.timers.delete(id)) return;
    s.realTimers.delete(id);
    realClearTimeout(id);
  };
  window.clearInterval = function clearInterval(id) {
    if (s.timers.delete(id)) return;
    s.realTimers.delete(id);
    realClearInterval(id);
  };

  /** Move what the page queued on real time onto the virtual clock, restarted. */
  const adoptRealQueues = () => {
    for (const [id, t] of s.realTimers) {
      realClearTimeout(id);
      s.timers.set(id, {
        due: s.now + (t.every ?? t.delay),
        fn: t.fn,
        args: t.args,
        every: t.every,
        seq: ++s.seq,
      });
    }
    s.realTimers.clear();
    for (const [id, callback] of s.realRafs) {
      realCAF(id);
      s.rafs.set(id, callback);
    }
    s.realRafs.clear();
  };

  const nextDueTimer = limit => {
    let best = null;
    for (const [id, t] of s.timers) {
      if (t.due > limit) continue;
      if (
        !best ||
        t.due < best.t.due ||
        (t.due === best.t.due && t.seq < best.t.seq)
      ) {
        best = {id, t};
      }
    }
    return best;
  };

  // -------------------------------------------------------------------------
  // AudioContext
  // -------------------------------------------------------------------------

  const AC = window.AudioContext;
  const BAC = window.BaseAudioContext;
  if (AC && BAC) {
    const getter = (proto, name) =>
      Object.getOwnPropertyDescriptor(proto, name).get;
    const realTime = getter(BAC.prototype, 'currentTime');
    const realState = getter(BAC.prototype, 'state');
    const realBaseLatency = getter(AC.prototype, 'baseLatency');
    const realOutputLatency = getter(AC.prototype, 'outputLatency');
    const realResume = AC.prototype.resume;
    const realSuspend = AC.prototype.suspend;

    // A context created on the virtual clock starts suspended at time 0 and
    // stays silent; resume() starts its virtual time.
    const createdVirtual = context => {
      realSuspend.call(context);
      s.audio.set(context, {state: 'suspended', base: 0, since: s.now});
    };
    window.AudioContext = new Proxy(AC, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget);
        s.contexts.push(new WeakRef(context));
        if (s.virtual) createdVirtual(context);
        return context;
      },
    });

    const virtualOf = context => {
      if (!s.audio.has(context)) createdVirtual(context);
      return s.audio.get(context);
    };
    const timeOf = v =>
      v.state === 'running' ? v.base + (s.now - v.since) / 1000 : v.base;
    const setState = (context, state) => {
      const v = virtualOf(context);
      if (v.state === state) return;
      v.base = timeOf(v);
      v.since = s.now;
      v.state = state;
      context.dispatchEvent(new Event('statechange'));
    };
    const isLive = context => context instanceof AC && s.virtual;

    Object.defineProperty(BAC.prototype, 'currentTime', {
      configurable: true,
      enumerable: true,
      get() {
        return isLive(this) ? timeOf(virtualOf(this)) : realTime.call(this);
      },
    });
    Object.defineProperty(BAC.prototype, 'state', {
      configurable: true,
      enumerable: true,
      get() {
        return isLive(this) ? virtualOf(this).state : realState.call(this);
      },
    });
    Object.defineProperty(AC.prototype, 'baseLatency', {
      configurable: true,
      enumerable: true,
      get() {
        return s.virtual ? 0 : realBaseLatency.call(this);
      },
    });
    Object.defineProperty(AC.prototype, 'outputLatency', {
      configurable: true,
      enumerable: true,
      get() {
        return s.virtual ? 0 : realOutputLatency.call(this);
      },
    });
    AC.prototype.resume = function resume() {
      if (!s.virtual) return realResume.call(this);
      setState(this, 'running');
      return Promise.resolve();
    };
    AC.prototype.suspend = function suspend() {
      if (!s.virtual) return realSuspend.call(this);
      setState(this, 'suspended');
      return Promise.resolve();
    };
    AC.prototype.getOutputTimestamp = function getOutputTimestamp() {
      return {contextTime: this.currentTime, performanceTime: perf.now()};
    };

    s.enterAudio = () => {
      for (const ref of s.contexts) {
        const context = ref.deref();
        if (!context || realState.call(context) === 'closed') continue;
        // Every context's time starts from the clock's start, whatever its
        // real time was: that depends on how long setup took.
        const v = {
          state: realState.call(context),
          base: s.now / 1000,
          since: s.now,
        };
        s.audio.set(context, v);
        // Keep the real graph silent and its clock still; the virtual state
        // carries on as it was.
        if (v.state === 'running') realSuspend.call(context);
      }
    };
  } else {
    s.enterAudio = () => {};
  }

  // -------------------------------------------------------------------------
  // CSS transitions / animations and Web Animations
  // -------------------------------------------------------------------------

  const syncAnimations = () => {
    let count = 0;
    for (const animation of document.getAnimations()) {
      let start = s.animations.get(animation);
      if (start === undefined) {
        start = s.now;
        s.animations.set(animation, start);
        animation.pause();
      }
      const rate = animation.playbackRate || 1;
      const t = (s.now - start) * rate;
      const timing = animation.effect
        ? animation.effect.getComputedTiming()
        : null;
      const end = timing ? timing.endTime : Infinity;
      if (Number.isFinite(end) && t >= end) {
        try {
          animation.finish();
        } catch (error) {
          animation.currentTime = end;
        }
      } else {
        animation.currentTime = t;
      }
      count++;
    }
    return count;
  };

  // -------------------------------------------------------------------------
  // Worker gate
  // -------------------------------------------------------------------------
  //
  // Workers run in real time, outside the virtual clock, so when their
  // replies reach the page depends on how fast the machine is. The gate
  // holds the messages of the next worker the page creates after
  // `workers.arm()`: the page's `message` handlers (`onmessage` and
  // `addEventListener('message')`) get them only through
  // `workers.deliverNext()`, one per call, in the order the worker sent
  // them. Every other worker, and every other event of the gated one
  // (`error`, `messageerror`), is untouched. `status()` reports message
  // types only (a message's `data.type`, else its typeof), never data.

  const RealWorker = window.Worker;
  const gate = {armed: false, created: 0, gated: 0, held: [], delivered: 0};
  if (RealWorker) {
    const addListener = EventTarget.prototype.addEventListener;
    const removeListener = EventTarget.prototype.removeEventListener;
    class GatedWorker extends RealWorker {
      constructor(url, options) {
        super(url, options);
        gate.created++;
        if (!gate.armed) return;
        gate.armed = false;
        gate.gated++;
        let handler = null;
        const listeners = new Set();
        addListener.call(this, 'message', event => {
          gate.held.push({worker: this, event});
        });
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => handler,
          set: fn => {
            handler = typeof fn === 'function' ? fn : null;
          },
        });
        this.addEventListener = function addEventListener(type, fn, opts) {
          if (type === 'message') listeners.add(fn);
          else addListener.call(this, type, fn, opts);
        };
        this.removeEventListener = function removeEventListener(
          type,
          fn,
          opts,
        ) {
          if (type === 'message') listeners.delete(fn);
          else removeListener.call(this, type, fn, opts);
        };
        this.__recDeliver = event => {
          if (handler) handler.call(this, event);
          for (const fn of listeners) {
            if (typeof fn === 'function') fn.call(this, event);
            else fn.handleEvent(event);
          }
        };
      }
    }
    window.Worker = GatedWorker;
  }
  const messageType = data =>
    data && typeof data === 'object' && 'type' in data
      ? String(data.type)
      : typeof data;
  const workers = {
    /** Gate the next worker the page creates. */
    arm() {
      if (!RealWorker) throw new Error('this page has no Worker');
      gate.armed = true;
      return true;
    },
    status() {
      return {
        armed: gate.armed,
        created: gate.created,
        gated: gate.gated,
        held: gate.held.map(h => messageType(h.event.data)),
        delivered: gate.delivered,
      };
    },
    /** Hand the page the next held message; returns its type. */
    deliverNext() {
      const h = gate.held[gate.delivered];
      if (!h) throw new Error('no held worker message');
      gate.delivered++;
      h.worker.__recDeliver(h.event);
      return messageType(h.event.data);
    },
  };

  // -------------------------------------------------------------------------
  // The harness API
  // -------------------------------------------------------------------------

  const api = {
    get virtual() {
      return s.virtual;
    },
    get now() {
      return s.virtual ? s.now : realNow();
    },
    get frames() {
      return s.frames;
    },
    workers,
    /**
     * Freeze time. `at`: the virtual performance.now() to start at (default:
     * a second past the real one). Neither the page's clock nor its date may
     * go back: `at` must not be behind the page's real clock, nor behind the
     * real time since the tab opened.
     */
    enter({at} = {}) {
      if (s.virtual) return s.now;
      const real = realNow();
      const start = at ?? Math.max(real, sinceOpen()) + 1000;
      if (start < real)
        throw new Error(
          `the clock cannot start at ${start} ms: the page's clock already reads ${Math.ceil(real)} ms`,
        );
      if (start < sinceOpen())
        throw new Error(
          `the clock cannot start at ${start} ms: the tab opened ${Math.ceil(sinceOpen())} ms ago, and its date would go back`,
        );
      s.now = start;
      adoptRealQueues();
      s.enterAudio();
      s.virtual = true;
      return s.now;
    },
    /**
     * Move the clock forward to `targetMs`, firing every timer that falls due
     * on the way, each at its own due time and as its own task.
     */
    async advance(targetMs) {
      if (!s.virtual) throw new Error('virtual clock is not running');
      if (targetMs < s.now)
        throw new Error(`time cannot go back (${targetMs} < ${s.now})`);
      let fired = 0;
      for (;;) {
        const next = nextDueTimer(targetMs);
        if (!next) break;
        s.now = Math.max(s.now, next.t.due);
        if (next.t.every === null) s.timers.delete(next.id);
        else {
          next.t.due += next.t.every;
          next.t.seq = ++s.seq;
        }
        try {
          next.t.fn.apply(window, next.t.args);
        } catch (error) {
          report('timer', error);
        }
        fired++;
        await macrotask();
        if (fired > 10000) throw new Error('runaway timers');
      }
      s.now = targetMs;
      return {now: s.now, fired};
    },
    /**
     * Run this frame's rAF callbacks (in a real animation frame, one real
     * callback each so microtasks drain between them, as in a live frame),
     * let the page settle, sync animations, and wait for the paint.
     */
    async frame({settleTasks = 3} = {}) {
      if (!s.virtual) throw new Error('virtual clock is not running');
      const ts = s.now;
      s.running = new Map(s.rafs);
      s.rafs = new Map();
      const count = s.running.size;
      await new Promise(resolve => {
        const fallback = realSetTimeout(() => {
          // No real frame came (hidden window): run what is left directly.
          note(
            `frame ${s.frames}: no real animation frame came within 2 s (hidden or throttled window?); ran its ${s.running.size} rAF callbacks directly`,
          );
          for (const [id, callback] of s.running) {
            s.running.delete(id);
            try {
              callback(ts);
            } catch (error) {
              report('raf', error);
            }
          }
          resolve();
        }, 2000);
        for (const id of s.running.keys()) {
          realRAF(() => {
            const callback = s.running.get(id);
            if (!callback) return;
            s.running.delete(id);
            try {
              callback(ts);
            } catch (error) {
              report('raf', error);
            }
          });
        }
        realRAF(() => {
          realClearTimeout(fallback);
          resolve();
        });
      });
      for (let i = 0; i < settleTasks; i++) await macrotask();
      await realFrame();
      for (let i = 0; i < 2; i++) await macrotask();
      const animations = syncAnimations();
      await realFrame();
      await realFrame();
      s.frames++;
      return {
        now: ts,
        callbacks: count,
        animations,
        pendingRafs: s.rafs.size,
        timers: s.timers.size,
      };
    },
    /** Settle without advancing time (after a state change made from outside). */
    async settle({tasks = 3} = {}) {
      for (let i = 0; i < tasks; i++) await macrotask();
      await realFrame();
      if (s.virtual) syncAnimations();
      await realFrame();
    },
    errors() {
      return s.errors.splice(0);
    },
  };
  Object.defineProperty(window, '__recClock', {
    value: api,
    configurable: false,
    enumerable: false,
  });
})();
