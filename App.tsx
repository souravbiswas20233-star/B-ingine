import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Messages from './Messages';
import Channel from './Channel';
import PublicChannels from './PublicChannels';
import HomeFeed from './HomeFeed';
import PostComments from './PostComments';
import NotificationCenter from './NotificationCenter';
import { api } from '@appdeploy/client';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { auth, db, getUserItems, replaceUserItems, rtdb } from './firebase';
import {
  Search,
  Menu,
  UserRound,
  Globe2,
  Image as ImageIcon,
  Video,
  Newspaper,
  MapPin,
  LayoutGrid,
  Clock3,
  Bookmark,
  Settings,
  Home,
  Mic,
  Camera,
  Zap,
  ShieldCheck,
  Star,
  Rocket,
  ArrowLeft,
  ExternalLink,
  Trash2,
  Play,
  Plus,
  X,
  Sun,
  Moon,
  ChevronRight,
  SlidersHorizontal,
  CircleHelp,
  History,
  Languages,
  Monitor,
  Bot,
  Sparkles,
  MessageCircle,
} from 'lucide-react';
import { BellRing } from 'lucide-react';
import { RadioTower } from 'lucide-react';

type Section =
  | 'Home'
  | 'Web'
  | 'Images'
  | 'Videos'
  | 'News'
  | 'Maps'
  | 'More'
  | 'History'
  | 'Bookmarks'
  | 'Settings'
  | 'Profile'
  | 'Gyan AI'
  | 'Messages'
  | 'Channel'
  | 'Channels';
type Entry = {
  id: string;
  query: string;
  type: string;
  date: string;
  url: string;
  kind?: 'search' | 'view';
  channelName?: string;
  channelId?: string;
  postId?: string;
};
const GYAN_AI_URL = 'https://gyan-ai-q0hmwg.v2.appdeploy.ai/';
const sections: { name: Section; icon: typeof Search; desc: string }[] = [
  { name: 'Web', icon: Globe2, desc: 'Explore pages across the web' },
  { name: 'Images', icon: ImageIcon, desc: 'Find visual inspiration' },
  { name: 'Videos', icon: Video, desc: 'Discover videos and clips' },
  { name: 'News', icon: Newspaper, desc: 'Catch up on current stories' },
  { name: 'Maps', icon: MapPin, desc: 'Explore places and directions' },
  { name: 'More', icon: LayoutGrid, desc: 'Discover more tools and destinations' },
];
const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const makeUrl = (query: string, type: string) => {
  const q = encodeURIComponent(query);
  if (type === 'Images') return `https://www.bing.com/images/search?q=${q}`;
  if (type === 'Videos') return `https://www.bing.com/videos/search?q=${q}`;
  if (type === 'News') return `https://www.bing.com/news/search?q=${q}`;
  if (type === 'Maps') return `https://www.bing.com/maps?q=${q}`;
  return `https://www.bing.com/search?q=${q}`;
};

