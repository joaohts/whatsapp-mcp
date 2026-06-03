import { useEffect, useState } from 'react';
import type { PairingEvent } from '../../shared/bridge';
import { useSyncProgress } from '../hooks';
import { QrCode } from './QrCode';
import { ConfigureClaude } from './ConfigureClaude';

type Method = 'code' | 'qr';
type Step = 'choose' | 'waiting' | 'syncing' | 'done' | 'error';

export function PairingWizard({ onDone }: { onDone: () => void }) {
  const [method, setMethod] = useState<Method>('code');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<Step>('choose');
  const [code, setCode] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [account, setAccount] = useState<{ name: string; number: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncProgress();

  useEffect(() => {
    const off = window.whatsapp.onPairingEvent((e: PairingEvent) => {
      switch (e.kind) {
        case 'code':
          setCode(e.code);
          break;
        case 'qr':
          setQrPayload(e.payload);
          break;
        case 'success':
          setAccount(e.account);
          setStep('syncing');
          break;
        case 'error':
          setError(e.message);
          setStep('error');
          break;
      }
    });
    return off;
  }, []);

  // The initial history sync finishing is the cue to show the success screen.
  useEffect(() => {
    if (step === 'syncing' && sync?.initial_complete) setStep('done');
  }, [step, sync]);

  async function start(chosen: Method) {
    setError(null);
    setCode(null);
    setQrPayload(null);
    setMethod(chosen);
    setStep('waiting');
    await window.whatsapp.startPairing({
      method: chosen,
      phoneE164: chosen === 'code' ? normalizePhone(phone) : undefined,
    });
  }

  async function cancel() {
    await window.whatsapp.cancelPairing();
    setStep('choose');
    setCode(null);
    setQrPayload(null);
  }

  return (
    <div className="screen">
      <header className="screen__header">
        <h1 className="screen__title">Conectar WhatsApp</h1>
        <p className="screen__subtitle">
          Conecte sua conta para o Claude conseguir ler suas conversas. Tudo fica neste Mac.
        </p>
      </header>

      {step === 'choose' && (
        <ChooseStep
          method={method}
          setMethod={setMethod}
          phone={phone}
          setPhone={setPhone}
          onStart={start}
        />
      )}

      {step === 'waiting' && (
        <WaitingStep method={method} code={code} qrPayload={qrPayload} onCancel={cancel} />
      )}

      {step === 'syncing' && (
        <div className="step step--center">
          <div className="spinner spinner--lg" />
          <p className="step__lead">Conectado{account ? ` como ${account.name}` : ''} — sincronizando histórico…</p>
          <p className="step__count">
            {sync
              ? `${sync.messages_synced.toLocaleString()} mensagens sincronizadas em ${sync.chats_synced.toLocaleString()} conversas…`
              : 'iniciando sincronização…'}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="step">
          <div className="step--center">
            <div className="check">✓</div>
            <p className="step__lead">Conectado{account ? ` como ${account.name}` : ''}</p>
            {account && <p className="step__count">{account.number}</p>}
          </div>
          <ConfigureClaude />
          <button className="btn btn--ghost" onClick={onDone}>
            Concluído
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="step step--center">
          <div className="cross">!</div>
          <p className="step__lead">Falha na conexão</p>
          <p className="step__count">{error}</p>
          <button className="btn btn--primary" onClick={() => setStep('choose')}>
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

function ChooseStep({
  method,
  setMethod,
  phone,
  setPhone,
  onStart,
}: {
  method: Method;
  setMethod: (m: Method) => void;
  phone: string;
  setPhone: (p: string) => void;
  onStart: (m: Method) => void;
}) {
  const phoneValid = digits(phone).length >= 8;
  return (
    <div className="step">
      <div className="tabs">
        <button
          className={`tab ${method === 'code' ? 'tab--active' : ''}`}
          onClick={() => setMethod('code')}
        >
          Código
        </button>
        <button
          className={`tab ${method === 'qr' ? 'tab--active' : ''}`}
          onClick={() => setMethod('qr')}
        >
          QR Code
        </button>
      </div>

      {method === 'code' ? (
        <div className="panel">
          <label className="field__label" htmlFor="phone">
            Seu número de telefone no WhatsApp
          </label>
          <input
            id="phone"
            className="field__input"
            type="tel"
            inputMode="tel"
            placeholder="+55 11 99999-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            className="btn btn--primary"
            disabled={!phoneValid}
            onClick={() => onStart('code')}
          >
            Gerar código
          </button>
          <p className="hint">
            Você vai receber um código de 8 caracteres para digitar no WhatsApp do seu celular.
          </p>
        </div>
      ) : (
        <div className="panel">
          <p className="hint">
            Gere um QR code e escaneie com a câmera do seu celular no WhatsApp.
          </p>
          <button className="btn btn--primary" onClick={() => onStart('qr')}>
            Gerar QR code
          </button>
        </div>
      )}
    </div>
  );
}

function WaitingStep({
  method,
  code,
  qrPayload,
  onCancel,
}: {
  method: Method;
  code: string | null;
  qrPayload: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="step step--center">
      {method === 'code' ? (
        code ? (
          <>
            <p className="step__lead">Digite este código no WhatsApp</p>
            <div className="code">{code}</div>
          </>
        ) : (
          <>
            <div className="spinner spinner--lg" />
            <p className="step__count">Solicitando código…</p>
          </>
        )
      ) : qrPayload ? (
        <>
          <p className="step__lead">Escaneie este código no WhatsApp</p>
          <QrCode payload={qrPayload} />
        </>
      ) : (
        <>
          <div className="spinner spinner--lg" />
          <p className="step__count">Gerando QR…</p>
        </>
      )}

      <ol className="instructions">
        <li>Abra o WhatsApp no seu celular</li>
        <li>Toque em Configurações → Aparelhos conectados → Conectar um aparelho</li>
        {method === 'code' ? (
          <li>Toque em "Conectar com número de telefone" e digite o código</li>
        ) : (
          <li>Aponte seu celular para esta tela e escaneie</li>
        )}
      </ol>

      <button className="btn btn--ghost" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

function normalizePhone(raw: string): string {
  const d = digits(raw);
  return d ? `+${d}` : '';
}
function digits(raw: string): string {
  return raw.replace(/\D/g, '');
}
