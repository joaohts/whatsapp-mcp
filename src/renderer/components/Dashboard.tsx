import { useState } from 'react';
import type { AppInfo, BackendStatus, ConnectionState } from '../../shared/bridge';
import { useSyncProgress } from '../hooks';
import { SettingsPanel } from './SettingsPanel';
import { ConfigureClaude } from './ConfigureClaude';

type Tab = 'status' | 'settings';

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  unpaired: 'Não conectado',
  connecting: 'Conectando…',
  syncing: 'Sincronizando…',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro',
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
          Configurações
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
            ? `${sync.messages_synced.toLocaleString()} mensagens sincronizadas em ${sync.chats_synced.toLocaleString()} conversas…`
            : 'sincronizando…'}
        </p>
      )}

      {status.last_error && (
        <div className="error-box">
          <div className="error-box__title">Último erro</div>
          <div className="error-box__body">{status.last_error}</div>
        </div>
      )}

      <dl className="stats">
        <div className="stats__row">
          <dt>Última sincronização</dt>
          <dd>{formatTime(status.last_sync_at)}</dd>
        </div>
        <div className="stats__row">
          <dt>Conversas armazenadas</dt>
          <dd>{status.store_chat_count.toLocaleString()}</dd>
        </div>
        <div className="stats__row">
          <dt>Mensagens armazenadas</dt>
          <dd>{status.store_message_count.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="actions">
        <ConfigureClaude />
        <button
          className="btn btn--secondary"
          onClick={() => window.whatsapp.syncNow()}
          disabled={syncing || !status.paired_account}
        >
          Sincronizar agora
        </button>
        <button className="btn btn--ghost btn--danger actions__danger" onClick={unlink}>
          Desconectar dispositivo
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
  if (!seconds) return 'nunca';
  return new Date(seconds * 1000).toLocaleString('pt-BR');
}
