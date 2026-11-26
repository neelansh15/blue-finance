"use client";

import { useEffect, useMemo, useState } from "react";
import { createDawnClient, type DawnClient, type DawnSnapshot } from "../../../src/lib/dawn/client";

/** Creates the data-layer client once and keeps a snapshot in React state. */
export function useDawn(): { client: DawnClient; snapshot: DawnSnapshot | null; error: string | null } {
  const client = useMemo(() => createDawnClient(), []);
  const [snapshot, setSnapshot] = useState<DawnSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      client
        .getSnapshot()
        .then((s) => live && setSnapshot(s))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    load();
    const off = client.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [client]);

  return { client, snapshot, error };
}
