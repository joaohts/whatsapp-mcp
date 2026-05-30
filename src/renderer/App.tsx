import { useEffect, useState } from 'react';
import type { AppInfo, UpdateInfo } from '../shared/bridge';
import { useStatus } from './hooks';
import { PairingWizard } from './components/PairingWizard';
import { Dashboard } from './components/Dashboard';
import { UpdateBanner } from './components/UpdateBanner';

type View = 'pairing' | 'dashboard';

export function App() {
  const status = useStatus();
  const [view, setView] = useState<View | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // Initial route is decided once, from the first status read: an already
  // paired install goes straight to the dashboard; everyone else pairs first.
  useEffect(() => {
    if (view === null && status !== null) {
      setView(status.paired_account ? 'dashboard' : 'pairing');
    }
  }, [status, view]);

  useEffect(() => {
    window.whatsapp.getAppInfo().then(setAppInfo);
    window.whatsapp.checkForUpdate().then((u) => {
      if (u?.isNewer) setUpdate(u);
    });
  }, []);

  if (view === null || status === null) {
    return (
      <div className="app app--loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="app">
      {update && <UpdateBanner update={update} onDismiss={() => setUpdate(null)} />}
      {view === 'pairing' ? (
        <PairingWizard onDone={() => setView('dashboard')} />
      ) : (
        <Dashboard
          status={status}
          appInfo={appInfo}
          onRepair={() => setView('pairing')}
        />
      )}
    </div>
  );
}
