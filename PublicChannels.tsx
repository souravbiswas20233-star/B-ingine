import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, deleteDoc, doc, getCountFromServer, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { api } from '@appdeploy/client';
import LogoImage from './LogoImage';
import PostComments from './PostComments';
import AdminVerificationPanel from './AdminVerificationPanel';
import { ArrowLeft, LoaderCircle, RadioTower, Search, Users, UserRound, Video, Image as ImageIcon, FileText, Check, Sparkles, BadgeCheck, X, Play } from 'lucide-react';

type PublicChannel = {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  description?: string;
  category?: string;
  avatarUrl?: string;
  visibility?: string;
  status?: string;
  bishwaVerified?: boolean;
  officialChannel?: boolean;
};
type PublicPost = {
  id: string;
  title: string;
  caption?: string;
  type: 'video' | 'image' | 'post';
  mediaUrl?: string;
  createdAt?: { toDate?: () => Date } | null;
};

export default function PublicChannels({ notify, onView }: { notify: (message: string) => void; onView?: (post: PublicPost, channel: PublicChannel) => void }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<PublicChannel | null>(null);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [verifyingOfficial, setVerifyingOfficial] = useState(false);
  const [activeMedia, setActiveMedia] = useState<PublicPost | null>(null);
  const isBishwaOwner = (user?.email || auth.currentUser?.email || '').trim().toLowerCase() === 'biswassuprotik3@mail.com';

  const openMedia = (post: PublicPost, channel: PublicChannel) => {
    setActiveMedia(post);
    onView?.(post, channel);
  };

  useEffect(() => {
    let active = true;
    async function loadDirectory() {
      try {
        const [channelSnapshot, subscriptionSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'channels'), where('visibility', '==', 'public'))),
          user ? getDocs(query(collection(db, 'channelSubscriptions'), where('userId', '==', user.uid))) : Promise.resolve(null),
        ]);
        if (!active) return;
        const publicItems = channelSnapshot.docs
          .map(item => ({ id: item.id, ...item.data() } as PublicChannel))
          .filter(item => item.visibility === 'public' && item.status === 'active')
          .sort((a, b) => a.name.localeCompare(b.name));
        setChannels(publicItems);
        setSubscriptions(subscriptionSnapshot?.docs.map(item => String(item.data().channelId)) || []);
      } catch (error) {
        console.error('Public channel directory failed:', error);
        notify('Could not load public channels. Check Firestore read permissions.');
      } finally {
        if (active) setLoading(false);
      }
    }
    loadDirectory();
    return () => { active = false; };
  }, [user]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(channels.map(item => item.category || 'Other'))).sort()], [channels]);
  const visibleChannels = useMemo(() => {
    const term = search.trim().toLowerCase();
    return channels.filter(item => {
      const matchesCategory = category === 'All' || (item.category || 'Other') === category;
      const matchesSearch = !term || item.name.toLowerCase().includes(term) || item.handle.toLowerCase().includes(term) || (item.description || '').toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [channels, search, category]);

  const openChannel = async (channel: PublicChannel) => {
    setSelected(channel);
    setDetailLoading(true);
    try {
      const [postSnapshot, subscriberSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'channelPosts'), where('channelId', '==', channel.id))),
        getCountFromServer(query(collection(db, 'channelSubscriptions'), where('channelId', '==', channel.id))),
      ]);
      setPosts(postSnapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as PublicPost))
        .filter(item => (item as PublicPost & { visibility?: string; status?: string }).visibility === 'public' && (item as PublicPost & { status?: string }).status === 'published')
        .sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0)));
      setSubscriberCount(subscriberSnapshot.data().count);
    } catch (error) {
      console.error('Public channel page failed:', error);
      notify('Could not load this channel. Check public Firestore read permissions.');
      setPosts([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleSubscription = async () => {
    if (!user || !selected || busy) return;
    setBusy(true);
    const subscriptionId = selected.id + '_' + user.uid;
    const alreadySubscribed = subscriptions.includes(selected.id);
    try {
      if (alreadySubscribed) {
        await deleteDoc(doc(db, 'channelSubscriptions', subscriptionId));
        setSubscriptions(old => old.filter(id => id !== selected.id));
        setSubscriberCount(count => Math.max(0, count - 1));
        notify('You left this Super channel.');
      } else {
        await setDoc(doc(db, 'channelSubscriptions', subscriptionId), {
          channelId: selected.id,
          ownerId: selected.ownerId,
          userId: user.uid,
          createdAt: serverTimestamp(),
        });
        setSubscriptions(old => [...old, selected.id]);
        setSubscriberCount(count => count + 1);
        notify('You are now a Super member of this channel.');
      }
    } catch (error) {
      console.error('Channel Super action failed:', error);
      notify('Super membership could not be updated. Check Firestore permissions.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOfficialChannel = async () => {
    if (!user || !isBishwaOwner || verifyingOfficial) return;
    setVerifyingOfficial(true);
    try {
      const idToken = await user.getIdToken();
      const response = await api.post('/api/admin/official-channel/verify', { idToken });
      const result = response.data as { verified?: boolean; channelId?: string; channelName?: string };
      if (!result.verified || !result.channelId) throw new Error('The official channel could not be confirmed.');
      const applyVerified = (channel: PublicChannel): PublicChannel => channel.id === result.channelId
        ? { ...channel, bishwaVerified: true, officialChannel: true }
        : channel;
      setChannels(current => current.map(applyVerified));
      setSelected(current => current ? applyVerified(current) : current);
      notify('Bishwa Special has been saved as Bishwa Official (B-Right) and marked verified.');
    } catch (error) {
      console.error('Official Bishwa channel verification failed:', error);
      notify(error instanceof Error ? error.message : 'Could not verify Bishwa Special. Please try again.');
    } finally {
      setVerifyingOfficial(false);
    }
  };

  useEffect(() => {
    if (user && isBishwaOwner) void verifyOfficialChannel();
  }, [user?.uid]);

  if (loading) return <div className="channel-loading"><LoaderCircle className="channel-spin" /> Loading public channels…</div>;

  if (selected) return (
    <section className="public-channel-detail">
      <button className="public-back-button" onClick={() => { setSelected(null); setPosts([]); }}><ArrowLeft size={17} /> All channels</button>
      <div className="public-channel-cover">
        <div className="public-channel-brand">
          <span className="public-channel-avatar">{selected.avatarUrl ? <LogoImage src={selected.avatarUrl} alt={selected.name + ' logo'} /> : <RadioTower size={34} />}</span>
          <div><span className="channel-kicker">BISHWA PUBLIC CHANNEL</span><h2>{selected.name} {selected.bishwaVerified && <span className="bishwa-verified-mark" title={selected.officialChannel ? 'Official Bishwa Channel' : 'Bishwa Verified'}><BadgeCheck size={18} /></span>}</h2>{selected.officialChannel && <span className="official-channel-label">Bishwa Official (B-Right)</span>}<p>@{selected.handle} · {selected.category || 'Other'}</p></div>
        </div>
        <div className="public-channel-detail-actions">
          {isBishwaOwner && <button type="button" className={showVerification ? 'public-verify-trigger active' : 'public-verify-trigger'} onClick={() => setShowVerification(value => !value)} title="Open Bishwa verification controls"><BadgeCheck size={16} /> V</button>}
          <button className={subscriptions.includes(selected.id) ? 'public-subscribe-button subscribed' : 'public-subscribe-button'} onClick={toggleSubscription} disabled={busy}>
          {busy ? <LoaderCircle className="channel-spin" size={16} /> : subscriptions.includes(selected.id) ? <Check size={16} /> : <Users size={16} />}
          {subscriptions.includes(selected.id) ? 'Super Member' : 'Super'}
          </button>
        </div>
      </div>
      {isBishwaOwner && <button type="button" className="official-channel-verify-button" onClick={() => void verifyOfficialChannel()} disabled={verifyingOfficial}>{verifyingOfficial ? <LoaderCircle className="channel-spin" size={15} /> : <BadgeCheck size={15} />} {verifyingOfficial ? 'Verifying…' : 'Verify Bishwa Special as official'}</button>}
      {isBishwaOwner && showVerification && <AdminVerificationPanel notify={notify} />}
      <p className="public-channel-description">{selected.description || 'Welcome to this Bishwa channel.'}</p>
      <div className="public-channel-stats"><span><Users size={16} /> {subscriberCount} Super members</span><span><Video size={16} /> {posts.filter(post => post.type === 'video').length} videos</span><span><FileText size={16} /> {posts.length} posts</span></div>
      <div className="public-post-heading"><div><span className="channel-kicker">LATEST UPDATES</span><h3>Channel content</h3></div></div>
      {detailLoading ? <div className="channel-loading"><LoaderCircle className="channel-spin" /> Loading channel content…</div> : posts.length ? (
        <div className="public-post-grid">{posts.map(post => <article className="public-post-card" key={post.id}>
          {post.mediaUrl && (post.type === 'video' ? <button type="button" className="public-media-open" onClick={() => openMedia(post, selected)} aria-label={'Play ' + post.title}><video src={post.mediaUrl} preload="metadata" playsInline /><span className="public-media-play"><Play size={25} fill="currentColor" /></span></button> : <button type="button" className="public-media-open" onClick={() => openMedia(post, selected)} aria-label={'Open ' + post.title}><img src={post.mediaUrl} alt={post.title} /></button>)}
          <div onClick={() => onView?.(post, selected)}><span>{post.type === 'image' ? <ImageIcon size={13} /> : post.type === 'video' ? <Video size={13} /> : <FileText size={13} />}{post.type}</span><h4>{post.title} {selected.bishwaVerified && <span className="bishwa-post-verified" title="Bishwa Verified post">B✔️</span>}</h4>{post.caption && <p>{post.caption}</p>}</div>
          <PostComments postId={post.id} notify={notify} />
        </article>)}</div>
      ) : <div className="channel-empty"><Video size={28} /><b>No public posts yet</b><span>New videos, photos and posts from this channel will appear here.</span></div>}
      {activeMedia && <div className="public-media-viewer" role="dialog" aria-modal="true" aria-label={activeMedia.title} onClick={() => setActiveMedia(null)}><button type="button" className="public-media-close" onClick={() => setActiveMedia(null)} aria-label="Close media"><X size={22} /></button><div className="public-media-viewer-content" onClick={event => event.stopPropagation()}>{activeMedia.type === 'video' ? <video src={activeMedia.mediaUrl} controls autoPlay playsInline /> : <img src={activeMedia.mediaUrl} alt={activeMedia.title} />}<div className="public-media-viewer-caption"><b>{activeMedia.title}</b>{activeMedia.caption && <p>{activeMedia.caption}</p>}</div></div></div>}
    </section>
  );

  return (
    <section className="public-channel-directory">
      <div className="public-directory-hero"><span className="channel-kicker"><RadioTower size={15} /> BISHWA CREATOR NETWORK</span><h2>Discover public channels</h2><p>Find creators, explore their content and join channels you love with Super.</p><div className="public-directory-search"><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search channel name, handle or topic…" />{isBishwaOwner && <button type="button" className="public-verify-trigger public-directory-verify" onClick={() => setShowVerification(value => !value)}><BadgeCheck size={16} /> V</button>}</div>{isBishwaOwner && showVerification && <AdminVerificationPanel notify={notify} />}</div>
      <div className="public-directory-toolbar"><div><b>{visibleChannels.length} public channels</b><span>Explore creators on Bishwa</span></div><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter by category">{categories.map(item => <option key={item}>{item}</option>)}</select></div>
      {visibleChannels.length ? <div className="public-channel-grid">{visibleChannels.map(channel => <article className="public-channel-card" key={channel.id}>
        <div className="public-card-avatar">{channel.avatarUrl ? <LogoImage src={channel.avatarUrl} alt={channel.name + ' logo'} /> : <RadioTower size={27} />}</div>
        <div className="public-card-copy"><span>{channel.category || 'Other'} · Public</span><h3>{channel.name} {channel.bishwaVerified && <span className="bishwa-verified-mark" title={channel.officialChannel ? 'Official Bishwa Channel' : 'Bishwa Verified'}><BadgeCheck size={16} /></span>}</h3>{channel.officialChannel && <span className="official-channel-label">Bishwa Official (B-Right)</span>}<p>@{channel.handle}</p><small>{channel.description || 'Explore videos, photos and posts from this creator.'}</small></div>
        <button className="public-card-open" onClick={() => openChannel(channel)}>View channel <ArrowLeft size={15} /></button>
        {subscriptions.includes(channel.id) && <span className="public-card-subscribed"><Check size={12} /> Super</span>}
      </article>)}</div> : <div className="channel-empty public-directory-empty"><RadioTower size={30} /><b>{channels.length ? 'No matching channels' : 'No public channels yet'}</b><span>{channels.length ? 'Try another search or category.' : 'When creators publish a public channel, it will appear here.'}</span></div>}
    </section>
  );
}
