-- Allow authenticated users to submit issue reports through PostgREST without granting
-- broad read access to anonymous reports.

GRANT INSERT ON TABLE public.user_issue_reports TO authenticated;
