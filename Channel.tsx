import { useEffect, useState, type FormEvent } from 'react';
import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import LogoImage from './LogoImage';
import AdminVerificationPanel from './AdminVerificationPanel';
import { api } from '@appdeploy/client';
import { RadioTower, Plus, Image as ImageIcon, Video, Upload, LoaderCircle, UserRound, Eye, CalendarDays, Trash2, BadgeCheck } from 'lucide-react';

const SUPABASE_URL = 'https://fnqufswrbzztioobvhsd.supabase.co';
const SUPABASE_PROJECT_REF = 'fnqufswrbzztioobvhsd';
const SUPABASE_BUCKET = 'bishwa-media';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GK2RyUbnwpsaDUVA2OxfSQ_rpldAtw0';
const SUPABASE_TUS_ENDPOINT = 'https://' + SUPABASE_PROJECT_REF + '.storage.supabase.co/storage/v1/upload/resumable';
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024;
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type ChannelRecord = {
  id: string;
  ownerId: string;
  name: string;
  handle: string;
  description: string;
  category: string;
  avatarUrl: string;
  bannerUrl: string;
  createdAt?: { toDate?: () => Date } | null;
  bishwaVerified?: boolean;
  officialChannel?: boolean;
};
type PostRecord = {
  id: string;
  title: string;
  caption: string;
  type: 'video' | 'image' | 'post';
  mediaUrl?: string;
  createdAt?: { toDate?: () => Date } | null;
};
type UploadPurpose = 'channel-logo' | 'channel-media';
type SignedUpload = {
  bucket: string;
  path: string;
  token: string;
  contentType: string;
  publicUrl: string;
};
type TusMetadata = Record<string, string>;
type PreviousTusUpload = Parameters<tus.Upload['resumeFromPreviousUpload']>[0];

async function optimizeImage(file: File, maxEdge: number) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); return file; }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) return file;
    return new File([blob], (file.name.replace(/\\.[^.]+$/, '') || 'image') + '.webp', { type: 'image/webp', lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function requestSignedUpload(file: File, purpose: UploadPurpose, channelId?: string, resumePath?: string): Promise<SignedUpload> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Please sign in again before uploading.');
  const idToken = await currentUser.getIdToken();
  const response = await fetch(SUPABASE_URL + '/functions/v1/bishwa-media-sign', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + idToken,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      purpose,
      channelId,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      resumePath,
    }),
  });
  const result = await response.json().catch(() => ({})) as Partial<SignedUpload> & { error?: string };
  if (!response.ok) {
    throw new Error(result.error || 'Could not authorize this media upload. Please try again.');
  }
  if (!result.path || !result.token || !result.publicUrl) {
    throw new Error('The secure upload service returned an incomplete response.');
  }
  return result as SignedUpload;
}

function publicUrlForPath(path: string) {
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return SUPABASE_URL + '/storage/v1/object/public/' + SUPABASE_BUCKET + '/' + encodedPath;
}

function makeTusFingerprint(file: File, purpose: UploadPurpose, channelId?: string) {
  const uid = auth.currentUser?.uid || 'signed-out';
  return [ 'bishwa', uid, purpose, channelId || 'no-channel', file.name, file.size, file.type, file.lastModified ].join(':');
}

function startTusUpload(
  file: File,
  metadata: TusMetadata,
  headers: Record<string, string>,
  purpose: UploadPurpose,
  channelId: string | undefined,
  onProgress: (value: number) => void,
  previousUpload?: PreviousTusUpload,
) {
  return new Promise<string>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: SUPABASE_TUS_ENDPOINT,
      headers,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      fingerprint: async selectedFile => makeTusFingerprint(selectedFile, purpose, channelId),
      metadata,
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress(Math.round(bytesUploaded / Math.max(bytesTotal, 1) * 100));
      },
      onError: reject,
      onSuccess: () => {
        onProgress(100);
        resolve(publicUrlForPath(metadata.objectName));
      },
    });
    if (previousUpload) upload.resumeFromPreviousUpload(previousUpload);
    upload.start();
  });
}

