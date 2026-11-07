import { router, json, error, secrets } from '@appdeploy/sdk';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';

const DATABASE_URL = 'https://bishwo-45430-default-rtdb.asia-southeast1.firebasedatabase.app';

async function getFirebaseAdmin() {
  const raw = await secrets.readSecret('FIREBASE_SERVICE_ACCOUNT_JSON');
  const serviceAccount = JSON.parse(raw);
  const app = getApps().find(item => item.name === 'bishwa-fcm') || initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
    storageBucket: 'bishwo-45430.firebasestorage.app',
    databaseURL: DATABASE_URL,
  }, 'bishwa-fcm');
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    realtime: getDatabase(app),
    messaging: getMessaging(app),
    bucket: getStorage(app).bucket(),
  };
}

async function verifyPublicPost(db: FirebaseFirestore.Firestore, postId: string) {
  const postRef = db.collection('channelPosts').doc(postId);
  const snapshot = await postRef.get();
  if (!snapshot.exists) return { postRef, post: null };
  const post = snapshot.data()!;
  if (post.visibility !== 'public' || post.status !== 'published') {
    return { postRef, post: null };
  }
  return { postRef, post };
}

const BISWA_ADMIN_EMAIL = 'biswassuprotik3@mail.com';
const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

async function markBishwaVerified(db: FirebaseFirestore.Firestore, uid: string, source: 'admin' | 'membership-tenure', awardedBy?: string) {
  await db.collection('users').doc(uid).set({
    bishwaVerified: true,
    bishwaVerifiedAt: new Date(),
    bishwaVerifiedSource: source,
    bishwaVerifiedBy: awardedBy || null,
    bishwaVerifiedNoticePending: true,
  }, { merge: true });
  const channels = await db.collection('channels').where('ownerId', '==', uid).get();
  if (!channels.empty) {
    const batch = db.batch();
    channels.docs.forEach(channel => batch.set(channel.ref, { bishwaVerified: true }, { merge: true }));
    await batch.commit();
  }
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'POST /api/admin/users/search': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; search?: string };
      if (!input.idToken) return error('Sign in with the Bishwa admin account first.', 401);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken, true);
      if (decoded.email?.toLowerCase() !== BISWA_ADMIN_EMAIL) return error('Only the Bishwa owner account can access this panel.', 403);
      const term = String(input.search || '').trim().toLowerCase();
      const snapshot = term.includes('@')
        ? await db.collection('users').where('email', '==', term).limit(20).get()
        : await db.collection('users').limit(300).get();
      const users = snapshot.docs.map(item => {
        const value = item.data();
        return { uid: item.id, displayName: String(value.displayName || 'Bishwa user'), email: String(value.email || ''), photoURL: String(value.photoURL || ''), bishwaVerified: value.bishwaVerified === true };
      }).filter(item => !term || item.displayName.toLowerCase().includes(term) || item.email.toLowerCase().includes(term) || item.uid.toLowerCase().includes(term)).sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 50);
      return json({ users });
    } catch (cause) {
      console.error('Admin user search failed:', cause);
      return error('Could not load Bishwa users. Please try again.', 500);
    }
  }],
  'POST /api/admin/bishwa-verified': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; targetUid?: string; option?: string; password?: string };
      if (!input.idToken || !input.targetUid || !input.option || !input.password) return error('Enter the BS password and choose a Bishwa user.', 400);
      if (input.option !== 'BS' || input.password !== 'BS') return error('Incorrect BS password or verification option.', 403);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken, true);
      if (decoded.email?.toLowerCase() !== BISWA_ADMIN_EMAIL) return error('Only the Bishwa owner account can award this badge.', 403);
      const target = await db.collection('users').doc(input.targetUid).get();
      if (!target.exists) return error('The selected Bishwa user was not found.', 404);
      await markBishwaVerified(db, input.targetUid, 'admin', decoded.uid);
      return json({ verified: true, uid: input.targetUid });
    } catch (cause) {
      console.error('Bishwa verification award failed:', cause);
      return error('Could not verify this user. Please try again.', 500);
    }
  }],
  'POST /api/admin/official-channel/verify': [async ({ body }) => {
    try {
      const input = body as { idToken?: string };
      if (!input.idToken) return error('Sign in with the Bishwa owner account first.', 401);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken, true);
      if (decoded.email?.trim().toLowerCase() !== BISWA_ADMIN_EMAIL) {
        return error('Only the Bishwa owner account can verify the official channel.', 403);
      }
      const allChannels = await db.collection('channels').get();
      const normalizeChannelName = (value: unknown) => String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\\s._-]+/g, '')
        .replace(/[^\\p{L}\\p{N}]/gu, '');
      const acceptedNames = new Set(['bishwaspecial', 'বিশ্বস্পেশাল']);
      const matches = allChannels.docs.filter(item => acceptedNames.has(normalizeChannelName(item.get('name'))));
      if (matches.length === 0) return error('The existing Bishwa Special channel was not found. Check its saved channel name in Firestore.', 404);
      if (matches.length !== 1) return error('More than one Bishwa Special channel was found. Please resolve the duplicate channel names first.', 409);
      const channel = matches[0];
      await channel.ref.set({
        bishwaVerified: true,
        officialChannel: true,
        verificationLabel: 'Bishwa Official (B-Right)',
        bishwaVerifiedAt: new Date(),
        bishwaVerifiedSource: 'official-channel',
        bishwaVerifiedBy: decoded.uid,
        updatedAt: new Date(),
      }, { merge: true });
      return json({ verified: true, channelId: channel.id, channelName: String(channel.get('name') || 'Bishwa Special'), verificationLabel: 'Bishwa Official (B-Right)' });
    } catch (cause) {
      console.error('Official Bishwa channel verification failed:', cause);
      return error('Could not verify the official Bishwa channel. Please try again.', 500);
    }
  }],
  'POST /api/account/verification-notice': [async ({ body }) => {
    try {
      const input = body as { idToken?: string };
      if (!input.idToken) return error('Sign in is required.', 401);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken, true);
      const account = await auth.getUser(decoded.uid);
      const createdAt = Date.parse(account.metadata.creationTime);
      const profileRef = db.collection('users').doc(decoded.uid);
      const profile = await profileRef.get();
      if (Number.isFinite(createdAt) && Date.now() - createdAt >= TWO_YEARS_MS && profile.get('bishwaVerified') !== true) {
        await markBishwaVerified(db, decoded.uid, 'membership-tenure');
      }
      const latest = await profileRef.get();
      const showNotice = latest.get('bishwaVerifiedNoticePending') === true;
      if (showNotice) await profileRef.set({ bishwaVerifiedNoticePending: false }, { merge: true });
      return json({ verified: latest.get('bishwaVerified') === true, showNotice });
    } catch (cause) {
      console.error('Bishwa verification notice check failed:', cause);
      return error('Could not check Bishwa verification status.', 500);
    }
  }],
  'POST /api/storage/repair-cors': [async ({ body }) => {
    try {
      const input = body as { idToken?: string };
      if (!input.idToken) return error('Sign-in is required to repair uploads.', 401);
      const { auth, bucket } = await getFirebaseAdmin();
      await auth.verifyIdToken(input.idToken);
      const origin = 'https://bishwa-search-engine-ikb6hy.v2.appdeploy.ai';
      const [metadata] = await bucket.getMetadata();
      const existing = Array.isArray(metadata.cors) ? metadata.cors : [];
      const cors = existing.filter((rule: { origin?: string[] }) => !rule.origin?.includes(origin));
      cors.push({
        origin: [origin],
        method: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
        responseHeader: ['Content-Type', 'x-goog-resumable', 'x-goog-upload-command', 'x-goog-upload-protocol', 'x-goog-upload-offset', 'x-goog-upload-status'],
        maxAgeSeconds: 3600,
      });
      await bucket.setMetadata({ cors });
      return json({ configured: true });
    } catch (cause) {
      console.error('Storage CORS repair failed:', cause);
      return error('Could not repair Firebase Storage CORS. Check the bucket and service-account permissions.', 500);
    }
  }],
  'GET /api/messages/push-status': [async () => {
    const names = await secrets.listSecretNames();
    return json({ configured: names.includes('FIREBASE_SERVICE_ACCOUNT_JSON') });
  }],    'POST /api/messages/register-device': [async ({ body }) => {
      try {
        const input = body as { idToken?: string; token?: string; platform?: string };
        if (!input.idToken || !input.token) return error('Sign-in and a device token are required.', 400);
        const { auth, db } = await getFirebaseAdmin();
        const decoded = await auth.verifyIdToken(input.idToken);
        if (!input.token.trim() || input.token.length > 4096) return error('The device token is invalid.', 400);
        await db.collection('users').doc(decoded.uid).collection('devices').doc(input.token).set({
          token: input.token,
          updatedAt: new Date(),
          platform: String(input.platform || 'web').slice(0, 120),
        }, { merge: true });
        return json({ registered: true });
      } catch (cause) {
        console.error('Message device registration failed:', cause);
        return error('Could not register this device for message notifications.', 500);
      }
    }],
    'POST /api/messages/push': [async ({ body }) => {
    try {
      const input = body as {
        idToken?: string;
        senderUid?: string;
        recipientUid?: string;
        conversationId?: string;
        senderName?: string;
        messageText?: string;
      };
      if (!input.idToken || !input.senderUid || !input.recipientUid || !input.conversationId || !input.messageText) {
        return error('Missing required message notification fields.', 400);
      }
      const { auth, db, realtime, messaging } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken);
      if (decoded.uid !== input.senderUid) return error('Sender authentication mismatch.', 403);
      const chatSnapshot = await realtime.ref(`chats/${input.conversationId}/meta/members`).get();
      const members = chatSnapshot.val() as Record<string, boolean> | null;
      if (!members?.[input.senderUid] || !members?.[input.recipientUid]) {
        return error('You are not authorized to notify this conversation recipient.', 403);
      }
      const deviceSnapshot = await db.collection('users').doc(input.recipientUid).collection('devices').get();
      const tokens = deviceSnapshot.docs.map(item => item.get('token')).filter((token): token is string => typeof token === 'string' && token.length > 0);
      if (!tokens.length) return json({ sent: 0, reason: 'Recipient has no registered notification device.' });
      const result = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: input.senderName || 'New Bishwa message',
          body: input.messageText.slice(0, 160),
        },
        data: { conversationId: input.conversationId, senderUid: input.senderUid },
        webpush: { fcmOptions: { link: '/' } },
      });
      return json({ sent: result.successCount, failed: result.failureCount });
    } catch (cause) {
      console.error('Message push delivery failed:', cause);
      return error('Could not deliver push notification.', 500);
    }
  }],
  'POST /api/posts/comments/list': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; postId?: string };
      if (!input.idToken || !input.postId) return error('Sign-in and a post are required.', 400);
      const { auth, db } = await getFirebaseAdmin();
      await auth.verifyIdToken(input.idToken);
      const { postRef, post } = await verifyPublicPost(db, input.postId);
      if (!post) return error('This public post is not available.', 404);
      const snapshot = await postRef.collection('comments').get();
      const comments = snapshot.docs.map(item => {
        const value = item.data();
        const createdAt = value.createdAt?.toDate
          ? value.createdAt.toDate().toISOString()
          : typeof value.createdAt === 'string' ? value.createdAt : '';
        return {
          id: item.id,
          authorId: String(value.authorId || ''),
          authorName: String(value.authorName || 'Bishwa user'),
          text: String(value.text || ''),
          createdAt,
        };
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return json({ comments });
    } catch (cause) {
      console.error('Comment list failed:', cause);
      return error('Could not load comments. Please try again.', 500);
    }
  }],
  'POST /api/posts/comments/create': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; postId?: string; text?: string };
      const text = (input.text || '').trim().slice(0, 1000);
      if (!input.idToken || !input.postId || !text) return error('Write a comment before posting.', 400);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken);
      const { postRef, post } = await verifyPublicPost(db, input.postId);
      if (!post) return error('This public post is not available.', 404);
      const authorName = decoded.name || (decoded.email ? decoded.email.split('@')[0] : 'Bishwa user');
      const created = await postRef.collection('comments').add({
        authorId: decoded.uid,
        authorName,
        text,
        createdAt: new Date(),
      });
      return json({
        comment: {
          id: created.id,
          authorId: decoded.uid,
          authorName,
          text,
          createdAt: new Date().toISOString(),
        },
      }, 201);
    } catch (cause) {
      console.error('Comment creation failed:', cause);
      return error('Could not publish your comment. Please try again.', 500);
    }
  }],
  'POST /api/posts/comments/delete': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; postId?: string; commentId?: string };
      if (!input.idToken || !input.postId || !input.commentId) return error('Missing comment details.', 400);
      const { auth, db } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken);
      const { postRef, post } = await verifyPublicPost(db, input.postId);
      if (!post) return error('This public post is not available.', 404);
      const commentRef = postRef.collection('comments').doc(input.commentId);
      const commentSnapshot = await commentRef.get();
      if (!commentSnapshot.exists) return error('Comment not found.', 404);
      if (commentSnapshot.get('authorId') !== decoded.uid) return error('You can only delete your own comment.', 403);
      await commentRef.delete();
      return json({ deleted: true });
    } catch (cause) {
      console.error('Comment deletion failed:', cause);
      return error('Could not delete this comment. Please try again.', 500);
    }
  }],
  'POST /api/channels/video-published': [async ({ body }) => {
    try {
      const input = body as { idToken?: string; channelId?: string; postId?: string };
      if (!input.idToken || !input.channelId || !input.postId) return error('Missing channel or video details.', 400);
      const { auth, db, messaging } = await getFirebaseAdmin();
      const decoded = await auth.verifyIdToken(input.idToken);
      const channelSnapshot = await db.collection('channels').doc(input.channelId).get();
      if (!channelSnapshot.exists || channelSnapshot.get('ownerId') !== decoded.uid) {
        return error('Only the channel owner can send its video notification.', 403);
      }
      const postSnapshot = await db.collection('channelPosts').doc(input.postId).get();
      if (!postSnapshot.exists) return error('Published video not found.', 404);
      const post = postSnapshot.data()!;
      if (post.channelId !== input.channelId || post.ownerId !== decoded.uid || post.type !== 'video' || post.status !== 'published' || post.visibility !== 'public') {
        return error('This video does not belong to the authenticated public channel.', 403);
      }
      const [subscriptions, channelName] = await Promise.all([
        db.collection('channelSubscriptions').where('channelId', '==', input.channelId).get(),
        Promise.resolve(String(channelSnapshot.get('name') || 'Bishwa channel')),
      ]);
      const userIds = Array.from(new Set(subscriptions.docs.map(item => String(item.get('userId') || '')).filter(Boolean)));
      const tokenSet = new Set<string>();
      for (const uid of userIds) {
        const devices = await db.collection('users').doc(uid).collection('devices').get();
        devices.docs.forEach(device => {
          const token = device.get('token');
          if (typeof token === 'string' && token.length > 0) tokenSet.add(token);
        });
      }
      const tokens = Array.from(tokenSet);
      if (!tokens.length) return json({ sent: 0, members: userIds.length, reason: 'No Super member devices have notifications enabled.' });
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < tokens.length; index += 500) {
        const result = await messaging.sendEachForMulticast({
          tokens: tokens.slice(index, index + 500),
          notification: {
            title: `New video from ${channelName}`,
            body: String(post.title || 'A new video is available.').slice(0, 160),
          },
          data: {
            type: 'channel_video',
            channelId: input.channelId,
            postId: input.postId,
          },
          webpush: { fcmOptions: { link: '/' } },
        });
        sent += result.successCount;
        failed += result.failureCount;
      }
      return json({ sent, failed, members: userIds.length });
    } catch (cause) {
      console.error('Super member video notification failed:', cause);
      return error('The video was published, but Super member notifications could not be delivered.', 500);
    }
  }],
});