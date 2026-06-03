import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders a WhatsApp pairing QR payload (raw string) to an <img> data URL. */
export function QrCode({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(payload, { width: 240, margin: 1 })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [payload]);

  if (!dataUrl) return <div className="qr qr--placeholder">Generating QR…</div>;
  return <img className="qr" src={dataUrl} alt="WhatsApp pairing QR code" width={240} height={240} />;
}
