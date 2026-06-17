'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {toast} from 'sonner';
import {
  ALESIS_SURGE_PROFILE,
  parseChProfile,
  type ChProfile,
} from '@/lib/drum-fills/midi/chProfile';
import {PadMapping} from '@/lib/drum-fills/midi/padMapping';

// Calibration is per MIDI instrument: audio + MIDI latency differs by device, so
// each connected instrument gets its own persisted offset. The base key (no
// device suffix) is the legacy/global fallback used when nothing is connected.
const CALIBRATION_KEY_BASE = 'drum-fills:calibration-offset-ms';

function calibrationStorageKey(deviceKey: string | null): string {
  return deviceKey ? `${CALIBRATION_KEY_BASE}:${deviceKey}` : CALIBRATION_KEY_BASE;
}

const noopSubscribe = () => () => {};
const getSupportedClient = () =>
  typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
const getSupportedServer = () => false;

// The per-device calibration offsets live in a tiny module-level store backed by
// localStorage so the provider can read them hydration-safely via
// useSyncExternalStore (server renders 0, client re-renders with the persisted
// value). `activeDeviceKey` selects which instrument's offset is current.
let activeDeviceKey: string | null = null;
const calibrationCache = new Map<string, number>();
const calibrationListeners = new Set<() => void>();

