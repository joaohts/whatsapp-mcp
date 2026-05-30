// Notify-only update check. Polls the GitHub Releases API for the latest tag
// and compares it to the running version. The GUI shows a banner if newer;
// nothing is ever downloaded or installed automatically (see PLANNING.md ->
// Updates: notify-only). The only outbound traffic here is to api.github.com.

import type { UpdateInfo } from '../shared/bridge';

const REPO = 'joaohts/whatsapp-mcp';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Parse "1.2.3" / "v1.2.3" into a comparable [major, minor, patch] tuple. */
function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/**
 * Returns update info, or null if the check fails or no release exists.
 * Never throws — a failed update check must not affect the app.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'WhatsAppMCP',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!data.tag_name) return null;

    const latest = data.tag_name.replace(/^v/i, '');
    return {
      current: currentVersion,
      latest,
      isNewer: isNewer(latest, currentVersion),
      url: data.html_url ?? `https://github.com/${REPO}/releases/latest`,
    };
  } catch {
    return null;
  }
}
