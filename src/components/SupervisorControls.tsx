import { useState } from 'react';
import { updateReportStatus } from '../lib/reports';
import type { Issue, Status } from '../types';

type Props = {
  issue: Issue;
  actorId: string;
  onStatusUpdated: (updatedIssue: Issue) => void;
};

// Added 'Under review' so you can reopen tickets
const AVAILABLE_STATUSES: Status[] = ['Under review', 'Accepted', 'In progress', 'Resolved', 'Rejected', 'Duplicate'];

export default function SupervisorControls({ issue, actorId, onStatusUpdated }: Props) {
  const [selectedStatus, setSelectedStatus] = useState<Status>(issue.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (selectedStatus === issue.status) return;
    
    setBusy(true);
    setError('');
    
    try {
      const updatedIssue = await updateReportStatus(issue, selectedStatus, note, actorId);
      setNote('');
      onStatusUpdated(updatedIssue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleUpdate} className="supervisor-controls">
      <div style={{ padding: '12px 0', borderTop: '1px solid #eee', marginTop: '16px' }}>
        <h3 style={{ fontSize: '14px', marginBottom: '12px' }}>Update Status</h3>
        
        <label style={{ display: 'block', marginBottom: '12px', fontSize: '13px' }}>
          New Status
          <select 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value as Status)}
            style={{ display: 'block', width: '100%', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #ccc' }}
          >
            <option value={issue.status} disabled>{issue.status} (Current)</option>
            {AVAILABLE_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: '12px', fontSize: '13px' }}>
          Supervisor Note
          <textarea 
            required 
            value={note} 
            onChange={(e) => setNote(e.target.value)}
            placeholder="Explain the update..."
            style={{ display: 'block', width: '100%', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #ccc', minHeight: '60px' }}
          />
        </label>

        {error && <div className="error-message" style={{ color: 'red', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
        
        <button type="submit" disabled={busy || selectedStatus === issue.status} className="primary-button" style={{ width: '100%' }}>
          {busy ? 'Updating...' : 'Save Update'}
        </button>
      </div>
    </form>
  );
}