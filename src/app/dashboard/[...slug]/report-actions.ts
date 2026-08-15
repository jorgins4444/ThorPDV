'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const SESSION_COOKIE = 'thorpdv_test_session';

type ReportResult = {
  ok?: boolean;
  error?: string;
  report?: string;
  data?: Record<string, unknown>[];
  start?: string;
  end?: string;
  branch?: string | null;
};

async function sessionToken() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  return token;
}

export async function erpReportV2(
  report: string,
  start?: string,
  end?: string,
  branchId?: string,
  filters: Record<string, unknown> = {},
) {
  const token = await sessionToken();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('erp_report_v4', {
    p_token: token,
    p_report: report,
    p_start: start || null,
    p_end: end || null,
    p_branch: branchId || null,
    p_filters: filters,
  });
  if (error) return { ok: false, error: error.message, data: [] } as ReportResult;
  const result = (data ?? {}) as ReportResult;
  return {
    ok: Boolean(result.ok),
    error: result.error,
    report: result.report,
    data: Array.isArray(result.data) ? result.data : [],
    start: result.start,
    end: result.end,
    branch: result.branch,
  } as ReportResult;
}
