import { useEffect, useState } from 'react';
import type { BackendStatus, SyncProgress } from '../shared/bridge';

const wa = () => window.whatsapp;

/** Live backend status: seeded from getStatus(), kept fresh via onStatusChange. */
export function useStatus(): BackendStatus | null {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  useEffect(() => {
    let active = true;
    wa()
      .getStatus()
      .then((s) => {
        if (active) setStatus(s);
      });
    const off = wa().onStatusChange(setStatus);
    return () => {
      active = false;
      off();
    };
  }, []);
  return status;
}

/** Latest sync progress event, or null until one arrives. */
export function useSyncProgress(): SyncProgress | null {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  useEffect(() => wa().onSyncProgress(setProgress), []);
  return progress;
}
