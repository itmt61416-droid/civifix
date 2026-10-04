import type { Status } from '../types';
export default function StatusBadge({ status }: { status: Status }) { return <span className={`badge badge-${status.toLowerCase().replaceAll(' ','-')}`}><i />{status}</span>; }
