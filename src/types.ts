export type Category = 'Road & pothole' | 'Garbage' | 'Drainage' | 'Streetlight' | 'Water leakage' | 'Other';
export type Status = 'Submitted' | 'Under review' | 'Accepted' | 'In progress' | 'Resolved' | 'Rejected' | 'Duplicate';
export type Issue = {
  id: string; title: string; category: Category; description: string; location: string;
  ward: string; department: string; status: Status; priority: 'Normal' | 'Urgent';
  createdAt: string; dueAt: string; reporter: string; photo?: string; updates: { at: string; text: string }[];
};
