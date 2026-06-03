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
        <h1 className="screen__title">Link WhatsApp</h1>
        <p className="screen__subtitle">
          Connect your account so Claude can read your chats. Everything stays on this Mac.
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
          <p className="step__lead">Linked{account ? ` as ${account.name}` : ''} — syncing history…</p>
          <p className="step__count">
            {sync
              ? `synced ${sync.messages_synced.toLocaleString()} messages across ${sync.chats_synced.toLocaleString()} chats…`
              : 'starting sync…'}
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="step">
          <div className="step--center">
            <div className="check">✓</div>
            <p className="step__lead">Connected{account ? ` as ${account.name}` : ''}</p>
            {account && <p className="step__count">{account.number}</p>}
          </div>
          <ConfigureClaude />
          <button className="btn btn--primary" onClick={onDone}>
            Done
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="step step--center">
          <div className="cross">!</div>
          <p className="step__lead">Pairing failed</p>
          <p className="step__count">{error}</p>
          <button className="btn btn--primary" onClick={() => setStep('choose')}>
            Try again
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
          Pairing code
        </button>
        <button
          className={`tab ${method === 'qr' ? 'tab--active' : ''}`}
          onClick={() => setMethod('qr')}
        >
          QR code
        </button>
      </div>

      {method === 'code' ? (
        <div className="panel">
          <label className="field__label" htmlFor="phone">
            Your WhatsApp phone number
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
            Get pairing code
          </button>
          <p className="hint">
            You'll get an 8-character code to type into WhatsApp on your phone.
          </p>
        </div>
      ) : (
        <div className="panel">
          <p className="hint">
            Generate a QR code, then scan it with your phone's camera in WhatsApp.
          </p>
          <button className="btn btn--primary" onClick={() => onStart('qr')}>
            Generate QR code
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
            <p className="step__lead">Enter this code in WhatsApp</p>
            <div className="code">{code}</div>
          </>
        ) : (
          <>
            <div className="spinner spinner--lg" />
            <p className="step__count">Requesting code…</p>
          </>
        )
      ) : qrPayload ? (
        <>
          <p className="step__lead">Scan this code in WhatsApp</p>
          <QrCode payload={qrPayload} />
        </>
      ) : (
        <>
          <div className="spinner spinner--lg" />
          <p className="step__count">Generating QR…</p>
        </>
      )}

      <ol className="instructions">
        <li>Open WhatsApp on your phone</li>
        <li>Tap Settings → Linked Devices → Link a Device</li>
        {method === 'code' ? (
          <li>Tap "Link with phone number instead" and enter the code</li>
        ) : (
          <li>Point your phone at this screen to scan</li>
        )}
      </ol>

      <button className="btn btn--ghost" onClick={onCancel}>
        Cancel
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