function loadStoredOffset(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCalibrationOffset(): number {
  const key = calibrationStorageKey(activeDeviceKey);
  let cached = calibrationCache.get(key);
  if (cached === undefined) {
    let val = loadStoredOffset(key);
    // A device with no saved offset yet falls back to the legacy/global value so
    // existing calibrations carry over until the device is recalibrated.
    if (val === null && activeDeviceKey !== null) {
      val = loadStoredOffset(CALIBRATION_KEY_BASE);
    }
    cached = val ?? 0;
    calibrationCache.set(key, cached);
  }
  return cached;
}

function writeCalibrationOffset(offsetMs: number): void {
  const key = calibrationStorageKey(activeDeviceKey);
  calibrationCache.set(key, offsetMs);
  try {
    localStorage.setItem(key, String(offsetMs));
  } catch {
    // ignore storage failures
  }
  for (const listener of calibrationListeners) listener();
}

/** Switch which instrument's calibration is active; notifies subscribers so the
 * exposed offset re-reads for the newly connected device. */
function setActiveCalibrationDevice(deviceKey: string | null): void {
  const next = deviceKey || null;
  if (next === activeDeviceKey) return;
  activeDeviceKey = next;
  for (const listener of calibrationListeners) listener();
}

const subscribeCalibrationOffset = (callback: () => void) => {
  calibrationListeners.add(callback);
  return () => {
    calibrationListeners.delete(callback);
  };
};
const getCalibrationOffsetServer = () => 0;

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

/** A single incoming MIDI note-on, classified through the active profile. */
export interface MidiPadHit {
  noteNumber: number;
  velocity: number;
  /** performance.now() timestamp of the event. */
  timeStamp: number;
  /** Pad resolution from the active profile, or null if the note is unmapped. */
  lane: string | null;
  isCymbal: boolean | null;
}

interface MidiContextValue {
  /** Whether the browser exposes the Web MIDI API. */
  supported: boolean;
  /** True once requestMIDIAccess has resolved. */
  ready: boolean;
  /** Permission / access error message, if any. */
  error: string | null;
  devices: MidiDeviceInfo[];
  /** Currently connected input ids (those producing events). */
  connectedIds: string[];
  profile: ChProfile;
  /** Calibration offset in ms (subtract from raw hit times). */
  calibrationOffsetMs: number;
  requestAccess: () => Promise<void>;
  loadProfileYaml: (yaml: string) => void;
  resetProfile: () => void;
  setCalibrationOffsetMs: (offsetMs: number) => void;
  /** Subscribe to classified pad hits. Returns an unsubscribe fn. */
  subscribe: (listener: (hit: MidiPadHit) => void) => () => void;
}

const MidiContext = createContext<MidiContextValue | null>(null);

export function useMidi(): MidiContextValue {
  const ctx = useContext(MidiContext);
  if (!ctx) throw new Error('useMidi must be used within MidiProvider');
  return ctx;
}

export function MidiProvider({children}: {children: React.ReactNode}) {
  // Resolved hydration-safely: the server snapshot is false, and React
  // re-renders with the real capability after hydration.
  const supported = useSyncExternalStore(
    noopSubscribe,
    getSupportedClient,
    getSupportedServer,
  );

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<ChProfile>(ALESIS_SURGE_PROFILE);
  const calibrationOffsetMs = useSyncExternalStore(
    subscribeCalibrationOffset,
    readCalibrationOffset,
    getCalibrationOffsetServer,
  );

  const accessRef = useRef<MIDIAccess | null>(null);
  const listenersRef = useRef<Set<(hit: MidiPadHit) => void>>(new Set());
  const padMappingRef = useRef<PadMapping>(new PadMapping(profile));

  useEffect(() => {
    padMappingRef.current = new PadMapping(profile);
  }, [profile]);

  const setCalibrationOffsetMs = useCallback((offsetMs: number) => {
    writeCalibrationOffset(offsetMs);
  }, []);

  const handleMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const noteNumber = data[1];
    const velocity = data[2];
    // note-on with non-zero velocity
    if (status !== 0x90 || velocity === 0) return;

    const resolution = padMappingRef.current.resolve(noteNumber);
    const hit: MidiPadHit = {
      noteNumber,
      velocity,
      timeStamp: event.timeStamp,
      lane: resolution?.lane ?? null,
      isCymbal: resolution?.isCymbal ?? null,
    };
    for (const listener of listenersRef.current) listener(hit);
  }, []);

  const refreshDevices = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    const inputs: MidiDeviceInfo[] = [];
    const connected: string[] = [];
    const connectedNames: string[] = [];
    access.inputs.forEach(input => {
      const name = input.name ?? 'Unknown device';
      inputs.push({
        id: input.id,
        name,
        manufacturer: input.manufacturer ?? '',
      });
      if (input.state === 'connected') {
        connected.push(input.id);
        connectedNames.push(name);
      }
      // Attach handler (idempotent; assigning replaces any prior).
      input.onmidimessage = handleMessage;
    });
    setDevices(inputs);
    setConnectedIds(connected);
    // Calibration follows the connected instrument (first one if several).
    setActiveCalibrationDevice(connectedNames[0] ?? null);
  }, [handleMessage]);

  const requestAccess = useCallback(async () => {
    if (!supported) {
      setError('Web MIDI is not supported in this browser.');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({sysex: false});
      accessRef.current = access;
      access.onstatechange = () => refreshDevices();
      refreshDevices();
      setReady(true);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to access MIDI devices.';
      setError(message);
      setReady(true);
    }
  }, [supported, refreshDevices]);

  // Auto-connect on load so a plugged-in kit just works (and its calibration
  // loads) without clicking "Connect MIDI". requestMIDIAccess (no sysex) needs
  // no user gesture in Chromium; runs once.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (!supported || autoConnectedRef.current) return;
    autoConnectedRef.current = true;
    void requestAccess();
  }, [supported, requestAccess]);

  const loadProfileYaml = useCallback((yaml: string) => {
    try {
      const parsed = parseChProfile(yaml);
      if (Object.keys(parsed.mappings).length === 0) {
        toast.error('No pad mappings found in that profile.');
        return;
      }
      setProfile(parsed);
      toast.success(
        `Loaded MIDI profile${parsed.deviceName ? `: ${parsed.deviceName}` : ''}.`,
      );
    } catch {
      toast.error('Could not parse that MIDI profile.');
    }
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(ALESIS_SURGE_PROFILE);
  }, []);

  const subscribe = useCallback((listener: (hit: MidiPadHit) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // Dev-only test seam: lets browser validation (chrome-devtools MCP) inject a
  // synthetic note-on without real MIDI hardware. Classifies through the active
  // profile exactly like a real event. No-op in production.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as {
      __drumFillsInjectHit?: (noteNumber: number, velocity?: number) => void;
    };
    w.__drumFillsInjectHit = (noteNumber: number, velocity = 100) => {
      const resolution = padMappingRef.current.resolve(noteNumber);
      const hit: MidiPadHit = {
        noteNumber,
        velocity,
        timeStamp: performance.now(),
        lane: resolution?.lane ?? null,
        isCymbal: resolution?.isCymbal ?? null,
      };
      for (const listener of listenersRef.current) listener(hit);
    };
    return () => {
      delete w.__drumFillsInjectHit;
    };
  }, []);

  const value = useMemo<MidiContextValue>(
    () => ({
      supported,
      ready,
      error,
      devices,
      connectedIds,
      profile,
      calibrationOffsetMs,
      requestAccess,
      loadProfileYaml,
      resetProfile,
      setCalibrationOffsetMs,
      subscribe,
    }),
    [
      supported,
      ready,
      error,
      devices,
      connectedIds,
      profile,
      calibrationOffsetMs,
      requestAccess,
      loadProfileYaml,
      resetProfile,
      setCalibrationOffsetMs,
      subscribe,
    ],
  );

  return <MidiContext.Provider value={value}>{children}</MidiContext.Provider>;
}