async function uploadLargeFileWithTus(
  file: File,
  purpose: UploadPurpose,
  channelId: string | undefined,
  onProgress: (value: number) => void,
) {
  const fingerprint = makeTusFingerprint(file, purpose, channelId);
  const probe = new tus.Upload(file, {
    endpoint: SUPABASE_TUS_ENDPOINT,
    fingerprint: async () => fingerprint,
    metadata: {},
    chunkSize: 6 * 1024 * 1024,
    retryDelays: [0, 3000, 5000, 10000, 20000],
  });
  let previousUploads: PreviousTusUpload[] = [];
  try {
    previousUploads = await probe.findPreviousUploads();
  } catch {
    // If browser storage is unavailable, start a fresh signed upload instead.
  }

  const previous = previousUploads.find(item =>
    item.metadata?.bucketName === SUPABASE_BUCKET &&
    typeof item.metadata?.objectName === 'string' &&
    item.metadata.objectName.length > 0
  );
  if (previous?.metadata?.objectName) {
    // A resumed TUS session needs a fresh signed token for the same path.
    // The signing endpoint checks that the path belongs to this Firebase user/channel.
    const resumed = await requestSignedUpload(file, purpose, channelId, previous.metadata.objectName);
    const previousMetadata: TusMetadata = {
      bucketName: SUPABASE_BUCKET,
      objectName: previous.metadata.objectName,
      contentType: previous.metadata.contentType || file.type,
      cacheControl: previous.metadata.cacheControl || '3600',
    };
    return startTusUpload(
      file,
      previousMetadata,
      { apikey: SUPABASE_PUBLISHABLE_KEY, 'x-signature': resumed.token },
      purpose,
      channelId,
      onProgress,
      previous,
    );
  }

  const signed = await requestSignedUpload(file, purpose, channelId);
  const metadata: TusMetadata = {
    bucketName: SUPABASE_BUCKET,
    objectName: signed.path,
    contentType: file.type,
    cacheControl: '3600',
  };
  return startTusUpload(
    file,
    metadata,
    { apikey: SUPABASE_PUBLISHABLE_KEY, 'x-signature': signed.token },
    purpose,
    channelId,
    onProgress,
  );
}

