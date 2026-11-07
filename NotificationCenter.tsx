import { useEffect, useState } from 'react';
import { getMessaging, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase';
import { BellRing, Check, X } from 'lucide-react';

type Notice = {
  id: string;
  title: string;
  body: string;
  receivedAt: string;
};

export default function NotificationCenter({ onEnable }: { onEnable: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    isSupported().then(supported => {
      if (supported && active) {
        stop = onMessage(getMessaging(firebaseApp), payload => {
          const item: Notice = {
            id: payload.messageId || String(Date.now()),
            title: payload.notification?.title || 'Bishwa notification',
            body: payload.notification?.body || 'You have a new update.',
            receivedAt: new Date().toISOString(),
          };
          setItems(old => [item, ...old.filter(existing => existing.id !== item.id)].slice(0, 12));
        });
      }
    }).catch(error => console.warn('Bishwa push listener unavailable:', error));
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  return (
    <div className="notification-center">
      <button className="icon-button notification-bell" onClick={() => setOpen(value => !value)} aria-label="Open notifications" title="Notifications">
        <BellRing size={19} />
        {items.length > 0 && <span className="notification-count">{items.length}</span>}
      </button>
      {open && (
        <>
          <button className="notification-dismiss" onClick={() => setOpen(false)} aria-label="Close notifications" />
          <section className="notification-popover">
            <header><div><b>Notifications</b><small>New videos from your Super channels</small></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></header>
            {items.length ? (
              <div className="notification-list">
                {items.map(item => <article className="notification-item" key={item.id}>
                  <span><BellRing size={16} /></span>
                  <div><b>{item.title}</b><p>{item.body}</p><small>{new Date(item.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
                </article>)}
              </div>
            ) : (
              <div className="notification-empty"><Check size={21} /><b>You’re all caught up</b><span>New video alerts will appear here.</span></div>
            )}
            <button className="notification-enable" onClick={onEnable}>Set up device notifications</button>
          </section>
        </>
      )}
    </div>
  );
}
