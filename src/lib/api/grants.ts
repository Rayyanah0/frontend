// Grants portal API — programs, applications, milestones, payouts.

import { apiGet, apiPost } from "./client";

export interface GrantProgram {
  id: string;
  name: string;
  description: string; // sanitized markdown
  criteria: string;
  total_budget: number;
  remaining_budget: number;
  currency: string;    // e.g. "USDC"
  deadline: string | null;
  is_open: boolean;
  created_at: string;
}

export type ApplicationStatus =
  | "submitted"
  | "review"
  | "approved"
  | "rejected"
  | "milestones"
  | "paid";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  status: "pending" | "submitted" | "approved" | "paid";
  payout_amount: number;
  tx_hash: string | null;
}

export interface GrantApplication {
  id: string;
  program_id: string;
  program_name: string;
  applicant_wallet: string;
  project_title: string;
  summary: string;
  description: string; // sanitized markdown (long-form)
  requested_amount: number;
  team_info: string;
  links: string[]; // URL-validated only, no uploads
  status: ApplicationStatus;
  milestones: Milestone[];
  submitted_at: string;
  updated_at: string;
  ownership_proof: string;
}

export interface ApprovedGrant {
  application_id: string;
  program_name: string;
  project_title: string;
  applicant_wallet: string;
  approved_amount: number;
  milestones: Milestone[];
  approved_at: string;
}

export interface SubmitApplicationInput {
  program_id: string;
  project_title: string;
  summary: string;
  description: string;
  requested_amount: number;
  team_info: string;
  links: string[];
  ownership_proof: string;
}

export function listPrograms(token?: string | null): Promise<GrantProgram[]> {
  return apiGet<GrantProgram[]>("/grants/programs", token);
}

export function getProgram(id: string, token?: string | null): Promise<GrantProgram> {
  return apiGet<GrantProgram>(`/grants/programs/${id}`, token);
}

export function listApprovedGrants(token?: string | null): Promise<ApprovedGrant[]> {
  return apiGet<ApprovedGrant[]>("/grants/approved", token);
}

export function getMyApplications(token: string): Promise<GrantApplication[]> {
  return apiGet<GrantApplication[]>("/grants/my-applications", token);
}

export function getApplication(id: string, token: string): Promise<GrantApplication> {
  return apiGet<GrantApplication>(`/grants/applications/${id}`, token);
}

export function submitApplication(
  input: SubmitApplicationInput,
  token: string
): Promise<GrantApplication> {
  return apiPost<GrantApplication>("/grants/applications", input, token);
}

export function saveDraft(
  programId: string,
  draft: Partial<SubmitApplicationInput>
): void {
  try {
    localStorage.setItem(
      `grant_draft_${programId}`,
      JSON.stringify({ ...draft, saved_at: new Date().toISOString() })
    );
  } catch {
    // localStorage may be unavailable (e.g. SSR or storage full) — fail silently.
  }
}

export function loadDraft(
  programId: string
): (Partial<SubmitApplicationInput> & { saved_at?: string }) | null {
  try {
    const raw = localStorage.getItem(`grant_draft_${programId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDraft(programId: string): void {
  try {
    localStorage.removeItem(`grant_draft_${programId}`);
  } catch {
    // ignore
  }
}
