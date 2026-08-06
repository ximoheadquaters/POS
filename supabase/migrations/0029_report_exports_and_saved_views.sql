-- Migration 0029: Report Export Jobs and Saved Views with Row Level Security

CREATE TABLE IF NOT EXISTS public.report_export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id VARCHAR(64) NOT NULL,
  format VARCHAR(10) NOT NULL CHECK (format IN ('pdf', 'xlsx', 'csv', 'png')),
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'expired')),
  storage_path TEXT,
  row_count INT DEFAULT 0,
  error_code VARCHAR(64),
  safe_error_message TEXT,
  internal_error_reference VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_report_export_jobs_org_user ON public.report_export_jobs(organization_id, requested_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  report_id VARCHAR(64) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'organization')),
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_by VARCHAR(50),
  chart_preference VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_saved_views_org_owner ON public.report_saved_views(organization_id, owner_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.report_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_saved_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies for report_export_jobs
CREATE POLICY report_export_jobs_select_policy ON public.report_export_jobs
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      requested_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.roles r ON r.id = p.role_id
        WHERE p.id = auth.uid() AND r.code IN ('owner', 'admin')
      )
    )
  );

CREATE POLICY report_export_jobs_insert_policy ON public.report_export_jobs
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND requested_by = auth.uid()
  );

-- RLS Policies for report_saved_views
CREATE POLICY report_saved_views_select_policy ON public.report_saved_views
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      visibility = 'organization'
      OR owner_id = auth.uid()
    )
  );

CREATE POLICY report_saved_views_insert_policy ON public.report_saved_views
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND owner_id = auth.uid()
  );

CREATE POLICY report_saved_views_update_policy ON public.report_saved_views
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND owner_id = auth.uid()
  );

CREATE POLICY report_saved_views_delete_policy ON public.report_saved_views
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND owner_id = auth.uid()
  );
