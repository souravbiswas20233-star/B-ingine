import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import LogoImage from './LogoImage';
import PostComments from './PostComments';
import { BadgeCheck, CalendarDays, FileText, Image as ImageIcon, LoaderCircle, RadioTower, Video } from 'lucide-react';

type FeedChannel = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  category?: string;
  ownerId?: string;
  bishwaVerified?: boolean;
  officialChannel?: boolean;
};

type FeedPost = {
  id: string;
  channelId: string;
  title: string;
  caption?: string;
  type: 'video' | 'image' | 'post';
  mediaUrl?: string;
  createdAt?: { toDate?: () => Date } | null;
};

type FeedFilter = 'image' | 'video' | 'post' | 'all';

function postDate(value?: FeedPost['createdAt']) {
  const date = value?.toDate?.();
  return date ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Just published';
}

export default function HomeFeed({
  notify,
  onView,
  filterType = 'all',
  heading = 'Latest from creators',
}: {
  notify: (message: string) => void;
  onView?: (post: FeedPost, channel: FeedChannel) => void;
  filterType?: FeedFilter;
  heading?: string;
}) {
  const [channels, setChannels] = useState<FeedChannel[]>([]);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [channelsReady, setChannelsReady] = useState(false);
  const [postsReady, setPostsReady] = useState(false);

  useEffect(() => {
    const stopChannels = onSnapshot(
      query(collection(db, 'channels'), where('visibility', '==', 'public'), where('status', '==', 'active')),
      snapshot => {
        setChannels(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as FeedChannel)));
        setChannelsReady(true);
      },
      error => {
        console.error('Home feed channel load failed:', error);
        setChannelsReady(true);
        notify('Creator information could not be loaded. Check Firestore read permissions.');
      },
    );
    const stopPosts = onSnapshot(
      query(collection(db, 'channelPosts'), where('visibility', '==', 'public'), where('status', '==', 'published')),
      snapshot => {
        setPosts(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as FeedPost)));
        setPostsReady(true);
      },
      error => {
        console.error('Home feed posts load failed:', error);
        setPostsReady(true);
        notify('The home post feed could not be loaded. Check Firestore read permissions.');
      },
    );
    return () => {
      stopChannels();
      stopPosts();
    };
  }, [notify]);

  const feed = useMemo(() => {
    const channelMap = new Map(channels.map(channel => [channel.id, channel]));
    return posts
      .filter(post => channelMap.has(post.channelId) && Boolean(post.title))
      .filter(post => filterType === 'all' || post.type === filterType)
      .map(post => ({ post, channel: channelMap.get(post.channelId)! }))
      .sort((a, b) => Number(Boolean(b.channel.bishwaVerified)) - Number(Boolean(a.channel.bishwaVerified))
        || (b.post.createdAt?.toDate?.().getTime() || 0) - (a.post.createdAt?.toDate?.().getTime() || 0));
  }, [channels, posts, filterType]);

  const emptyTitle = filterType === 'image'
    ? 'No public photos yet'
    : filterType === 'video'
      ? 'No public videos yet'
      : filterType === 'post'
        ? 'No public news posts yet'
        : 'No public posts yet';
  const emptyCopy = filterType === 'image'
    ? 'Photos published by public Bishwa channels will appear here.'
    : filterType === 'video'
      ? 'Videos published by public Bishwa channels will appear here.'
      : filterType === 'post'
        ? 'Text updates published by public Bishwa channels will appear here.'
        : 'Public photos, videos and posts from creators will appear here.';

  return (
    <section className="home-community-feed" aria-label={heading}>
      <div className="home-community-heading">
        <div>
          <span className="channel-kicker"><RadioTower size={14} /> BISHWA COMMUNITY</span>
          <h2>{heading}</h2>
          <p>Public creator content, newest first.</p>
        </div>
        <span className="home-feed-live"><i /> LIVE FEED</span>
      </div>
      {!channelsReady || !postsReady ? (
        <div className="home-feed-loading"><LoaderCircle className="channel-spin" size={22} /> Loading the latest posts…</div>
      ) : feed.length ? (
        <div className="home-community-list">
          {feed.map(({ post, channel }) => (
            <article className="home-community-post" key={post.id}>
              <header className="home-community-post-header">
                <span className="home-community-avatar">
                  {channel.avatarUrl ? <LogoImage src={channel.avatarUrl} alt={channel.name + ' logo'} /> : <RadioTower size={20} />}
                </span>
                <div className="home-community-author">
                  <b>{channel.name} {channel.bishwaVerified && <span className="bishwa-post-verified" title="Bishwa Verified channel"><BadgeCheck size={12} /> Bishwa Verified</span>}</b>
                  <span>@{channel.handle} · {channel.category || 'Creator'}</span>
                </div>
                <small><CalendarDays size={13} /> {postDate(post.createdAt)}</small>
              </header>
              <div className="home-community-copy" onClick={() => onView?.(post, channel)}>
                <h3>{post.title}</h3>
                {post.caption && <p>{post.caption}</p>}
              </div>
              {post.mediaUrl && post.type === 'image' && (
                <div className="home-community-media home-community-image">
                  <img src={post.mediaUrl} alt={post.title} loading="lazy" onClick={() => onView?.(post, channel)} />
                </div>
              )}
              {post.mediaUrl && post.type === 'video' && (
                <div className="home-community-media">
                  <video src={post.mediaUrl} controls playsInline preload="metadata" onPlay={() => onView?.(post, channel)} />
                </div>
              )}
              {post.type === 'post' && (
                <div className="home-text-post" onClick={() => onView?.(post, channel)}><FileText size={20} /><span>Community post</span></div>
              )}
              <PostComments postId={post.id} notify={notify} />
              <footer className="home-community-post-footer">
                {post.type === 'image' ? <ImageIcon size={14} /> : post.type === 'video' ? <Video size={14} /> : <FileText size={14} />}
                <span>{post.type === 'image' ? 'Photo' : post.type === 'video' ? 'Video' : 'Text post'}</span>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="home-feed-empty">
          <RadioTower size={28} />
          <b>{emptyTitle}</b>
          <span>{emptyCopy}</span>
        </div>
      )}
    </section>
  );
}
