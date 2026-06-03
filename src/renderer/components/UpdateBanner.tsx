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
        Versão {update.latest} disponível (você tem a {update.current}).
      </span>
      <div className="banner__actions">
        <button
          className="link"
          onClick={() => window.whatsapp.openExternal(update.url)}
        >
          Ver release
        </button>
        <button className="link link--muted" onClick={onDismiss}>
          Depois
        </button>
      </div>
    </div>
  );
}
