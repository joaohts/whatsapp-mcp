import { useState } from 'react';
import type { AppInfo, BackendStatus, ConnectionState } from '../../shared/bridge';
import { useSyncProgress } from '../hooks';
import { SettingsPanel } from './SettingsPanel';
import { ConfigureClaude } from './ConfigureClaude';

type Tab = 'status' | 'settings';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  unpaired: 'Not linked',
  connecting: 'Connecting…',
  syncing: 'Syncing…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function Dashboard({
  status,
  appInfo,
  onRepair,
}: {
  status: BackendStatus;
  appInfo: AppInfo | null;
  onRepair: () => void;
}) {
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div className="screen">
      <nav className="nav">
        <button
          className={`nav__item ${tab === 'status' ? 'nav__item--active' : ''}`}
          onClick={() => setTab('status')}
        >
          Status
        </button>
        <button
          className={`nav__item ${tab === 'settings' ? 'nav__item--active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </nav>

      {tab === 'status' ? (
        <StatusTab status={status} appInfo={appInfo} onRepair={onRepair} />
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}

function StatusTab({
  status,
  appInfo,
  onRepair,
}: {
  status: BackendStatus;
  appInfo: AppInfo | null;
  onRepair: () => void;
}) {
  const sync = useSyncProgress();
  const syncing = status.connection === 'syncing';

  async function unlink() {
    await window.whatsapp.unlinkDevice();
    onRepair();
  }

  return (
    <div className="step">
      <div className={`status-badge status-badge--${status.connection}`}>
        <span className="dot" />
        {CONNECTION_LABEL[status.connection]}
      </div>

      {status.paired_account && (
        <div className="account">
          <div className="account__name">{status.paired_account.name}</div>
          <div className="account__number">{status.paired_account.number}</div>
        </div>
      )}

      {syncing && (
        <p className="step__count">
          {sync
            ? `synced ${sync.messages_synced.toLocaleString()} messages across ${sync.chats_synced.toLocaleString()} chats…`
            : 'syncing…'}
        </p>
      )}

      {status.last_error && (
        <div className="error-box">
          <div className="error-box__title">Last error</div>
          <div className="error-box__body">{status.last_error}</div>
        </div>
      )}

      <dl className="stats">
        <div className="stats__row">
          <dt>Last sync</dt>
          <dd>{formatTime(status.last_sync_at)}</dd>
        </div>
        <div className="stats__row">
          <dt>Chats in store</dt>
          <dd>{status.store_chat_count.toLocaleString()}</dd>
        </div>
        <div className="stats__row">
          <dt>Messages in store</dt>
          <dd>{status.store_message_count.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="actions">
        <button
          className="btn btn--secondary"
          onClick={() => window.whatsapp.syncNow()}
          disabled={syncing || !status.paired_account}
        >
          Sync now
        </button>
        <ConfigureClaude />
        <button className="btn btn--ghost btn--danger" onClick={unlink}>
          Unlink device
        </button>
      </div>

      <footer className="footer">
        WhatsApp MCP {appInfo ? `v${appInfo.version}` : ''}
        {appInfo?.mock ? ' · mock backend' : ''}
      </footer>
    </div>
  );
}

function formatTime(seconds: number | null): string {
  if (!seconds) return 'never';
  return new Date(seconds * 1000).toLocaleString();
}
