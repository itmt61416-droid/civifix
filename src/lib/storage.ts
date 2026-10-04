import type { Issue } from '../types';
import { demoIssues } from '../data/demo';
const KEY = 'civifix-issues-v1';
export function loadIssues(): Issue[] {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Issue[]; } catch { /* use demo data */ }
  localStorage.setItem(KEY, JSON.stringify(demoIssues)); return demoIssues;
}
export function saveIssues(issues: Issue[]) { localStorage.setItem(KEY, JSON.stringify(issues)); }
