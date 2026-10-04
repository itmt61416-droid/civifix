import { getSupabaseClient } from './supabase';
import type { Category, Issue } from '../types';

type NewReport = {
  title: string;
  category: Category;
  description: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  urgent: boolean;
  reporterId: string;
  photo: File | null;
};

const PHOTO_BUCKET = 'civifix-reports';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const departmentFor = (category: Category) => ({
  'Road & pothole': 'Road Maintenance',
  Garbage: 'Solid Waste',
  Drainage: 'Drainage',
  Streetlight: 'Electrical Services',
  'Water leakage': 'Water Services',
  Other: 'Needs manual routing',
}[category]);

const targetDaysFor = (category: Category) => ({
  'Road & pothole': 7,
  Garbage: 2,
  Drainage: 1,
  Streetlight: 3,
  'Water leakage': 1,
  Other: 3,
}[category]);

function makeTicketCode() {
  return `CV-${Date.now().toString().slice(-7)}-${Math.floor(Math.random()*90+10)}`;
}

export async function createReport(input: NewReport): Promise<Issue> {
  const supabase = getSupabaseClient();

  // Ward 14 is the current demo ward. Replace this lookup with geographic
  // point-in-polygon routing when verified ward boundary data is available.
  const { data: ward, error: wardError } = await supabase
    .from('wards')
    .select('id, ward_code, name')
    .eq('ward_code', '14')
    .single();
  if (wardError) throw new Error(`Could not find the demo ward: ${wardError.message}`);

  const createdAt = new Date();
  const dueAt = new Date(createdAt.getTime() + targetDaysFor(input.category) * 86400000);
  const ticketCode = makeTicketCode();
  let photoPath: string | null = null;
  if (input.photo && input.photo.size > 0) {
    if (!['image/jpeg','image/png','image/webp'].includes(input.photo.type)) {
      throw new Error('Choose a JPG, PNG, or WebP image.');
    }
    if (input.photo.size > MAX_PHOTO_BYTES) throw new Error('The photo must be 5 MB or smaller.');
    const extension = input.photo.type === 'image/png' ? 'png' : input.photo.type === 'image/webp' ? 'webp' : 'jpg';
    photoPath = `${input.reporterId}/${ticketCode}.${extension}`;
    const {error: uploadError} = await supabase.storage.from(PHOTO_BUCKET).upload(photoPath, input.photo, {
      contentType: input.photo.type,
      upsert: false,
    });
    if (uploadError) throw new Error(`Could not upload the photo: ${uploadError.message}. Check that storage.sql has been run.`);
  }

  const { data, error } = await supabase.from('reports').insert({
    ticket_code: ticketCode,
    title: input.title.trim(),
    category: input.category,
    description: input.description.trim(),
    location_label: input.location.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    ward_id: ward.id,
    department: departmentFor(input.category),
    priority: input.urgent ? 'urgent' : 'normal',
    status: 'submitted',
    reporter_id: input.reporterId,
    due_at: dueAt.toISOString(),
    photo_path: photoPath,
  }).select('id, ticket_code, title, category, description, location_label, ward_id, department, priority, status, created_at, due_at, photo_path').single();

  if (error) {
    if (photoPath) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
    throw new Error(`Could not save the report: ${error.message}`);
  }

  let photoUrl: string | undefined;
  if (data.photo_path) {
    const {data: signed, error: signedError} = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(data.photo_path, 3600);
    if (!signedError) photoUrl = signed.signedUrl;
  }

  return {
    id: data.ticket_code,
    title: data.title,
    category: data.category as Category,
    description: data.description,
    location: data.location_label,
    ward: `Ward ${ward.ward_code} · ${ward.name}`,
    department: data.department,
    status: 'Submitted',
    priority: data.priority === 'urgent' ? 'Urgent' : 'Normal',
    createdAt: data.created_at,
    dueAt: data.due_at,
    reporter: 'You',
    photo: photoUrl,
    updates: [{ at: data.created_at, text: 'Report submitted; waiting for ward review' }],
  };
}

const statusLabel: Record<string, Issue['status']> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
};
const statusValue: Record<Issue['status'], string> = {
  Submitted: 'submitted',
  'Under review': 'under_review',
  Accepted: 'accepted',
  'In progress': 'in_progress',
  Resolved: 'resolved',
  Rejected: 'rejected',
  Duplicate: 'duplicate',
};

export type CiviFixRole = 'citizen' | 'supervisor' | 'senior_officer';

export async function getUserRole(userId: string): Promise<CiviFixRole> {
  const {data,error} = await getSupabaseClient().from('profiles').select('role').eq('id',userId).single();
  if (error) throw new Error(`Could not load your account role: ${error.message}`);
  return data.role as CiviFixRole;
}

