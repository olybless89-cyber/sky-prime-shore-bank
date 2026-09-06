-- ─────────────────────────────────────────────────────────────────────────────
-- Admin: delete a user (auth.users + all child rows via FK cascade).
--
-- `admin_delete_user(target_id uuid)` — SECURITY DEFINER RPC so admins can
-- remove any non-admin user from the dashboard (RLS blocks cross-user writes
-- from the client`; deleting `auth.users` is also schema-protected). Deleting
-- the auth user cascades to `public.profiles`, `transactions`, `deposit_requests`,
-- `transfer_requests`, `loan_applications`, `support_tickets` (all child tables
-- declare `user_id references auth.users(id) on delete cascade`).
--
-- Guards:
--   * caller must be an admin (same check as every other admin_* RPC)
--   * cannot delete yourself
--   * cannot delete a profile with `role='admin'` (including the seeded
--     `admin@primeshorebank.com` — never lose admin access via the dashboard).
--
-- Idempotent. Apply in the Supabase SQL editor or via the CI migration runner.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_email text;
begin
  -- Admin-only guard (matches every other admin_* RPC`
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Access denied: admins only' using errcode = '42501';
  end if;

  -- Cannot delete your own account
  if target_id = auth.uid() then
    raise exception 'Cannot delete your own account' using errcode = '44000';
  end if;

  -- Cannot delete an admin account (protects the seeded admin even if its role
  -- were ever flipped in the DB`
  if exists (
    select 1 from public.profiles p
    where p.id = target_id and p.role = 'admin'
  ) or exists (
    select 1 from auth.users u
    where u.id = target_id and lower(u.email) = 'admin@primeshorebank.com'
  ) then
    raise exception 'Cannot delete an admin account' using errcode = '44000';
  end if;

  -- Grab the email before deleting (for reporting `
  select u.email into v_email from auth.users u where u.id = target_id;
  if v_email is null then
    raise exception 'User not found' using errcode = '46000';
  end if;

  -- FK cascade removes profiles + transactions + deposit/transfer/loan +
  -- support_tickets rows for this user.
  delete from auth.users u where u.id = target_id;
end;
$f$;

grant execute on function public.admin_delete_user(uuid) to anon, authenticated;