function App() {
  const [page, setPage] = useState<Section>('Home');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeType, setActiveType] = useState('Web');
  const [historyItems, setHistoryItems] = useState<Entry[]>(() =>
    readStore('bishwa-history', [])
  );
  const [bookmarks, setBookmarks] = useState<Entry[]>(() =>
    readStore('bishwa-bookmarks', [])
  );
  const [dark, setDark] = useState(() => readStore('bishwa-dark', false));
  const [compact, setCompact] = useState(() =>
    readStore('bishwa-compact', false)
  );
  const [pushVapidKey, setPushVapidKey] = useState(() =>
    localStorage.getItem('bishwa-fcm-vapid') || 'BGYDjfigCa5e9yroalmbFyI6LLQx2fesdC3ZPdax76lUX7Ng3XQ-FvuC5gpCMjMQlt13TlKgPNBHcnOZfH8tjeo'
  );
  const [pushKeySaved, setPushKeySaved] = useState(() => Boolean(localStorage.getItem('bishwa-fcm-vapid')));
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileName, setProfileName] = useState(() =>
    readStore('bishwa-profile', 'Guest Explorer')
  );
  const [toast, setToast] = useState('');
  const [showIntro, setShowIntro] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [showChannelPrompt, setShowChannelPrompt] = useState(false);
  const [hasOwnChannel, setHasOwnChannel] = useState(false);
  const [showVerifiedNotice, setShowVerifiedNotice] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      setAuthUser(user);
      if (user) {
        import('./firebase').then(({ saveUserProfile }) => saveUserProfile(user).catch(error => console.error('Firebase profile sync failed:', error)));
      }
      setAuthChecked(true);
      setCloudReady(false);
      if (!user) {
        setCloudReady(true);
        return;
      }
      try {
        const [cloudHistory, cloudBookmarks] = await Promise.all([
          getUserItems<Entry>(user.uid, 'history'),
          getUserItems<Entry>(user.uid, 'bookmarks'),
        ]);
        const localHistory = readStore<Entry[]>('bishwa-history', []);
        const localBookmarks = readStore<Entry[]>('bishwa-bookmarks', []);
        const mergedHistory = [...cloudHistory, ...localHistory.filter(local => !cloudHistory.some(cloud => cloud.id === local.id))];
        const mergedBookmarks = [...cloudBookmarks, ...localBookmarks.filter(local => !cloudBookmarks.some(cloud => cloud.id === local.id))];
        setHistoryItems(mergedHistory.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150));
        setBookmarks(mergedBookmarks.sort((a, b) => b.date.localeCompare(a.date)));
        setProfileName(user.displayName || (user.email ? user.email.split('@')[0] : 'Bishwa user'));
      } catch (error) {
        console.error('Firebase data load failed:', error);
        setToast('Could not load cloud data. Check Firebase rules.');
      } finally {
        setCloudReady(true);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authUser || !cloudReady) return;
    replaceUserItems(authUser.uid, 'history', historyItems).catch(error => console.error('Firebase history sync failed:', error));
  }, [authUser, cloudReady, historyItems]);
  useEffect(() => {
    if (!authUser || !cloudReady) return;
    replaceUserItems(authUser.uid, 'bookmarks', bookmarks).catch(error => console.error('Firebase bookmarks sync failed:', error));
  }, [authUser, cloudReady, bookmarks]);

  useEffect(() => {
    const introTimer = window.setTimeout(() => setShowIntro(false), 3200);
    return () => window.clearTimeout(introTimer);
  }, []);

  useEffect(() => {
    if (!authChecked || !authUser || showIntro) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const ownedChannels = await getDocs(
          query(collection(db, 'channels'), where('ownerId', '==', authUser.uid))
        );
        if (!active) return;
        setHasOwnChannel(!ownedChannels.empty);
      } catch (error) {
        console.error('Could not check the signed-in user channel:', error);
        if (!active) return;
        setHasOwnChannel(false);
      }
      if (active) setShowChannelPrompt(true);
    }, 900);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [authChecked, authUser, showIntro]);

  useEffect(() => {
    if (!authUser || showIntro) return;
    let active = true;
    const checkVerificationNotice = async () => {
      try {
        const idToken = await authUser.getIdToken();
        const response = await api.post('/api/account/verification-notice', { idToken });
        if (active && response.data?.showNotice) setShowVerifiedNotice(true);
      } catch (error) {
        console.error('Bishwa verification notice check failed:', error);
      }
    };
    void checkVerificationNotice();
    return () => { active = false; };
  }, [authUser, showIntro]);

  useEffect(() => {
    if (!authUser) {
      setUnreadMessagesCount(0);
      return;
    }
    const messageStops = new Map<string, () => void>();
    const lastReadByChat = new Map<string, number>();
    const messagesByChat = new Map<string, Record<string, { senderId?: string; createdAt?: number }>>();
    const recalculateTotal = () => {
      let total = 0;
      for (const [chatId, records] of messagesByChat) {
        const lastReadAt = lastReadByChat.get(chatId) || 0;
        total += Object.values(records).filter(message =>
          message.senderId !== authUser.uid && Number(message.createdAt || 0) > lastReadAt
        ).length;
      }
      setUnreadMessagesCount(total);
    };
    const stopIndex = onValue(ref(rtdb, 'userChats/' + authUser.uid), snapshot => {
      const index = snapshot.val() || {};
      const chatIds = Object.keys(index);
      for (const [chatId, stop] of messageStops) {
        if (!chatIds.includes(chatId)) {
          stop();
          messageStops.delete(chatId);
          lastReadByChat.delete(chatId);
          messagesByChat.delete(chatId);
        }
      }
      for (const chatId of chatIds) {
        const entry = index[chatId];
        lastReadByChat.set(chatId, Number(entry?.lastReadAt || 0));
        if (!messageStops.has(chatId)) {
          const stop = onValue(ref(rtdb, 'chats/' + chatId + '/messages'), messageSnapshot => {
            messagesByChat.set(chatId, messageSnapshot.val() || {});
            recalculateTotal();
          }, () => setUnreadMessagesCount(0));
          messageStops.set(chatId, stop);
        }
      }
      recalculateTotal();
    }, () => setUnreadMessagesCount(0));
    return () => {
      stopIndex();
      messageStops.forEach(stop => stop());
      messageStops.clear();
    };
  }, [authUser?.uid]);

  useEffect(() => {
    localStorage.setItem('bishwa-history', JSON.stringify(historyItems));
  }, [historyItems]);
  useEffect(() => {
    localStorage.setItem('bishwa-bookmarks', JSON.stringify(bookmarks));
  }, [bookmarks]);
  useEffect(() => {
    localStorage.setItem('bishwa-dark', JSON.stringify(dark));
  }, [dark]);
  useEffect(() => {
    localStorage.setItem('bishwa-compact', JSON.stringify(compact));
  }, [compact]);
  useEffect(() => {
    localStorage.setItem('bishwa-profile', JSON.stringify(profileName));
  }, [profileName]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);
  const savePushVapidKey = () => {
    const cleanKey = pushVapidKey.trim();
    if (!cleanKey) {
      notify('Enter the Firebase VAPID public key first');
      return;
    }
    localStorage.setItem('bishwa-fcm-vapid', cleanKey);
    setPushVapidKey(cleanKey);
    setPushKeySaved(true);
    notify('Push notification key saved on this device');
  };
  const runSearch = (term = query, type = activeType) => {
    const clean = term.trim();
    if (!clean) {
      notify('Enter something to search');
      return;
    }
    const url = makeUrl(clean, type);
    const item: Entry = {
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      query: clean,
      type,
      date: new Date().toISOString(),
      url,
      kind: 'search',
    };
    setHistoryItems(old => [item, ...old].slice(0, 150));
    setActiveQuery(clean);
    setActiveType(type);
    setQuery(clean);
    setPage(type as Section);
  };
  const recordView = useCallback((post: { id: string; title: string; type: 'video' | 'image' | 'post'; mediaUrl?: string }, channel: { id: string; name: string }) => {
    const item: Entry = {
      id: 'view_' + post.id,
      query: post.title,
      type: post.type === 'video' ? 'Viewed video' : post.type === 'image' ? 'Viewed photo' : 'Viewed post',
      date: new Date().toISOString(),
      url: post.mediaUrl || '',
      kind: 'view',
      channelName: channel.name,
      channelId: channel.id,
      postId: post.id,
    };
    setHistoryItems(old => [item, ...old.filter(entry => entry.id !== item.id)].slice(0, 150));
  }, []);
  const replay = (item: Entry) => {
    if (item.kind === 'view') {
      if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
      else setPage('Channels');
      return;
    }
    setQuery(item.query);
    setActiveQuery(item.query);
    setActiveType(item.type);
    setPage(item.type as Section);
  };
  const saveBookmark = (item?: Entry) => {
    const target =
      item ??
      (activeQuery
        ? {
            id: 'b' + Date.now(),
            query: activeQuery,
            type: activeType,
            date: new Date().toISOString(),
            url: makeUrl(activeQuery, activeType),
          }
        : null);
    if (!target) {
      notify('Search something before bookmarking');
      return;
    }
    if (
      bookmarks.some(b => b.query === target.query && b.type === target.type)
    ) {
      notify('Already in bookmarks');
      return;
    }
    setBookmarks(old => [target, ...old]);
    notify('Saved to bookmarks');
  };
  const removeHistory = (id: string) =>
    setHistoryItems(old => old.filter(x => x.id !== id));
  const removeBookmark = (id: string) =>
    setBookmarks(old => old.filter(x => x.id !== id));
  const openExternal = (item?: Entry) => {
    const url = item?.url ?? makeUrl(activeQuery, activeType);
    if (!activeQuery && !item) {
      notify('Search something first');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const currentSection = sections.find(s => s.name === page);
  const groupedHistory = useMemo(() => {
    const groups: Record<string, Entry[]> = {};
    historyItems.forEach(item => {
      const day = new Date(item.date).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      (groups[day] ??= []).push(item);
    });
    return Object.entries(groups);
  }, [historyItems]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        notify('Bishwa account created');
      } else {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        notify('Signed in successfully');
      }
      setAuthPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setAuthError(message.replace('Firebase: ', ''));
    } finally {
      setAuthBusy(false);
    }
  };
  const signInWithGoogle = async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (window.matchMedia('(max-width: 768px)').matches) {
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
      notify('Signed in with Google successfully');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const message = code === 'auth/unauthorized-domain'
        ? 'This app domain is not authorized in Firebase. Add bishwa-search-engine-ikb6hy.v2.appdeploy.ai in Authentication settings → Authorized domains.'
        : code === 'auth/popup-blocked'
          ? 'The sign-in popup was blocked. Please allow popups and try again.'
          : error instanceof Error ? error.message : 'Google sign-in failed';
      setAuthError(message.replace('Firebase: ', ''));
    } finally {
      setAuthBusy(false);
    }
  };
  const nav = (next: Section) => {
    setPage(next);
    setMenuOpen(false);
  };
  const SearchBox = ({ large = false }: { large?: boolean }) => (
    <form
      className={large ? 'search-box search-box-large' : 'search-box'}
      onSubmit={e => {
        e.preventDefault();
        runSearch();
      }}
    >
      <Search size={large ? 25 : 20} className="search-leading" />
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search anything..."
        aria-label="Search anything"
      />
      <button
        type="button"
        className="icon-button search-tool"
        title="Voice search"
        onClick={() => notify('Voice search is coming soon')}
      >
        <Mic size={20} />
      </button>
      <button
        type="button"
        className="icon-button search-tool"
        title="Visual search"
        onClick={() => notify('Visual search is coming soon')}
      >
        <Camera size={20} />
      </button>
      <button className="search-submit" type="submit">
        Search
      </button>
    </form>
  );
  const navItems: { name: Section; icon: typeof Search }[] = [
    { name: 'Home', icon: Home },
    { name: 'History', icon: Clock3 },
    { name: 'Bookmarks', icon: Bookmark },
    { name: 'Settings', icon: Settings },
  ];

  if (!authChecked) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <div className="auth-gate-brand"><span className="auth-gate-mark"><Globe2 size={30} /></span><div><strong>Bishwa</strong><small>SEARCH ENGINE</small></div></div>
          <div className="auth-gate-heading"><span className="auth-gate-eyebrow">WELCOME TO BISHWA</span><h1>One account.<br />A smarter search.</h1><p>Checking your secure sign-in session…</p></div>
          <div className="auth-gate-loading"><span /></div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card">
          <div className="auth-gate-brand"><span className="auth-gate-mark"><Globe2 size={30} /></span><div><strong>Bishwa</strong><small>SEARCH ENGINE</small></div></div>
          <div className="auth-gate-heading"><span className="auth-gate-eyebrow">WELCOME TO BISHWA</span><h1>Search beyond<br />boundaries.</h1><p>Sign in to continue. Your searches and bookmarks will stay synced to your account.</p></div>
          <button type="button" className="auth-google-button" onClick={signInWithGoogle} disabled={authBusy}><span className="auth-google-g">G</span>{authBusy ? 'Please wait…' : 'Continue with Google'}</button>
          <div className="auth-gate-divider"><span />OR CONTINUE WITH EMAIL<span /></div>
          <form className="auth-gate-form" onSubmit={submitAuth}>
            <label htmlFor="gate-email">Email address</label>
            <input id="gate-email" type="email" autoComplete="email" required value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="you@example.com" />
            <label htmlFor="gate-password">Password</label>
            <input id="gate-password" type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={6} required value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="At least 6 characters" />
            {authError && <small className="auth-gate-error" role="alert">{authError}</small>}
            <button type="submit" className="auth-email-button" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign in with email' : 'Create account with email'}</button>
          </form>
          <div className="auth-gate-switch">{authMode === 'signin' ? 'New to Bishwa? ' : 'Already have an account? '}<button type="button" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }}>{authMode === 'signin' ? 'Create an account' : 'Sign in'}</button></div>
          <p className="auth-gate-terms">Secure sign-in powered by Firebase Authentication.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={(dark ? 'app dark' : 'app') + (page === 'Maps' ? ' maps-mode' : '')}>
      {showIntro && (
        <div className="intro-screen" role="status" aria-label="Bishwa digital intelligence studio">
          <div className="intro-grid" />
          <div className="intro-core">
            <span className="intro-orbit orbit-a" />
            <span className="intro-orbit orbit-b" />
            <span className="intro-orbit orbit-c" />
            <span className="intro-logo"><Globe2 size={54} strokeWidth={1.5} /></span>
            <span className="intro-pulse" />
          </div>
          <div className="intro-wordmark">Bishwa</div>
          <div className="intro-tagline">SEARCH ENGINE</div>
          <div className="intro-company">BISHWA INTALLIGE STUDIO</div>
          <div className="intro-loading"><span /></div>
        </div>
      )}
      <header className={page === 'Home' ? 'topbar home-topbar' : 'topbar'}>
        <button
          className="icon-button menu-trigger"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <button
          className="brand"
          onClick={() => nav('Home')}
          aria-label="Bishwa home"
        >
          <span className="brand-mark">
            <Globe2 size={25} />
          </span>
          <span>
            <b>Bishwa</b>
            <small>SEARCH ENGINE</small>
          </span>
        </button>
        <div className="top-actions">
          <button className="icon-button topbar-message-button" onClick={() => nav('Messages')} title="Messages" aria-label="Open messages">
            <MessageCircle size={19} />
            {unreadMessagesCount > 0 && <span className="topbar-message-unread" aria-label={unreadMessagesCount + ' unread messages'}>{unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}</span>}
          </button>
          <NotificationCenter onEnable={() => nav('Messages')} />
          <button
            className="icon-button theme-toggle"
            onClick={() => setDark(v => !v)}
            title="Toggle theme"
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          <button className="profile-chip" onClick={() => setMenuOpen(value => !value)} aria-label="Open account menu">
            <span className="avatar">
              <UserRound size={17} />
            </span>
            <span className="profile-label">{profileName}</span>
          </button>
        </div>
      </header>

      {menuOpen && (
        <>
          <button
            className="scrim"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />
          <aside className="drawer">
            <div className="drawer-head">
              <b>Explore Bishwa</b>
              <button
                className="icon-button"
                onClick={() => setMenuOpen(false)}
              >
                <X />
              </button>
            </div>
            {[
              { name: 'Home' as Section, icon: Home },
              ...sections,
              ...navItems.filter(n => n.name !== 'Home'),
              { name: 'Messages' as Section, icon: MessageCircle },
              { name: 'Channels' as Section, icon: RadioTower },
              { name: 'Channel' as Section, icon: RadioTower },
              { name: 'Profile' as Section, icon: UserRound },
              { name: 'Gyan AI' as Section, icon: Bot },
            ].map(item => (
              <button
                key={item.name}
                className={
                  'drawer-link ' + (page === item.name ? 'selected' : '')
                }
                onClick={() => nav(item.name)}
              >
                <item.icon size={19} />
                {item.name}
                <ChevronRight size={16} />
              </button>
            ))}
          </aside>
        </>
      )}

      <main className={(compact ? 'main compact' : 'main') + (page === 'Maps' ? ' maps-main' : '')}>
        {page === 'Home' && (
          <>
          <section className="hero">
            <div className="hero-orb orb-one" />
            <div className="hero-orb orb-two" />
            <div className="hero-copy">
              <div className="hero-tagline">Search Smarter <span>•</span> Explore More</div>
            </div>
            <div className="hero-search">
              <SearchBox large />
            </div>
            <div className="home-feed-strip" aria-label="Explore categories">
              {sections.map(s => (
                <button key={s.name} className={activeType === s.name ? 'home-feed-chip active' : 'home-feed-chip'} onClick={() => { setActiveType(s.name); nav(s.name); }}>
                  <s.icon size={17} /><span>{s.name}</span>
                </button>
              ))}
              <button className="home-feed-chip" onClick={() => nav('Channels')}><RadioTower size={17} /><span>Channels</span></button>
            </div>
            <div className="feature-grid">
              <button
                className="feature-card blue"
                onClick={() => {
                  setActiveType('Web');
                  nav('Web');
                }}
              >
                <span className="feature-icon">
                  <Zap size={27} />
                </span>
                <span>
                  <b>Fast Search</b>
                  <small>Get results instantly</small>
                </span>
                <ChevronRight />
              </button>
              <button
                className="feature-card green"
                onClick={() => nav('Settings')}
              >
                <span className="feature-icon">
                  <ShieldCheck size={27} />
                </span>
                <span>
                  <b>Safe &amp; Secure</b>
                  <small>Your privacy first</small>
                </span>
                <ChevronRight />
              </button>
              <button
                className="feature-card amber"
                onClick={() => nav('Bookmarks')}
              >
                <span className="feature-icon">
                  <Star size={27} />
                </span>
                <span>
                  <b>Smart Results</b>
                  <small>More relevant results</small>
                </span>
                <ChevronRight />
              </button>
              <button
                className="feature-card violet"
                onClick={() => nav('More')}
              >
                <span className="feature-icon">
                  <Rocket size={27} />
                </span>
                <span>
                  <b>Discover More</b>
                  <small>Explore the world</small>
                </span>
                <ChevronRight />
              </button>
            </div>
            <button className="feature-card blue" onClick={() => nav('Channels')}>
              <span className="feature-icon"><RadioTower size={27} /></span>
              <span><b>Public Channels</b><small>Discover creators and subscribe</small></span>
              <ChevronRight />
            </button>
            <button className="gyan-home-card" onClick={() => nav('Gyan AI')}>
              <span className="gyan-home-icon"><Bot size={25} /></span>
              <span className="gyan-home-copy">
                <small><Sparkles size={12} /> COMPANY AI ASSISTANT</small>
                <b>Meet Gyan AI</b>
                <span>Your dedicated AI companion from the Bishwa team</span>
              </span>
              <span className="gyan-home-cta">Explore AI <ChevronRight size={17} /></span>
            </button>

          </section>
          <HomeFeed notify={notify} onView={recordView} />
          </>
        )}

        {page !== 'Home' && (
          <section className="page-view">
            <div className="page-heading">
              <div>
                <span className="eyebrow">BISHWA / {page.toUpperCase()}</span>
                <h1>
                  {page === 'Profile'
                    ? 'Your profile'
                    : page === 'History'
                      ? 'Search history'
                      : page === 'Bookmarks'
                        ? 'Saved discoveries'
                        : page === 'Settings'
                          ? 'Preferences'
                          : page === 'More'
                            ? 'Explore more'
                            : page === 'Gyan AI'
                              ? 'Meet Gyan AI'
                              : page === 'Messages'
                                ? 'Your messages'
                                : page === 'Channel'
                                  ? 'My channel'
                                  : page === 'Channels'
                                    ? 'Public channels'
                                    : page + ' search'}
                </h1>
                <p>
                  {page === 'History'
                    ? 'Pick up where you left off. Replay any previous search in one click.'
                    : page === 'Bookmarks'
                      ? 'Your saved searches, ready whenever you need them.'
                      : page === 'Settings'
                        ? 'Shape a search space that feels right for you.'
                        : page === 'Profile'
                          ? 'Manage your local Bishwa profile.'
                          : page === 'More'
                            ? 'Choose a search destination for your next discovery.'
                            : page === 'Gyan AI'
                              ? 'Your company’s dedicated AI assistant, designed to help you think, create and explore.'
                              : page === 'Messages'
                                ? 'Chat privately with any registered Bishwa user and receive message notifications.'
                                : page === 'Channel'
                                  ? 'Create your own channel and publish videos, photos and posts.'
                                  : page === 'Channels'
                                    ? 'Discover public creators, view their channels and subscribe.'
                                    : (currentSection?.desc ??
                                'Discover more with Bishwa.')}
                </p>
              </div>
              <button className="back-button" onClick={() => nav('Home')}>
                <ArrowLeft size={17} /> Home
              </button>
            </div>

            {page === 'Messages' && <Messages />}
            {page === 'Channel' && <Channel notify={notify} />}
            {page === 'Channels' && <PublicChannels notify={notify} onView={recordView} />

            }{sections.some(s => s.name === page) && (
              <div className="results-panel">
                <div className="search-area">
                  <SearchBox />
                </div>
                <div className="result-tabs">
                  {sections.map(s => (
                    <button
                      key={s.name}
                      className={activeType === s.name ? 'tab active' : 'tab'}
                      onClick={() => {
                        setActiveType(s.name);
                        setPage(s.name);
                      }}
                    >
                      <s.icon size={16} />
                      {s.name}
                    </button>
                  ))}
                </div>
                {page === 'Maps' ? (
                  <section className="bishwa-map-results">
                    <div className="bishwa-map-heading">
                      <div className="bishwa-map-title"><span className="channel-kicker"><MapPin size={14} /> BISHWA MAPS</span><h2>{activeQuery || 'Explore India'}</h2><p>Explore the map, zoom in and move around freely.</p></div>
                      <div className="bishwa-map-actions">
                        <button className="secondary-button" onClick={() => openExternal()} disabled={!activeQuery}><ExternalLink size={16} /> Directions</button>
                        <button className="secondary-button" onClick={() => nav('Home')}><ArrowLeft size={16} /> Back</button>
                      </div>
                    </div>
                    <iframe
                      title="Bishwa Maps results"
                      src={'https://www.google.com/maps?q=' + encodeURIComponent(activeQuery || 'India') + '&output=embed'}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      allowFullScreen
                    />
                  </section>
                ) : (
                  <>
                    {activeQuery && (
                      <div className="live-result-card">
                        <div className="result-badge"><ExternalLink size={17} /> LIVE SEARCH</div>
                        <h2>{activeQuery}</h2>
                        <p>Your {page.toLowerCase()} search is ready. You can also explore public creator content below.</p>
                        <div className="result-actions">
                          <button className="primary-button" onClick={() => openExternal()}>
                            <ExternalLink size={17} /> Open live {page.toLowerCase()} results
                          </button>
                          <button className="secondary-button" onClick={() => saveBookmark()}>
                            <Bookmark size={17} /> Save search
                          </button>
                        </div>
                        <small className="provider-note">Live web search is supplied by Bing. Public creator uploads are shown below inside Bishwa.</small>
                      </div>
                    )}
                    <HomeFeed
                      notify={notify}
                      onView={recordView}
                      filterType={page === 'Images' ? 'image' : page === 'Videos' ? 'video' : page === 'News' ? 'post' : 'all'}
                      heading={page === 'Images' ? 'Public photos' : page === 'Videos' ? 'Public videos' : page === 'News' ? 'Creator updates' : 'Explore public content'}
                    />
                  </>
                )}
              </div>
            )}

            {page === 'History' && (
              <div className="content-panel">
                <div className="panel-toolbar">
                  <div>
                    <b>{historyItems.length} activities</b>
                    <small>Searches and viewed content · Synced to your account</small>
                  </div>
                  <button
                    className="text-button danger"
                    disabled={!historyItems.length}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Clear all search history on this device?'
                        )
                      )
                        setHistoryItems([]);
                    }}
                  >
                    {' '}
                    <Trash2 size={16} /> Clear history
                  </button>
                </div>
                {groupedHistory.length ? (
                  groupedHistory.map(([day, items]) => (
                    <div className="history-group" key={day}>
                      <h3>{day}</h3>
                      {items.map(item => (
                        <div className="history-row" key={item.id}>
                          <span className="row-icon">
                            {item.kind === 'view' ? <Play size={18} /> : <History size={18} />}
                          </span>
                          <button
                            className="history-main"
                            onClick={() => replay(item)}
                          >
                            <b>{item.query}</b>
                            <small>
                              {item.type}{item.channelName ? ' · ' + item.channelName : ''} ·{' '}
                              {new Date(item.date).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </small>
                          </button>
                          <button
                            className="icon-button row-action"
                            title={item.kind === 'view' ? 'Open viewed content' : 'Replay search'}
                            onClick={() => replay(item)}
                          >
                            <Play size={17} />
                          </button>
                          {item.kind !== 'view' && <button
                            className="icon-button row-action"
                            title="Open live results"
                            onClick={() => openExternal(item)}
                          >
                            <ExternalLink size={17} />
                          </button>}
                          <button
                            className="icon-button row-action"
                            title="Remove"
                            onClick={() => removeHistory(item.id)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Clock3 size={27} />
                    </span>
                    <h3>No searches yet</h3>
                    <p>
                      Your searches will appear here, grouped by date. You can
                      replay any search later.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => nav('Home')}
                    >
                      Start searching
                    </button>
                  </div>
                )}
              </div>
            )}

            {page === 'Bookmarks' && (
              <div className="content-panel bookmarks-panel">
                <div className="panel-toolbar">
                  <div>
                    <b>{bookmarks.length} saved items</b>
                    <small>Available on this device</small>
                  </div>
                </div>
                {bookmarks.length ? (
                  bookmarks.map(item => (
                    <div className="history-row" key={item.id}>
                      <span className="row-icon bookmark-row-icon">
                        <Bookmark size={18} />
                      </span>
                      <button
                        className="history-main"
                        onClick={() => replay(item)}
                      >
                        <b>{item.query}</b>
                        <small>
                          {item.type} · Saved{' '}
                          {new Date(item.date).toLocaleDateString()}
                        </small>
                      </button>
                      <button
                        className="icon-button row-action"
                        title="Open"
                        onClick={() => openExternal(item)}
                      >
                        <ExternalLink size={17} />
                      </button>
                      <button
                        className="icon-button row-action"
                        title="Remove bookmark"
                        onClick={() => removeBookmark(item.id)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Bookmark size={27} />
                    </span>
                    <h3>Your bookmarks live here</h3>
                    <p>
                      Run a search and tap “Save search” to keep it for later.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => nav('Home')}
                    >
                      Explore Bishwa
                    </button>
                  </div>
                )}
              </div>
            )}

            {page === 'Settings' && (
              <div className="settings-grid settings-page">
                <div className="setting-card">
                  <span className="setting-icon">
                    <Sun size={20} />
                  </span>
                  <div>
                    <b>Appearance</b>
                    <p>Choose a comfortable color theme.</p>
                    <div className="setting-controls">
                      <button
                        className={dark ? 'choice' : 'choice chosen'}
                        onClick={() => setDark(false)}
                      >
                        <Sun size={16} /> Light
                      </button>
                      <button
                        className={dark ? 'choice chosen' : 'choice'}
                        onClick={() => setDark(true)}
                      >
                        <Moon size={16} /> Dark
                      </button>
                    </div>
                  </div>
                </div>
                <div className="setting-card">
                  <span className="setting-icon">
                    <Monitor size={20} />
                  </span>
                  <div>
                    <b>Layout density</b>
                    <p>Adjust the amount of space on screen.</p>
                    <div className="setting-controls">
                      <button
                        className={!compact ? 'choice chosen' : 'choice'}
                        onClick={() => setCompact(false)}
                      >
                        Comfortable
                      </button>
                      <button
                        className={compact ? 'choice chosen' : 'choice'}
                        onClick={() => setCompact(true)}
                      >
                        Compact
                      </button>
                    </div>
                  </div>
                </div>
                <div className="setting-card">
                  <span className="setting-icon">
                    <Languages size={20} />
                  </span>
                  <div>
                    <b>Language</b>
                    <p>Interface language</p>
                    <span className="static-value">
                      English <span>Default</span>
                    </span>
                  </div>
                </div>
                <div className="setting-card messaging-config-card">
                  <span className="setting-icon"><BellRing size={20} /></span>
                  <div>
                    <b>Push Notification Setup</b>
                    <p>Configure the Firebase Web Push VAPID public key for this browser. This is a public key, not a private service-account secret.</p>
                    <label className="config-field-label" htmlFor="settings-vapid-key">Firebase Web Push VAPID Public Key</label>
                    <input id="settings-vapid-key" className="config-key-input" value={pushVapidKey} onChange={event => { setPushVapidKey(event.target.value); setPushKeySaved(false); }} placeholder="Paste your Firebase VAPID public key" autoComplete="off" />
                    <div className="config-actions">
                      <button className="primary-button config-save-button" onClick={savePushVapidKey}>Save public key</button>
                      <span className={pushKeySaved ? 'config-state config-state-saved' : 'config-state'}>{pushKeySaved ? 'Saved on this device' : 'Not saved yet'}</span>
                    </div>
                    <small className="config-note">After saving, open Messages and tap Enable notifications to register this device.</small>
                  </div>
                </div>
                <div className="setting-card messaging-config-card">
                  <span className="setting-icon"><MessageCircle size={20} /></span>
                  <div>
                    <b>In-App Messaging Setup</b>
                    <p>Your private conversations stay in sync across your signed-in devices.</p>
                    <div className="config-status-list">
                      <span><i className="config-status-dot" /> Your Bishwa account: {authUser ? 'Connected' : 'Sign in to chat'}</span>
                      <span><i className="config-status-dot" /> Private messaging: Ready</span>
                    </div>
                  </div>
                </div>
                <div className="setting-card">
                  <span className="setting-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <b>Privacy & data</b>
                    <p>
                      History and bookmarks are saved in this browser on this
                      device. Clearing browser site data may remove them.
                    </p>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            'Clear Bishwa history and bookmarks from this device?'
                          )
                        ) {
                          setHistoryItems([]);
                          setBookmarks([]);
                          notify('Local search data cleared');
                        }
                      }}
                    >
                      {' '}
                      <Trash2 size={16} /> Clear local search data
                    </button>
                  </div>
                </div>
              </div>
            )}

            {page === 'Gyan AI' && (
              <section className="gyan-chat-shell">
                <div className="gyan-chat-banner">
                  <div className="gyan-orbit"><span /><span /><span /><Bot size={34} /></div>
                  <div className="gyan-banner-copy">
                    <span className="gyan-kicker"><Sparkles size={13} /> BISHWA INTELLIGENCE</span>
                    <h2>One company. One AI companion.</h2>
                    <p>Meet Gyan AI — the official conversational assistant of our company.</p>
                  </div>
                  <span className="gyan-status"><i /> {GYAN_AI_URL ? 'CONNECTED' : 'AWAITING CONNECTION'}</span>
                </div>
                <div className="gyan-chat-body">
                  <div className="gyan-welcome-icon"><Bot size={27} /></div>
                  <span className="gyan-welcome-label">WELCOME TO GYAN AI</span>
                  <h3>How can I help you today?</h3>
                  <p>Ask questions, explore ideas and get help from your company’s dedicated AI assistant.</p>
                  <div className="gyan-suggestions">
                    <span>Ask a question</span><span>Explore an idea</span><span>Get creative help</span>
                  </div>
                  {GYAN_AI_URL ? (
                    <a className="gyan-connect-button" href={GYAN_AI_URL} target="_blank" rel="noreferrer">
                      <Bot size={18} /> Start chatting with Gyan AI <ExternalLink size={16} />
                    </a>
                  ) : (
                    <div className="gyan-pending-card">
                      <div><b>Gyan AI is ready for its connection</b><small>Send us your Gyan AI link and this button will open the official chatbot.</small></div>
                      <span>LINK NEEDED</span>
                    </div>
                  )}
                  <small className="gyan-privacy-note"><ShieldCheck size={13} /> Official company assistant · Accessible from Bishwa</small>
                </div>
              </section>
            )}

            {page === 'More' && (
              <div className="more-grid">
                {[
                  {
                    name: 'Advanced search',
                    icon: SlidersHorizontal,
                    desc: 'Narrow your search with more precise terms',
                    action: () => {
                      setActiveType('Web');
                      setQuery('');
                      nav('Web');
                    },
                  },
                  {
                    name: 'Recent activity',
                    icon: Clock3,
                    desc: 'Review and replay previous searches',
                    action: () => nav('History'),
                  },
                  {
                    name: 'Saved items',
                    icon: Bookmark,
                    desc: 'Return to your bookmarked searches',
                    action: () => nav('Bookmarks'),
                  },
                  {
                    name: 'Help & tips',
                    icon: CircleHelp,
                    desc: 'Learn how to get more from Bishwa',
                    action: () =>
                      notify('Tip: use specific phrases for focused searches'),
                  },
                ].map(item => (
                  <button
                    className="more-card"
                    key={item.name}
                    onClick={item.action}
                  >
                    <span className="category-icon">
                      <item.icon size={22} />
                    </span>
                    <b>{item.name}</b>
                    <small>{item.desc}</small>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
            )}

            {page === 'Profile' && (
              <div className="content-panel profile-panel">
                <section className="setting-card" style={{ width: '100%', marginBottom: 22 }}>
                  <span className="setting-icon"><ShieldCheck size={20} /></span>
                  <div style={{ width: '100%' }}>
                    <b>Firebase account</b>
                    <p>{authUser ? `Signed in as ${authUser.displayName || authUser.email || 'Bishwa user'}. Your history and bookmarks sync to your account.` : 'Sign in or create a free Bishwa account to sync your history and bookmarks across devices.'}</p>
                    {authUser ? (
                      <div className="setting-controls">
                        <span className="static-value">{cloudReady ? 'Cloud sync ready' : 'Loading cloud data…'}</span>
                        <button className="secondary-button" onClick={() => signOut(auth).then(() => notify('Signed out'))}>Sign out</button>
                      </div>
                    ) : (
                      <form className="profile-form" onSubmit={submitAuth} style={{ width: '100%', maxWidth: 440 }}>
                        <div className="setting-controls">
                          <button type="button" className={authMode === 'signin' ? 'choice chosen' : 'choice'} onClick={() => setAuthMode('signin')}>Sign in</button>
                          <button type="button" className={authMode === 'signup' ? 'choice chosen' : 'choice'} onClick={() => setAuthMode('signup')}>Create account</button>
                        </div>
                        <button type="button" className="secondary-button" onClick={signInWithGoogle} disabled={authBusy} style={{ width: '100%', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff', color: '#202124', border: '1px solid #dadce0', fontWeight: 600 }}>
                          <span aria-hidden="true" style={{ fontSize: 19, fontWeight: 800, color: '#4285F4' }}>G</span>
                          {authBusy ? 'Please wait…' : 'Continue with Google'}
                        </button>
                        <label htmlFor="firebase-email">Email address</label>
                        <input id="firebase-email" type="email" autoComplete="email" required value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="you@example.com" />
                        <label htmlFor="firebase-password">Password</label>
                        <input id="firebase-password" type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={6} required value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="At least 6 characters" />
                        {authError && <small role="alert" style={{ color: '#dc2626' }}>{authError}</small>}
                        <button className="primary-button" type="submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign in to Bishwa' : 'Create Bishwa account'}</button>
                      </form>
                    )}
                  </div>
                </section>
                <span className="profile-avatar-large">
                  <UserRound size={35} />
                </span>
                <div className="profile-form">
                  <label htmlFor="profile-name">Display name</label>
                  <input
                    id="profile-name"
                    value={profileName}
                    onChange={e => setProfileName(e.target.value)}
                  />
                  <small>
                    {authUser ? 'Your display name is shown in this Bishwa profile.' : 'Your display name is stored on this device until you sign in.'}
                  </small>
                  <div className="profile-stats">
                    <div>
                      <b>{historyItems.length}</b>
                      <small>Activities</small>
                    </div>
                    <div>
                      <b>{bookmarks.length}</b>
                      <small>Bookmarks</small>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className={page === 'Home' ? 'bottom-link active' : 'bottom-link'} onClick={() => nav('Home')}>
          <Home size={22} fill={page === 'Home' ? 'currentColor' : 'none'} /><span>Home</span>
        </button>
        <button className={page === 'History' ? 'bottom-link active' : 'bottom-link'} onClick={() => nav('History')}>
          <Clock3 size={22} /><span>History</span>
        </button>
        <button className="bottom-search" onClick={() => { nav('Home'); window.setTimeout(() => document.querySelector<HTMLInputElement>('.search-box-large input')?.focus(), 0); }} aria-label="Search">
          <Search size={29} />
        </button>
        <button className={page === 'Bookmarks' ? 'bottom-link active' : 'bottom-link'} onClick={() => nav('Bookmarks')}>
          <Bookmark size={22} /><span>Bookmarks</span>
        </button>
        <button className={page === 'Settings' ? 'bottom-link active' : 'bottom-link'} onClick={() => nav('Settings')}>
          <Settings size={22} /><span>Settings</span>
        </button>
      </nav>
      {showVerifiedNotice && (
        <div className="verified-notice-backdrop" role="presentation">
          <section className="verified-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="verified-notice-title">
            <span className="verified-notice-icon"><ShieldCheck size={32} /></span>
            <span className="channel-invite-eyebrow">BISHWA TEAM</span>
            <h2 id="verified-notice-title">অভিনন্দন!</h2>
            <p>আপনাকে বিশ্ব টিম ভেরিফাইড করেছে। আপনার অ্যাকাউন্টে Bishwa Verified ব্যাজ যুক্ত হয়েছে।</p>
            <button type="button" className="channel-invite-primary" onClick={() => setShowVerifiedNotice(false)}>ধন্যবাদ</button>
          </section>
        </div>
      )}
      {showChannelPrompt && (
        <div className="channel-invite-backdrop" role="presentation">
          <section className="channel-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="channel-invite-title">
            <button
              type="button"
              className="channel-invite-close"
              onClick={() => setShowChannelPrompt(false)}
              aria-label="Close channel invitation"
            >
              <X size={20} />
            </button>
            <div className="channel-invite-symbol"><RadioTower size={28} /></div>
            <span className="channel-invite-eyebrow">BISHWA CREATOR COMMUNITY</span>
            <h2 id="channel-invite-title">{hasOwnChannel ? 'Your channel is ready' : 'Create your own channel'}</h2>
            <p>
              {hasOwnChannel
                ? 'Continue to your creator studio to manage your channel and publish content.'
                : 'Share your videos, photos and ideas with the Bishwa community by opening your own channel.'}
            </p>
            <button
              type="button"
              className="channel-invite-primary"
              onClick={() => {
                setShowChannelPrompt(false);
                nav('Channel');
              }}
            >
              {hasOwnChannel ? 'Open My Channel' : 'Create Your Channel'}
              <ChevronRight size={18} />
            </button>
            <button type="button" className="channel-invite-later" onClick={() => setShowChannelPrompt(false)}>
              Maybe later
            </button>
          </section>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer">
        <span>© {new Date().getFullYear()} Bishwa Search Engine</span>
        <span>Search smarter · Explore more</span>
      </footer>
    </div>
  );
}
export default App;