export async function updateReportStatus(issue: Issue, nextStatus: Issue['status'], note: string, actorId: string): Promise<Issue> {
  const supabase = getSupabaseClient();
  const {data: report,error: lookupError} = await supabase.from('reports').select('id,status').eq('ticket_code',issue.id).single();
  if (lookupError) throw new Error(`Could not find report ${issue.id}: ${lookupError.message}`);

  const {error: updateError} = await supabase.from('reports').update({
    status: statusValue[nextStatus],
    updated_at: new Date().toISOString(),
    resolved_at: nextStatus === 'Resolved' ? new Date().toISOString() : null,
  }).eq('id',report.id);
  if (updateError) throw new Error(`Could not update report status: ${updateError.message}`);

  const {error: historyError} = await supabase.from('report_updates').insert({
    report_id: report.id,
    actor_id: actorId,
    old_status: report.status,
    new_status: statusValue[nextStatus],
    note: note.trim() || `Status updated to ${nextStatus}.`,
    is_public: true,
  });
  if (historyError) throw new Error(`Status was changed, but its timeline entry could not be saved: ${historyError.message}`);

  return {
    ...issue,
    status: nextStatus,
    updates: [...issue.updates,{at:new Date().toISOString(),text:note.trim() || `Status updated to ${nextStatus}.`}],
  };
}

export async function requestReportRecheck(issue: Issue, actorId: string): Promise<Issue> {
  const supabase = getSupabaseClient();
  const {data: report,error: lookupError} = await supabase.from('reports').select('id,status').eq('ticket_code',issue.id).single();
  if (lookupError) throw new Error(`Could not find report ${issue.id}: ${lookupError.message}`);
  if (report.status !== 'resolved') throw new Error('Only a resolved report can be sent back for review.');
  const note = 'Resident says the issue remains unresolved and requests a recheck.';
  const {error} = await supabase.from('report_updates').insert({
    report_id: report.id,
    actor_id: actorId,
    old_status: 'resolved',
    new_status: null,
    note,
    is_public: true,
    is_reopen_request: true,
  });
  if (error) throw new Error(`Could not request a recheck: ${error.message}`);
  return {...issue,updates:[...issue.updates,{at:new Date().toISOString(),text:note}]};
}

export async function listReports(): Promise<Issue[]> {
  const supabase = getSupabaseClient();
  const [{data: reports, error}, {data: wards, error: wardError}] = await Promise.all([
    supabase.from('reports').select('id,ticket_code,title,category,description,location_label,ward_id,department,priority,status,created_at,due_at,photo_path').order('created_at', {ascending:false}),
    supabase.from('wards').select('id,ward_code,name'),
  ]);
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  if (wardError) throw new Error(`Could not load wards: ${wardError.message}`);

  const wardNames = new Map((wards ?? []).map(w => [w.id, `Ward ${w.ward_code} · ${w.name}`]));
  const reportIds = (reports ?? []).map(row => row.id);
  const {data: history,error: historyError} = reportIds.length
    ? await supabase.from('report_updates').select('report_id,note,created_at').in('report_id',reportIds).order('created_at',{ascending:true})
    : {data:[],error:null};
  if (historyError) throw new Error(`Could not load report history: ${historyError.message}`);
  const historyByReport = new Map<string,{at:string;text:string}[]>();
  for (const event of history ?? []) {
    const events = historyByReport.get(event.report_id) ?? [];
    events.push({at:event.created_at,text:event.note});
    historyByReport.set(event.report_id,events);
  }
  const photoPaths = (reports ?? []).map(row => row.photo_path).filter((path): path is string => Boolean(path));
  const signedPhotoUrls = new Map<string,string>();
  if (photoPaths.length) {
    const {data: signedPhotos} = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(photoPaths, 3600);
    for (const photo of signedPhotos ?? []) if (photo.path && photo.signedUrl) signedPhotoUrls.set(photo.path, photo.signedUrl);
  }
  return (reports ?? []).map(row => ({
    id: row.ticket_code,
    title: row.title,
    category: row.category as Category,
    description: row.description,
    location: row.location_label,
    ward: row.ward_id ? (wardNames.get(row.ward_id) ?? 'Ward assignment unavailable') : 'Ward not assigned',
    department: row.department,
    status: statusLabel[row.status] ?? 'Submitted',
    priority: row.priority === 'urgent' ? 'Urgent' : 'Normal',
    createdAt: row.created_at,
    dueAt: row.due_at ?? row.created_at,
    reporter: 'You',
    photo: row.photo_path ? signedPhotoUrls.get(row.photo_path) : undefined,
    updates: historyByReport.get(row.id)?.length ? historyByReport.get(row.id)! : [{at:row.created_at,text:'Report submitted; waiting for ward review'}],
  }));
}
