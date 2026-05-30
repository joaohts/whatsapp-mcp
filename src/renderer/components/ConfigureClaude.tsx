import { useState } from 'react';

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; patched: boolean }
  | { kind: 'error'; message: string };

/** "Configure Claude Desktop" button — idempotently patches the MCP config. */
export function ConfigureClaude() {
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
        className="btn btn--secondary"
        onClick={configure}
        disabled={state.kind === 'working'}
      >
        {state.kind === 'working' ? 'Configuring…' : 'Configure Claude Desktop'}
      </button>
      {state.kind === 'done' && (
        <p className="hint hint--ok">
          ✓ Done. Restart Claude Desktop, then ask “what are my unread WhatsApp chats?”
        </p>
      )}
      {state.kind === 'error' && <p className="hint hint--err">{state.message}</p>}
    </div>
  );
}
