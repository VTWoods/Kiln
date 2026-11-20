export type CastDevice = {
  name: string;
  model: string;
  host: string;
  port: number;
  uuid: string;
};

export type CastResult = {
  status: string;
  url: string;
  host: string;
};

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response
    }
  }

  if (!res.ok) {
    const errMsg =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(errMsg);
  }

  return data as T;
}

export async function discoverCastDevices(): Promise<CastDevice[]> {
  const res = await fetch("/api/cast/devices");
  const data = await parseJsonOrThrow<{ devices: CastDevice[] }>(res);
  return data.devices ?? [];
}

export async function castRecipeToDevice(
  recipeId: number,
  host: string,
  port = 8009,
): Promise<CastResult> {
  const res = await fetch(`/api/cast/recipes/${recipeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host,
      port,
      base_url: window.location.origin,
    }),
  });
  return parseJsonOrThrow<CastResult>(res);
}

export async function stopCastOnDevice(
  host: string,
  port = 8009,
): Promise<void> {
  const res = await fetch("/api/cast/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, port }),
  });
  await parseJsonOrThrow<{ status: string }>(res);
}
