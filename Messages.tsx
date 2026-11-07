import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { onValue, ref, set, push, update, serverTimestamp } from 'firebase/database';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { api } from '@appdeploy/client';
import { createClient } from '@supabase/supabase-js';
import { auth, db, firebaseApp, rtdb } from './firebase';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import {
  Bell, BellRing, MessageCircle, Send, Search, UserRound, ShieldCheck,
  ImagePlus, X, LoaderCircle, Paperclip,
} from 'lucide-react';

const SUPABASE_URL = 'https://fnqufswrbzztioobvhsd.supabase.co';
const SUPABASE_BUCKET = 'bishwa-media';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GK2RyUbnwpsaDUVA2OxfSQ_rpldAtw0';
const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VAPID_KEY = 'BGYDjfigCa5e9yroalmbFyI6LLQx2fesdC3ZPdax76lUX7Ng3XQ-FvuC5gpCMjMQlt13TlKgPNBHcnOZfH8tjeo';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type ChatUser = { uid: string; displayName: string; photoURL?: string };
type ChatThread = {
  id: string;
  members: string[];
  memberNames?: Record<string, string>;
  lastMessage?: string;
  updatedAt?: number;
};
type ChatMessage = {
  id: string;
  senderId: string;
  text?: string;
  imageUrl?: string;
  createdAt?: number;
};

