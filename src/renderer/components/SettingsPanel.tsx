import { useEffect, useState } from 'react';
import type { UserConfig } from '../../shared/bridge';
import { TOOLS, type ToolCategory, type ToolName } from '../../types/tools';

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  chats: 'Chats & messages',
  media: 'Media',
  contacts: 'Contacts & groups',
};

const CATEGORY_ORDER: ToolCategory[] = ['chats', 'media', 'contacts'];

export function SettingsPanel() {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.whatsapp.getConfig().then(setConfig);
  }, []);

  async function toggle(name: ToolName, enabled: boolean) {
    if (!config) return;
    setBusy(true);
    // Optimistic update, reconciled with the controller's returned config.
    setConfig({ ...config, enabled_tools: { ...config.enabled_tools, [name]: enabled } });
    const next = await window.whatsapp.setConfig({
      enabled_tools: { [name]: enabled } as Record<ToolName, boolean>,
    });
    setConfig(next);
    setBusy(false);
  }

  if (!config) {
    return (
      <div className="step step--center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="step">
      <p className="hint">
        Choose which tools Claude can use. Disabled tools never appear in Claude's tool
        list. Changes apply the next time Claude Desktop restarts.
      </p>

      {CATEGORY_ORDER.map((category) => {
        const tools = TOOLS.filter((t) => t.category === category);
        if (tools.length === 0) return null;
        return (
          <section key={category} className="tool-group">
            <h2 className="tool-group__title">{CATEGORY_LABEL[category]}</h2>
            {tools.map((tool) => (
              <label key={tool.name} className="tool">
                <input
                  type="checkbox"
                  checked={config.enabled_tools[tool.name] ?? false}
                  disabled={busy}
                  onChange={(e) => toggle(tool.name, e.target.checked)}
                />
                <span className="tool__text">
                  <span className="tool__name">{tool.name}</span>
                  <span className="tool__desc">{tool.description}</span>
                </span>
              </label>
            ))}
          </section>
        );
      })}
    </div>
  );
}
