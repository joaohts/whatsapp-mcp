import type { UpdateInfo } from '../../shared/bridge';

export function UpdateBanner({
  update,
  onDismiss,
}: {
  update: UpdateInfo;
  onDismiss: () => void;
}) {
  return (
    <div className="banner">
      <span className="banner__text">
        Version {update.latest} is available (you have {update.current}).
      </span>
      <div className="banner__actions">
        <button
          className="link"
          onClick={() => window.whatsapp.openExternal(update.url)}
        >
          View release
        </button>
        <button className="link link--muted" onClick={onDismiss}>
          Later
        </button>
      </div>
    </div>
  );
}