const getTime = (value?: number) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function optimizeChatImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > CHAT_IMAGE_MAX_BYTES) throw new Error('Choose an image smaller than 10 MB.');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); return file; }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) return file;
    return new File([blob], (file.name.replace(/\\.[^.]+$/, '') || 'chat-image') + '.webp', {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

async function uploadChatImage(originalFile: File) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again before sending an image.');
  const file = await optimizeChatImage(originalFile);
  const idToken = await user.getIdToken();
  const response = await fetch(SUPABASE_URL + '/functions/v1/bishwa-media-sign', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + idToken,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'chat-image',
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const signed = await response.json().catch(() => ({})) as {
    path?: string;
    token?: string;
    publicUrl?: string;
    error?: string;
  };
  if (!response.ok || !signed.path || !signed.token || !signed.publicUrl) {
    throw new Error(signed.error || 'Could not prepare this image for upload.');
  }
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).uploadToSignedUrl(
    signed.path,
    signed.token,
    file,
    { contentType: file.type, cacheControl: '3600', upsert: false },
  );
  if (error) throw error;
  return signed.publicUrl;
}

export default function Messages() {
  const user = auth.currentUser;
  const [people, setPeople] = useState<ChatUser[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [active, setActive] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pushState, setPushState] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'denied' : Notification.permission
  );
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedImage) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);

  useEffect(() => {
    if (!user) return;
    const stopPeople = onSnapshot(query(collection(db, 'users'), limit(200)), snap => {
      setPeople(snap.docs.map(item => item.data() as ChatUser).filter(person => person.uid && person.uid !== user.uid));
    }, () => setNotice('Could not load your contacts right now. Please try again.'));

    const chatStops = new Map<string, () => void>();
    const unreadStops = new Map<string, () => void>();
    const lastReadByChat = new Map<string, number>();
    const messagesByChat = new Map<string, Record<string, Omit<ChatMessage, 'id'>>>();
    const recalculateUnread = (id: string) => {
      const readAt = lastReadByChat.get(id) || 0;
      const records = Object.values(messagesByChat.get(id) || {});
      const count = records.filter(message =>
        message.senderId !== user.uid && Number(message.createdAt || 0) > readAt
      ).length;
      setUnread(current => ({ ...current, [id]: count }));
    };

    const stopIndex = onValue(ref(rtdb, `userChats/${user.uid}`), snapshot => {
      const index = snapshot.val() || {};
      const ids = Object.keys(index);
      for (const [id, stop] of chatStops) {
        if (!ids.includes(id)) {
          stop();
          chatStops.delete(id);
          unreadStops.get(id)?.();
          unreadStops.delete(id);
          lastReadByChat.delete(id);
          messagesByChat.delete(id);
          setUnread(current => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        }
      }
      for (const id of ids) {
        const entry = index[id];
        lastReadByChat.set(id, Number(entry?.lastReadAt || 0));
        if (!chatStops.has(id)) {
          const stop = onValue(ref(rtdb, `chats/${id}/meta`), chatSnapshot => {
            if (!chatSnapshot.exists()) return;
            const value = chatSnapshot.val();
            const thread: ChatThread = {
              id,
              members: Object.keys(value.members || {}),
              memberNames: value.memberNames || {},
              lastMessage: value.lastMessage || '',
              updatedAt: value.updatedAt || 0,
            };
            setThreads(current => {
              const next = [...current.filter(item => item.id !== id), thread];
              return next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            });
            setActive(current => current?.id === id ? thread : current);
          }, () => setNotice('Your chats are temporarily unavailable. Please try again.'));
          chatStops.set(id, stop);
        }
        if (!unreadStops.has(id)) {
          const stop = onValue(ref(rtdb, `chats/${id}/messages`), messageSnapshot => {
            messagesByChat.set(id, messageSnapshot.val() || {});
            recalculateUnread(id);
          }, () => setNotice('Could not check unread messages right now.'));
          unreadStops.set(id, stop);
        }
        recalculateUnread(id);
      }
      setThreads(current => current.filter(thread => ids.includes(thread.id)));
    }, () => setNotice('Your chats are temporarily unavailable. Please try again.'));

    return () => {
      stopPeople();
      stopIndex();
      chatStops.forEach(stop => stop());
      unreadStops.forEach(stop => stop());
      chatStops.clear();
      unreadStops.clear();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!active) {
      setMessages([]);
      return;
    }
    const stop = onValue(ref(rtdb, `chats/${active.id}/messages`), snapshot => {
      const value = snapshot.val() || {};
      const next = Object.entries(value).map(([id, item]) => ({
        id,
        ...(item as Omit<ChatMessage, 'id'>),
      })) as ChatMessage[];
      next.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setMessages(next.slice(-300));
    }, () => setNotice('Could not load this conversation. Please try again.'));
    return stop;
  }, [active?.id]);

  useEffect(() => {
    if (!user || !active) return;
    set(ref(rtdb, `userChats/${user.uid}/${active.id}/lastReadAt`), serverTimestamp())
      .catch(() => undefined);
  }, [user?.uid, active?.id, messages.length]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    isSupported().then(supported => {
      if (supported && alive) stop = onMessage(getMessaging(firebaseApp), payload => {
        const title = payload.notification?.title || 'New Bishwa message';
        const body = payload.notification?.body || 'You received a new message.';
        setNotice(title + ': ' + body);
      });
    }).catch(() => undefined);
    return () => { alive = false; stop?.(); };
  }, []);

  const filteredPeople = useMemo(
    () => people.filter(person => person.displayName?.toLowerCase().includes(search.toLowerCase())),
    [people, search]
  );

  const openChat = async (person: ChatUser) => {
    if (!user || person.uid === user.uid) return;
    const members = [user.uid, person.uid].sort();
    const id = members.join('__');
    const names = {
      [user.uid]: user.displayName || user.email || 'Bishwa user',
      [person.uid]: person.displayName || 'Bishwa user',
    };
    setNotice('');
    try {
      await update(ref(rtdb, `chats/${id}/meta`), {
        members: { [members[0]]: true, [members[1]]: true },
        memberNames: names,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await Promise.all(members.map(uid =>
        update(ref(rtdb, `userChats/${uid}/${id}`), { createdAt: serverTimestamp() })
      ));
      setActive({ id, members, memberNames: names });
      await set(ref(rtdb, `userChats/${user.uid}/${id}/lastReadAt`), serverTimestamp());
    } catch {
      setNotice('Could not start this chat. Please check your connection and try again.');
    }
  };

  const openExistingChat = (thread: ChatThread) => {
    setActive(thread);
    if (user) {
      void set(ref(rtdb, `userChats/${user.uid}/${thread.id}/lastReadAt`), serverTimestamp())
        .catch(() => setNotice('Could not update the message read status. Please try again.'));
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!user || !active || (!text && !selectedImage) || sending) return;
    const recipientUid = active.members.find(uid => uid !== user.uid);
    if (!recipientUid) return;
    setSending(true);
    setNotice('');
    try {
      let imageUrl = '';
      if (selectedImage) {
        setUploadingImage(true);
        imageUrl = await uploadChatImage(selectedImage);
      }
      const chatRef = ref(rtdb, `chats/${active.id}/meta`);
      const newMessageRef = push(ref(rtdb, `chats/${active.id}/messages`));
      const preview = text || (imageUrl ? '📷 Photo' : '');
      await set(newMessageRef, {
        senderId: user.uid,
        text,
        ...(imageUrl ? { imageUrl } : {}),
        createdAt: serverTimestamp(),
      });
      await update(chatRef, {
        lastMessage: preview.slice(0, 180),
        updatedAt: serverTimestamp(),
      });
      setDraft('');
      setSelectedImage(null);
      setUploadingImage(false);
      try {
        const idToken = await user.getIdToken();
        const result = await api.post('/api/messages/push', {
          idToken,
          senderUid: user.uid,
          recipientUid,
          conversationId: active.id,
          senderName: user.displayName || user.email || 'New message',
          messageText: preview,
        }) as { sent?: number };
        setNotice(result?.sent
          ? 'Message sent. Notification delivered to the recipient device.'
          : 'Message sent. The recipient may need to enable notifications on their device.');
      } catch (pushError) {
        console.warn('Message alert could not be delivered:', pushError);
        setNotice('Message sent, but the notification could not be confirmed. Ask the recipient to enable notifications.');
      }
    } catch (error) {
      setUploadingImage(false);
      setNotice(errorMessage(error, 'Could not send your message. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  const enableNotifications = async () => {
    if (!user) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setNotice('This browser does not support web push notifications. Try Chrome and allow notifications for Bishwa.');
      return;
    }
    try {
      const supported = await isSupported();
      if (!supported) {
        setNotice('Push notifications are not supported in this browser. In-app unread alerts will still work.');
        return;
      }
      const permission = await Notification.requestPermission();
      setPushState(permission);
      if (permission !== 'granted') {
        setNotice('Notification permission was not granted. Allow notifications in your browser site settings.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const token = await getToken(getMessaging(firebaseApp), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) throw new Error('Firebase did not return a device registration token.');
      const idToken = await user.getIdToken();
      await api.post('/api/messages/register-device', {
        idToken,
        token,
        platform: navigator.userAgent.slice(0, 120),
      });
      setNotice('Notifications are enabled on this device. You can now receive new message alerts.');
    } catch (error) {
      setNotice('Could not enable notifications: ' + errorMessage(error, 'Please check browser permissions and try again.'));
    }
  };

  const selectedPerson = active
    ? people.find(person => active.members.includes(person.uid) && person.uid !== user?.uid)
    : null;

  return (
    <div className="messages-layout">
      <aside className="messages-sidebar">
        <div className="messages-sidebar-title"><span>Chats</span><small>Find people and start a conversation</small></div>
        <div className="messages-search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search people" aria-label="Search people" /></div>
        <div className="messages-list-heading">PEOPLE</div>
        {filteredPeople.map(person => (
          <button key={person.uid} className="message-person" onClick={() => openChat(person)}>
            <span className="message-avatar">{person.photoURL ? <img src={person.photoURL} alt="" /> : <UserRound size={18} />}</span>
            <span><b>{person.displayName || 'Bishwa user'}</b><small>Tap to message</small></span>
            <MessageCircle size={16} />
          </button>
        ))}
        {!filteredPeople.length && <p className="messages-empty">No other registered profiles found yet.</p>}
        {threads.length > 0 && <>
          <div className="messages-list-heading">RECENT CHATS</div>
          {threads.map(thread => {
            const other = thread.members.find(uid => uid !== user?.uid) || '';
            const count = unread[thread.id] || 0;
            return (
              <button key={thread.id} className={active?.id === thread.id ? 'message-person selected' : 'message-person'} onClick={() => openExistingChat(thread)}>
                <span className="message-avatar"><UserRound size={18} /></span>
                <span className="message-person-copy"><b>{thread.memberNames?.[other] || people.find(person => person.uid === other)?.displayName || 'Bishwa user'}</b><small>{thread.lastMessage || 'Open conversation'}</small></span>
                {count > 0 && <span className="chat-unread-badge">{count > 99 ? '99+' : count}</span>}
              </button>
            );
          })}
        </>}
      </aside>
      <section className="messages-chat">
        {active ? <>
          <header className="messages-chat-head">
            <button className="messages-back" onClick={() => setActive(null)} aria-label="Back to chats">‹</button>
            <span className="message-avatar"><UserRound size={21} /></span>
            <div><b>{selectedPerson?.displayName || active.memberNames?.[active.members.find(uid => uid !== user?.uid) || ''] || 'Bishwa user'}</b><small>Direct conversation</small></div>
            <span className="messages-secure"><ShieldCheck size={16} /> Private</span>
          </header>
          <div className="messages-feed">
            {messages.map(message => (
              <div key={message.id} className={message.senderId === user?.uid ? 'message-bubble mine' : 'message-bubble'}>
                {message.imageUrl && <a className="chat-image-link" href={message.imageUrl} target="_blank" rel="noreferrer"><img className="chat-message-image" src={message.imageUrl} alt="Shared in chat" loading="lazy" /></a>}
                {message.text && <p>{message.text}</p>}
                <small>{message.senderId === user?.uid ? 'You' : 'User'} · {getTime(message.createdAt)}</small>
              </div>
            ))}
            {!messages.length && <div className="messages-empty chat-empty"><span className="chat-empty-icon"><MessageCircle size={25} /></span><b>Start the conversation</b><small>Send a message or share a photo.</small></div>}
          </div>
          {selectedImage && <div className="chat-image-preview"><img src={imagePreview} alt="Selected image preview" /><span>{selectedImage.name}</span><button type="button" onClick={() => setSelectedImage(null)} aria-label="Remove selected image"><X size={16} /></button></div>}
          <form className="messages-compose" onSubmit={sendMessage}>
            <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message…" maxLength={4000} aria-label="Write a message" />
            <input ref={imageInput} className="chat-image-input" type="file" accept="image/*" onChange={event => setSelectedImage(event.target.files?.[0] || null)} />
            <button type="button" className="chat-attach-button" onClick={() => imageInput.current?.click()} aria-label="Attach an image" title="Attach image" disabled={sending}><Paperclip size={19} /></button>
            <button type="submit" disabled={(!draft.trim() && !selectedImage) || sending} aria-label="Send message">{uploadingImage ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button>
          </form>
        </> : <div className="messages-welcome"><span><MessageCircle size={30} /></span><h2>Your Bishwa inbox</h2><p>Choose a registered user to start a private conversation. Messages sync live across signed-in devices.</p></div>}
      </section>
      <section className="messages-notifications">
        <div className="notification-card"><span className="notification-icon"><BellRing size={21} /></span><div><b>Message notifications</b><p>Get an alert when someone sends you a message, even when Bishwa is in the background.</p></div><small className="permission-status">{pushState === 'granted' ? 'PERMISSION ON' : pushState === 'denied' ? 'BLOCKED' : 'NOT ENABLED'}</small></div>
        <button className="enable-push-button" onClick={enableNotifications}><Bell size={17} /> {pushState === 'granted' ? 'Register this device' : 'Turn on notifications'}</button>
      </section>
      {notice && <div className="messages-notice" role="status">{notice}</div>}
    </div>
  );
}