async function uploadFileWithProgress(
  file: File,
  purpose: UploadPurpose,
  channelId: string | undefined,
  onProgress: (value: number) => void,
) {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('Choose a valid image or video file.');
  }
  const maxBytes = purpose === 'channel-logo' ? MAX_LOGO_BYTES : MAX_MEDIA_BYTES;
  if (file.size > maxBytes) {
    throw new Error(purpose === 'channel-logo'
      ? 'Channel logos must be 5 MB or smaller.'
      : 'Images and videos must be 50 MB or smaller.');
  }
  if (purpose === 'channel-logo' && !file.type.startsWith('image/')) {
    throw new Error('Channel logos must be image files.');
  }

  if (file.size > TUS_THRESHOLD_BYTES) {
    return uploadLargeFileWithTus(file, purpose, channelId, onProgress);
  }

  const signed = await requestSignedUpload(file, purpose, channelId);
  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) throw error;
  onProgress(100);
  return signed.publicUrl;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Channel({ notify }: { notify: (message: string) => void }) {
  const user = auth.currentUser;
  const [channel, setChannel] = useState<ChannelRecord | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Education');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [kind, setKind] = useState<'video' | 'image' | 'post'>('video');
  const [media, setMedia] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [showAdminVerification, setShowAdminVerification] = useState(false);
  const [showVerificationPassword, setShowVerificationPassword] = useState(false);
  const [verificationPassword, setVerificationPassword] = useState('');
  const isBishwaOwner = (user?.email || auth.currentUser?.email || '').trim().toLowerCase() === 'biswassuprotik3@mail.com';
  const unlockVerification = (event: FormEvent) => {
    event.preventDefault();
    if (!isBishwaOwner) { notify('Only the Supratik Biswas owner account can use Bishwa Verified.'); return; }
    if (verificationPassword !== 'BS') { notify('Incorrect BS password.'); return; }
    setShowVerificationPassword(false);
    setShowAdminVerification(true);
    setVerificationPassword('');
  };

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) { setLoading(false); return; }
      try {
        const found = await getDocs(query(collection(db, 'channels'), where('ownerId', '==', user.uid)));
        if (!active) return;
        if (!found.empty) {
          const record = { id: found.docs[0].id, ...found.docs[0].data() } as ChannelRecord;
          setChannel(record);
          const postSnapshot = await getDocs(query(collection(db, 'channelPosts'), where('channelId', '==', record.id)));
          if (active) setPosts(postSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as PostRecord)).sort((a, b) => {
            const at = a.createdAt?.toDate?.().getTime() ?? 0;
            const bt = b.createdAt?.toDate?.().getTime() ?? 0;
            return bt - at;
          }));
        }
      } catch (error) {
        console.error('Channel load failed:', error);
        notify('Could not load channel. Check Firebase Firestore rules.');
      } finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [user]);

  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !name.trim() || !handle.trim()) return;
    setSaving(true);
    try {
      const cleanHandle = handle.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
      if (cleanHandle.length < 3) { notify('Channel handle must contain at least 3 letters or numbers.'); return; }
      const duplicate = await getDocs(query(collection(db, 'channels'), where('handle', '==', cleanHandle)));
      if (!duplicate.empty) { notify('This channel handle is already taken.'); return; }
      let avatarUrl = user.photoURL || '';
      if (avatarFile) {
        const optimizedLogo = await optimizeImage(avatarFile, 512);
        avatarUrl = await uploadFileWithProgress(optimizedLogo, 'channel-logo', undefined, setUploadProgress);
      }
      const record = {
        ownerId: user.uid, name: name.trim(), handle: cleanHandle,
        description: description.trim(), category, avatarUrl,
        bannerUrl: '', visibility: 'public', status: 'active',
        freeVideoPostsUsed: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      const created = await addDoc(collection(db, 'channels'), record);
      setChannel({ id: created.id, ...record });
      notify('Your Bishwa channel has been created.');
    } catch (error) {
      console.error('Channel creation failed:', error);
      notify(errorMessage(error, 'Channel could not be created. Check Firestore permissions.'));
    } finally { setSaving(false); setUploadProgress(0); }
  };

  const saveChannelLogo = async (file: File) => {
    if (!user || !channel) return;
    if (!file.type.startsWith('image/') || file.size > MAX_LOGO_BYTES) { notify('Choose an image under 5 MB.'); return; }
    setSaving(true);
    try {
      const optimizedLogo = await optimizeImage(file, 512);
      const avatarUrl = await uploadFileWithProgress(optimizedLogo, 'channel-logo', undefined, setUploadProgress);
      await updateDoc(doc(db, 'channels', channel.id), { avatarUrl, updatedAt: serverTimestamp() });
      setChannel(old => old ? { ...old, avatarUrl } : old);
      setLogoPreview('');
      setAvatarFile(null);
      notify('Channel logo updated successfully.');
    } catch (error) {
      console.error('Channel logo update failed:', error);
      notify(errorMessage(error, 'Logo update failed. Please check the secure upload service and Firestore rules.'));
    } finally { setSaving(false); setUploadProgress(0); }
  };

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !channel || !title.trim()) return;
    const videoCount = posts.filter(post => post.type === 'video').length;
    if (kind === 'video' && videoCount >= 4) {
      notify('Your 4 free video posts are used. The creator plan payment setup is not connected yet.');
      return;
    }
    if (kind !== 'post' && !media) { notify('Choose a file to upload first.'); return; }
    if (media && media.size > (kind === 'video' ? MAX_MEDIA_BYTES : 10 * 1024 * 1024)) {
      notify(kind === 'video' ? 'Videos must be 50 MB or smaller.' : 'Images must be 10 MB or smaller.');
      return;
    }
    setSaving(true);
    try {
      let mediaUrl = '';
      if (media) {
        if (kind === 'image') setUploadProgress(-1);
        const uploadFile = kind === 'image' ? await optimizeImage(media, 1600) : media;
        setUploadProgress(0);
        mediaUrl = await uploadFileWithProgress(uploadFile, 'channel-media', channel.id, setUploadProgress);
      }
      const post = {
        channelId: channel.id, ownerId: user.uid, title: title.trim(),
        caption: caption.trim(), type: kind, mediaUrl,
        visibility: 'public', status: 'published', createdAt: serverTimestamp(),
      };
      const created = await addDoc(collection(db, 'channelPosts'), post);
      setPosts(old => [{ id: created.id, ...post }, ...old] as PostRecord[]);
      setTitle(''); setCaption(''); setMedia(null);
      const input = document.getElementById('channel-media-file') as HTMLInputElement | null;
      if (input) input.value = '';
      notify('Your content has been published.');
      if (kind === 'video') {
        try {
          const idToken = await user.getIdToken();
          const response = await api.post('/api/channels/video-published', { idToken, channelId: channel.id, postId: created.id });
          const sent = Number(response.data?.sent || 0);
          if (sent > 0) notify('Video published. ' + sent + ' Super member device(s) notified.');
        } catch (notificationError) {
          console.error('Super member video notification failed:', notificationError);
          notify('Video published, but Super member notifications could not be delivered.');
        }
      }
    } catch (error) {
      console.error('Channel publishing failed:', error);
      notify(errorMessage(error, 'Upload or publishing failed. Please check the secure upload service and Firestore permissions.'));
    } finally { setSaving(false); setUploadProgress(0); }
  };

  const deletePublishedPost = async (post: PostRecord) => {
    if (!user || !channel || deletingPostId) return;
    const confirmed = window.confirm('Delete "' + post.title + '" permanently? This also removes its uploaded media file.');
    if (!confirmed) return;
    setDeletingPostId(post.id);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(SUPABASE_URL + '/functions/v1/bishwa-media-sign', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + idToken,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete-media', channelId: channel.id, postId: post.id }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; deleted?: boolean };
      if (!response.ok || !result.deleted) {
        throw new Error(result.error || 'The content could not be deleted. Please try again.');
      }
      setPosts(old => old.filter(item => item.id !== post.id));
      notify('Published content deleted successfully.');
    } catch (error) {
      console.error('Published content deletion failed:', error);
      notify(errorMessage(error, 'Could not delete this content.'));
    } finally {
      setDeletingPostId('');
    }
  };

  if (loading) return <div className="channel-loading"><LoaderCircle className="channel-spin" /> Loading your creator space…</div>;

  if (!channel) return (
    <div className="channel-create-layout">
      <div className="channel-intro-card">
        <span className="channel-kicker"><RadioTower size={15} /> BISHWA CREATOR NETWORK</span>
        <h2>Build your own channel.</h2>
        <p>Create a public space for your videos, photos and posts. Your channel belongs to your Bishwa account.</p>
        <div className="channel-benefits">
          <span><Video size={17} /> First 4 videos free</span>
          <span><ImageIcon size={17} /> Photos and text posts free</span>
          <span><Eye size={17} /> Viewers watch published videos free</span>
        </div>
      </div>
      <form className="channel-form-card" onSubmit={createChannel}>
        <h3><Plus size={19} /> Create your channel</h3>
        <label>Channel name</label>
        <input required maxLength={50} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tech with Rahul" />
        <label>Channel handle</label>
        <div className="channel-handle-input"><span>@</span><input required minLength={3} maxLength={30} value={handle} onChange={e => setHandle(e.target.value.replace(/^@/, ''))} placeholder="your_channel" /></div>
        <small className="channel-hint">Use 3–30 letters, numbers or underscores.</small>
        <label>Category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {['Education', 'Technology', 'Entertainment', 'News', 'Lifestyle', 'Gaming', 'Music', 'Travel', 'Other'].map(value => <option key={value}>{value}</option>)}
        </select>
        <label>Channel logo</label>
        <label className="channel-logo-picker" htmlFor="channel-logo-file">
          <span className="channel-logo-preview">{logoPreview ? <img src={logoPreview} alt="Channel logo preview" /> : <RadioTower size={28} />}</span>
          <span><b>{avatarFile ? avatarFile.name : 'Choose your channel logo'}</b><small>JPG, PNG or WebP · up to 5 MB. You can change it later.</small></span>
          <input id="channel-logo-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0] || null; if (file && (!file.type.startsWith('image/') || file.size > MAX_LOGO_BYTES)) { notify('Choose a JPG, PNG or WebP image under 5 MB.'); event.target.value = ''; return; } setAvatarFile(file); setLogoPreview(file ? URL.createObjectURL(file) : ''); }} />
        </label>
        <label>About your channel</label>
        <textarea rows={4} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell viewers what your channel is about…" />
        <button className="channel-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="channel-spin" size={17} /> : <Plus size={17} />} Create channel</button>
        <small className="channel-hint">One channel per Bishwa account. Your logo will appear in the public channel directory and on your channel page.</small>
      </form>
    </div>
  );

  const videoCount = posts.filter(post => post.type === 'video').length;
  return (
    <div className="channel-dashboard">
      <div className="channel-cover">
        <div className="channel-cover-glow" />
        <div className="channel-identity">
          <span className="channel-avatar">{channel.avatarUrl ? <LogoImage src={channel.avatarUrl} alt={channel.name + " logo"} /> : <UserRound size={32} />}</span>
          <div><span className="channel-kicker">MY CREATOR CHANNEL</span><h2>{channel.name} {channel.bishwaVerified && <span className="bishwa-verified-mark" title={channel.officialChannel ? 'Official Bishwa Channel' : 'Bishwa Verified'}><BadgeCheck size={18} /></span>}</h2>{channel.officialChannel && <span className="official-channel-label">Bishwa Official (B-Right)</span>}<p>@{channel.handle} · {channel.category}</p></div>
        </div>
        <div className="channel-cover-actions">
          <span className="channel-live-label"><i /> PUBLIC CHANNEL</span>
        </div>
      </div>
      <label className="channel-logo-edit" htmlFor="channel-logo-edit-file"><span><ImageIcon size={16} /> Change channel logo</span><input id="channel-logo-edit-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void saveChannelLogo(file); event.target.value = ''; }} /></label>
      <p className="channel-description">{channel.description || 'Welcome to my Bishwa channel.'}</p>
      <div className="channel-stats">
        <div><b>{posts.length}</b><span>Published items</span></div>
        <div><b>{videoCount}/4</b><span>Free videos used</span></div>
        <div><b>Public</b><span>Channel visibility</span></div>
        {isBishwaOwner && <button type="button" className="channel-verified-stat-button" onClick={() => { setShowAdminVerification(false); setShowVerificationPassword(true); }}><BadgeCheck size={17} /><b>V</b><span>Bishwa Verified</span></button>}
      </div>
      {isBishwaOwner && showVerificationPassword && <div className="verified-notice-backdrop" role="dialog" aria-modal="true" aria-label="Bishwa verification password"><form className="verified-notice-dialog channel-verification-password" onSubmit={unlockVerification}><button type="button" className="channel-invite-close" onClick={() => { setShowVerificationPassword(false); setVerificationPassword(''); }} aria-label="Close">×</button><span className="verified-notice-icon"><BadgeCheck size={30} /></span><h2>Bishwa Verified</h2><p>Enter the BS password to open owner verification controls.</p><input autoFocus type="password" value={verificationPassword} onChange={event => setVerificationPassword(event.target.value)} placeholder="Enter BS password" autoComplete="off" /><button className="channel-primary" type="submit">Unlock verification</button></form></div>}
      {isBishwaOwner && showAdminVerification && <AdminVerificationPanel notify={notify} password={verificationPassword || 'BS'} />}
      <div className="channel-workspace">
        <form className="channel-form-card channel-publish-card" onSubmit={publish}>
          <div className="channel-card-heading"><div><span className="channel-kicker">CREATOR STUDIO</span><h3>Publish new content</h3></div><span className="channel-free-pill">FREE STARTER</span></div>
          <div className="channel-type-tabs">
            {(['video', 'image', 'post'] as const).map(value => <button type="button" className={kind === value ? 'active' : ''} key={value} onClick={() => { setKind(value); setMedia(null); }}><>{value === 'video' ? <Video size={16} /> : value === 'image' ? <ImageIcon size={16} /> : <Plus size={16} />}{value === 'post' ? 'Text post' : value[0].toUpperCase() + value.slice(1)}</></button>)}
          </div>
          <label>{kind === 'video' ? 'Video title' : kind === 'image' ? 'Photo title' : 'Post title'}</label>
          <input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Give your content a title" />
          <label>Caption / description</label>
          <textarea rows={3} maxLength={2000} value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write something for your audience…" />
          {kind !== 'post' && <label className="channel-upload-box" htmlFor="channel-media-file"><Upload size={20} /><b>{media ? media.name : kind === 'video' ? 'Choose a video file' : 'Choose an image'}</b><small>{kind === 'video' ? 'MP4, WebM or MOV · up to 50 MB' : 'JPG, PNG or WebP · up to 10 MB'}</small><input id="channel-media-file" type="file" accept={kind === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp'} onChange={e => { const file = e.target.files?.[0] || null; const max = kind === 'video' ? MAX_MEDIA_BYTES : 10 * 1024 * 1024; if (file && file.size > max) { notify(kind === 'video' ? 'Videos must be 50 MB or smaller.' : 'Images must be 10 MB or smaller.'); e.target.value = ''; return; } setMedia(file); }} /></label>}
          {kind === 'video' && <small className="channel-hint">{videoCount < 4 ? (4 - videoCount) + ' free video publishing slot(s) remaining.' : 'Free video allowance used. Monthly creator access will be needed.'}</small>}
          {saving && <div className="channel-upload-progress"><div><span>{uploadProgress === 0 ? 'Preparing secure upload' : kind === 'video' ? 'Uploading video' : kind === 'image' ? (uploadProgress < 0 ? 'Preparing photo…' : 'Uploading optimized photo') : 'Publishing post'}</span><b>{uploadProgress < 0 ? 'Preparing' : uploadProgress + '%'}</b></div><div className="channel-progress-track"><span style={{ width: Math.max(uploadProgress, 3) + '%' }} /></div></div>}
          <button className="channel-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="channel-spin" size={17} /> : <Upload size={17} />} Publish {kind}</button>
        </form>
        <section className="channel-content-card">
          <div className="channel-card-heading"><div><span className="channel-kicker">YOUR CHANNEL</span><h3>Published content</h3></div><span className="channel-count">{posts.length} items</span></div>
          {posts.length ? <div className="channel-post-grid">{posts.map(post => <article className="channel-post" key={post.id}>
            {post.mediaUrl && (post.type === 'video' ? <video src={post.mediaUrl} controls preload="metadata" /> : <img src={post.mediaUrl} alt={post.title} />)}
            <div className="channel-post-copy"><span className="channel-post-type">{post.type}</span><h4>{post.title} {channel.bishwaVerified && <span className="bishwa-post-verified" title="Bishwa Verified post">B✔️</span>}</h4>{post.caption && <p>{post.caption}</p>}<small><CalendarDays size={12} /> {post.createdAt?.toDate?.().toLocaleDateString() || 'Just published'}</small><button type="button" className="channel-delete-button" onClick={() => deletePublishedPost(post)} disabled={Boolean(deletingPostId)}><Trash2 size={14} /> {deletingPostId === post.id ? 'Deleting…' : 'Delete'}</button></div>
          </article>)}</div> : <div className="channel-empty"><Video size={28} /><b>Your channel is ready</b><span>Your published videos, photos and posts will appear here.</span></div>}
        </section>
      </div>
    </div>
  );
}
