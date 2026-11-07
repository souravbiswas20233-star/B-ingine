import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { auth } from './firebase';
import { LoaderCircle, MessageCircle, Send, Trash2 } from 'lucide-react';

type CommentRecord = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
};

export default function PostComments({
  postId,
  notify,
}: {
  postId: string;
  notify: (message: string) => void;
}) {
  const user = auth.currentUser;
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadComments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const response = await api.post('/api/posts/comments/list', { idToken, postId });
      setComments(Array.isArray(response.data?.comments) ? response.data.comments : []);
    } catch (error) {
      console.error('Post comments load failed:', error);
      notify('Comments could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [postId, user, notify]);

  useEffect(() => {
    if (open) void loadComments();
  }, [open, loadComments]);

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !draft.trim() || saving) return;
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      await api.post('/api/posts/comments/create', { idToken, postId, text: draft.trim() });
      setDraft('');
      await loadComments();
    } catch (error) {
      console.error('Comment publish failed:', error);
      notify('Your comment could not be published. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!user || !window.confirm('Delete your comment?')) return;
    try {
      const idToken = await user.getIdToken();
      await api.post('/api/posts/comments/delete', { idToken, postId, commentId });
      setComments(old => old.filter(comment => comment.id !== commentId));
    } catch (error) {
      console.error('Comment delete failed:', error);
      notify('Your comment could not be deleted.');
    }
  };

  return (
    <section className="post-comments">
      <button type="button" className="post-comments-toggle" onClick={() => setOpen(value => !value)}>
        <MessageCircle size={15} /> {open ? 'Hide comments' : 'Comments'} {comments.length > 0 ? `· ${comments.length}` : ''}
      </button>
      {open && (
        <div className="post-comments-panel">
          {loading ? (
            <div className="post-comments-loading"><LoaderCircle size={16} className="channel-spin" /> Loading comments…</div>
          ) : comments.length ? (
            <div className="post-comments-list">
              {comments.map(comment => (
                <article className="post-comment" key={comment.id}>
                  <div className="post-comment-copy">
                    <b>{comment.authorName}</b>
                    <p>{comment.text}</p>
                    <small>{comment.createdAt ? new Date(comment.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Just now'}</small>
                  </div>
                  {user?.uid === comment.authorId && (
                    <button type="button" className="post-comment-delete" onClick={() => deleteComment(comment.id)} aria-label="Delete your comment">
                      <Trash2 size={14} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="post-comments-empty">No comments yet. Be the first to comment.</p>
          )}
          <form className="post-comment-form" onSubmit={submitComment}>
            <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" />
            <button type="submit" disabled={!draft.trim() || saving} aria-label="Post comment">
              {saving ? <LoaderCircle size={16} className="channel-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
