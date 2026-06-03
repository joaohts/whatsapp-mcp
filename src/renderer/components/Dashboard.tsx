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
  in_use_elsewhere: 'Em uso pelo Claude',
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
  const inUseElsewhere = status.connection === 'in_use_elsewhere';
  const canShowReconnect =
    status.paired_account &&
    (status.connection === 'in_use_elsewhere' ||
      status.connection === 'disconnected' ||
      status.connection === 'error');
  const [reconnectMsg, setReconnectMsg] = useState<string | null>(null);
  const [reconnectBusy, setReconnectBusy] = useState(false);

  async function unlink() {
    await window.whatsapp.unlinkDevice();
    onRepair();
  }

  async function reconnect() {
    setReconnectBusy(true);
    setReconnectMsg(null);
    try {
      const res = await window.whatsapp.reclaimConnection();
      if (!res.reclaimed) {
        setReconnectMsg(
          'O Claude Desktop está aberto e usando a conexão. Feche o Claude e tente novamente.',
        );
      }
    } finally {
      setReconnectBusy(false);
    }
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

      {inUseElsewhere && (
        <div className="info-box">
          O Claude Desktop está usando a conexão do WhatsApp. As mensagens
          continuam sincronizando em segundo plano — o painel só mostra os
          números atualizados aqui. Para reassumir a conexão, feche o
          Claude e clique em <strong>Reconectar</strong>.
        </div>
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

        {canShowReconnect && (
          <button
            className="btn btn--secondary"
            onClick={reconnect}
            disabled={reconnectBusy}
          >
            {reconnectBusy ? 'Reconectando…' : 'Reconectar'}
          </button>
        )}

        {reconnectMsg && <p className="hint hint--err">{reconnectMsg}</p>}

        {!inUseElsewhere && (
          <button className="btn btn--ghost btn--danger actions__danger" onClick={unlink}>
            Desconectar dispositivo
          </button>
        )}
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
