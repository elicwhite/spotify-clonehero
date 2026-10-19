-- Delete current user from auth.users via RPC
-- SECURITY DEFINER allows execution with function owner's privileges
-- Ensure only authenticated users can call it and only on themselves

create or replace function public.delete_user()
returns void
language sql
security definer
as $$
  delete from auth.users where id = auth.uid();
$$;

-- Allow only authenticated users to execute
revoke all on function public.delete_user() from public;
grant execute on function public.delete_user() to authenticated;


