import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  castRecipeToDevice,
  discoverCastDevices,
  stopCastOnDevice,
  type CastDevice,
} from "../api/cast";

type Props = {
  recipeId: number;
  recipeTitle: string;
  onClose: () => void;
};

const STORAGE_KEY = "kiln:lastCastDevice";

type SavedDevice = {
  name: string;
  host: string;
  port: number;
};

function loadSavedDevice(): SavedDevice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDevice>;
    if (parsed.host) {
      return {
        name: parsed.name || parsed.host,
        host: parsed.host,
        port: parsed.port || 8009,
      };
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function saveLastDevice(device: SavedDevice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Ignore storage errors
  }
}

export default function CastRecipeModal({
  recipeId,
  recipeTitle,
  onClose,
}: Props) {
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [scanning, setScanning] = useState(true);
  const [casting, setCasting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedHost, setSelectedHost] = useState<string>(
    () => loadSavedDevice()?.host ?? "",
  );
  const [selectedPort, setSelectedPort] = useState<number>(
    () => loadSavedDevice()?.port ?? 8009,
  );
  const [selectedName, setSelectedName] = useState<string>(
    () => loadSavedDevice()?.name ?? "",
  );

  const [showManual, setShowManual] = useState(false);
  const [manualHost, setManualHost] = useState(
    () => loadSavedDevice()?.host ?? "",
  );
  const [manualPort, setManualPort] = useState(
    () => String(loadSavedDevice()?.port ?? 8009),
  );

  const [activeCast, setActiveCast] = useState<{
    deviceName: string;
    host: string;
    port: number;
    url: string;
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !casting && !stopping) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [casting, stopping, onClose]);

  const scanDevices = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const found = await discoverCastDevices();
      setDevices(found);

      if (found.length > 0) {
        const saved = loadSavedDevice();
        const match =
          (saved && found.find((d) => d.host === saved.host)) ?? found[0];
        setSelectedHost(match.host);
        setSelectedPort(match.port || 8009);
        setSelectedName(match.name);
      } else {
        setShowManual(true);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to scan for Google Cast devices.",
      );
      setShowManual(true);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanDevices();
  }, [scanDevices]);

  const performCast = async (host: string, port: number, name: string) => {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError("Please select a Nest Hub or enter its IP address.");
      return;
    }

    setError(null);
    setCasting(true);
    try {
      const res = await castRecipeToDevice(recipeId, trimmedHost, port);
      saveLastDevice({ name: name || trimmedHost, host: trimmedHost, port });
      setActiveCast({
        deviceName: name || trimmedHost,
        host: trimmedHost,
        port,
        url: res.url,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to cast recipe to device.",
      );
    } finally {
      setCasting(false);
    }
  };

  const handleCastSelected = () => {
    void performCast(selectedHost, selectedPort, selectedName);
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const port = Number(manualPort) || 8009;
    void performCast(manualHost, port, manualHost.trim());
  };

  const handleStop = async () => {
    if (!activeCast) return;
    setStopping(true);
    setError(null);
    try {
      await stopCastOnDevice(activeCast.host, activeCast.port);
      setActiveCast(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to stop casting.",
      );
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="cast-modal-title"
              className="text-lg font-semibold text-stone-900"
            >
              Cast to Nest Hub
            </h2>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {recipeTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={casting || stopping}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 overflow-y-auto p-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {activeCast && (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  Casting to {activeCast.deviceName}
                </span>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopping}
                  className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {stopping ? "Stopping…" : "Stop Casting"}
                </button>
              </div>
              <p className="break-all text-xs text-emerald-700">
                Loaded: {activeCast.url}
              </p>
            </div>
          )}

          {/* Discovered Devices */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-stone-800">
                Google Cast Devices on Your Network
              </span>
              <button
                type="button"
                onClick={() => void scanDevices()}
                disabled={scanning || casting}
                className="text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline disabled:opacity-50"
              >
                {scanning ? "Scanning…" : "Rescan"}
              </button>
            </div>

            {scanning ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" />
                Scanning local network for Nest Hub devices…
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 text-xs leading-relaxed text-stone-600">
                No Cast devices discovered via mDNS. Make sure your Nest Hub is
                on the same Wi-Fi/LAN (in Docker, use{" "}
                <code className="rounded bg-stone-200/70 px-1 py-0.5">
                  --network host
                </code>
                ), or enter your Nest Hub&apos;s IP address below.
              </div>
            ) : (
              <ul className="space-y-2">
                {devices.map((dev) => {
                  const selected =
                    selectedHost === dev.host && selectedPort === dev.port;
                  return (
                    <li key={dev.uuid || `${dev.host}:${dev.port}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedHost(dev.host);
                          setSelectedPort(dev.port);
                          setSelectedName(dev.name);
                        }}
                        className={[
                          "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                          selected
                            ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-200"
                            : "border-stone-200 bg-white hover:bg-stone-50",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-stone-900">
                            {dev.name}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-stone-500">
                            {dev.model ? `${dev.model} · ` : ""}
                            {dev.host}:{dev.port}
                          </div>
                        </div>
                        {selected && (
                          <span className="shrink-0 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white">
                            Selected
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Manual IP fallback */}
          <div className="border-t border-stone-100 pt-3">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-xs font-medium text-stone-500 hover:text-stone-800"
            >
              {showManual ? "▾" : "▸"} Enter Nest Hub IP manually
            </button>

            {showManual && (
              <form
                onSubmit={handleManualSubmit}
                className="mt-2.5 flex items-center gap-2"
              >
                <input
                  type="text"
                  required
                  placeholder="Nest Hub IP (e.g., 10.0.0.42)"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  disabled={casting}
                  className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                />
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                  disabled={casting}
                  className="w-20 rounded-lg border border-stone-300 px-2.5 py-2 text-sm text-stone-900 focus:border-amber-500 focus:outline-none"
                  title="Cast port (default 8009)"
                />
                <button
                  type="submit"
                  disabled={casting}
                  className="rounded-lg bg-stone-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  Cast
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-6 py-3.5">
          <Link
            to={`/recipes/${recipeId}/cook`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-stone-600 hover:text-stone-900 hover:underline"
          >
            Preview Cook Mode ↗
          </Link>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={casting || stopping}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              Close
            </button>
            {devices.length > 0 && (
              <button
                type="button"
                onClick={handleCastSelected}
                disabled={casting || !selectedHost}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
              >
                {casting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Casting…
                  </>
                ) : (
                  "Cast to Selected Device"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
