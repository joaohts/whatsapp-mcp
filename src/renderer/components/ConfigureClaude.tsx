import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; patched: boolean }
  | { kind: 'error'; message: string };

/** Botão "Configurar Claude Desktop" — atualiza a config do MCP de forma idempotente. */
export function ConfigureClaude({ variant = 'primary' }: { variant?: 'primary' | 'secondary' } = {}) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function configure() {
    setState({ kind: 'working' });
    try {
      const res = await window.whatsapp.configureClaudeDesktop();
      setState({ kind: 'done', patched: res.patched });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="configure">
      <button
        className={`btn btn--${variant}`}
        onClick={configure}
        disabled={state.kind === 'working'}
      >
        {state.kind === 'working' ? 'Configurando…' : 'Configurar Claude Desktop'}
      </button>
      {state.kind === 'done' && (
        <p className="hint hint--ok">
          ✓ Pronto. Reinicie o Claude Desktop e pergunte "quais são minhas conversas não lidas do WhatsApp?"
        </p>
      )}
      {state.kind === 'error' && <p className="hint hint--err">{state.message}</p>}
    </div>
  );
}
