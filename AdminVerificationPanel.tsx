import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import { auth } from './firebase';
import { BadgeCheck, LoaderCircle, Search, ShieldCheck, UserRound } from 'lucide-react';

type AdminUser = { uid: string; displayName: string; email: string; photoURL: string; bishwaVerified: boolean };

export default function AdminVerificationPanel({ notify, password }: { notify: (message: string) => void; password: string }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState('');
  const isAdmin = auth.currentUser?.email?.toLowerCase() === 'biswassuprotik3@mail.com';

  async function loadUsers(term = search) {
    const user = auth.currentUser;
    if (!user || !isAdmin) return;
    setLoading(true);
    try {
      const idToken = await user.getIdToken();
      const response = await api.post('/api/admin/users/search', { idToken, search: term.trim() });
      setUsers(Array.isArray(response.data?.users) ? response.data.users : []);
    } catch (cause) {
      console.error('Admin user list failed:', cause);
      notify('Admin user list could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void loadUsers('');
  }, [isAdmin]);

  async function chooseOption(target: AdminUser, option: 'DS' | 'RSS' | 'BS') {
    if (option !== 'BS') {
      notify(option + ' is not the Bishwa verification key.');
      return;
    }
    if (target.bishwaVerified) {
      notify('This user is already Bishwa Verified.');
      return;
    }
    const user = auth.currentUser;
    if (!user || !isAdmin) {
      notify('Only the Bishwa owner account can award verification.');
      return;
    }
    setBusyUid(target.uid);
    try {
      const idToken = await user.getIdToken();
      await api.post('/api/admin/bishwa-verified', { idToken, targetUid: target.uid, option: 'BS', password });
      setUsers(current => current.map(item => item.uid === target.uid ? { ...item, bishwaVerified: true } : item));
      notify(target.displayName + ' is now Bishwa Verified.');
    } catch (cause) {
      console.error('Bishwa verification action failed:', cause);
      notify('Verification could not be completed. Check your admin account and try again.');
    } finally {
      setBusyUid('');
    }
  }

  if (!isAdmin) return null;

  return (
    <section className="admin-verification-panel">
      <div className="admin-verification-heading">
        <span className="setting-icon"><ShieldCheck size={20} /></span>
        <div><b>Bishwa owner controls</b><p>Search for a member and choose one of the three options. Only BS awards verification.</p></div>
      </div>
      <form className="admin-user-search" onSubmit={event => { event.preventDefault(); void loadUsers(search); }}>
        <Search size={17} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search member name, email or UID" aria-label="Search Bishwa members" />
        <button type="submit" disabled={loading}>{loading ? <LoaderCircle size={16} className="channel-spin" /> : 'Search'}</button>
      </form>
      <div className="admin-user-results">
        {loading ? <div className="admin-users-empty"><LoaderCircle size={18} className="channel-spin" /> Loading members…</div> : users.length ? users.map(member => (
          <article className="admin-user-row" key={member.uid}>
            <span className="admin-user-avatar">{member.photoURL ? <img src={member.photoURL} alt="" /> : <UserRound size={18} />}</span>
            <div className="admin-user-details">
              <b>{member.displayName} {member.bishwaVerified && <span className="bishwa-verified-mark" title="Bishwa Verified"><BadgeCheck size={15} /></span>}</b>
              <small>{member.email || member.uid}</small>
            </div>
            <div className="admin-unlock-options" aria-label={'Verification options for ' + member.displayName}>
              {(['DS', 'RSS', 'BS'] as const).map(option => (
                <button type="button" key={option} className={option === 'BS' ? 'admin-option-button admin-option-bs' : 'admin-option-button'} disabled={busyUid === member.uid || (option === 'BS' && member.bishwaVerified)} onClick={() => void chooseOption(member, option)} title={option === 'BS' ? 'Award Bishwa Verified' : 'This is not the verification key'}>
                  {busyUid === member.uid && option === 'BS' ? <LoaderCircle size={13} className="channel-spin" /> : option}
                </button>
              ))}
            </div>
          </article>
        )) : <div className="admin-users-empty"><UserRound size={19} /> No matching members found.</div>}
      </div>
      <small className="admin-verification-footnote">The server checks the signed-in owner account before accepting BS. DS and RSS never award a badge.</small>
    </section>
  );
}
