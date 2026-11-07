import { useState } from 'react';
import { X } from 'lucide-react';

export default function LogoImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed || !src) return null;

  return (
    <>
      <button type="button" className="bishwa-logo-trigger" aria-label={'View ' + alt} onClick={() => setOpen(true)}>
        <img src={src} alt={alt} onError={() => setFailed(true)} />
      </button>
      {open && (
        <div className="bishwa-logo-lightbox" role="presentation" onClick={() => setOpen(false)}>
          <div className="bishwa-logo-lightbox-panel" role="dialog" aria-modal="true" aria-label={alt} onClick={event => event.stopPropagation()}>
            <button type="button" className="bishwa-logo-close" aria-label="Close logo preview" onClick={() => setOpen(false)}><X size={22} /></button>
            <img src={src} alt={alt} />
            <span>{alt}</span>
          </div>
        </div>
      )}
    </>
  );
}
