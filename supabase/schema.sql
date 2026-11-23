-- Vael Notes database: team members, invites, notes with history, and the NPC roster.
-- Nobody reads or writes anything without a login that is on the team (public.members).

create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);
create table public.invites (
  email text primary key,
  code text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  reset_ok boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create table public.notes (
  id text primary key,
  title text not null,
  folder text not null default '',
  body text not null default '',
  trashed boolean not null default false,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table public.note_history (
  id text primary key,
  note_id text not null references public.notes(id) on delete cascade,
  title text,
  folder text,
  body text,
  saved_at timestamptz,
  replaced_at timestamptz not null default now()
);
create index note_history_note on public.note_history (note_id, replaced_at desc);
create table public.npcs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- The signed-in person's role on the team, or null if they are not on it.
create function public.my_role() returns text
  language sql stable security definer set search_path = ''
  as $$ select role from public.members where user_id = (select auth.uid()) $$;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- Used only by the join function (service role) to find an existing login by email.
create function public.auth_user_id(e text) returns uuid
  language sql stable security definer set search_path = ''
  as $$ select id from auth.users where lower(email) = lower(e) limit 1 $$;
revoke execute on function public.auth_user_id(text) from public, anon, authenticated;
grant execute on function public.auth_user_id(text) to service_role;

-- Record who made each change.
create function public.stamp_editor() returns trigger
  language plpgsql set search_path = ''
  as $$ begin new.updated_by := (select auth.uid()); return new; end $$;
create trigger notes_stamp before insert or update on public.notes for each row execute function public.stamp_editor();
create trigger npcs_stamp before insert or update on public.npcs for each row execute function public.stamp_editor();

alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.notes enable row level security;
alter table public.note_history enable row level security;
alter table public.npcs enable row level security;

grant select, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.invites, public.notes, public.note_history, public.npcs to authenticated;
grant all on public.members, public.invites, public.notes, public.note_history, public.npcs to service_role;

-- Team list: everyone on the team can see it. The owner manages it. Anyone can change their own name, but not their role.
create policy members_read on public.members for select to authenticated using (public.my_role() is not null);
create policy members_owner_update on public.members for update to authenticated using (public.my_role() = 'owner') with check (public.my_role() = 'owner');
create policy members_self_update on public.members for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and role = public.my_role());
create policy members_owner_delete on public.members for delete to authenticated using (public.my_role() = 'owner' and user_id <> (select auth.uid()));

-- Invites: the owner only.
create policy invites_owner on public.invites for all to authenticated using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

-- Notes, their history and NPCs: the whole team reads, owner and writers change.
create policy notes_read on public.notes for select to authenticated using (public.my_role() is not null);
create policy notes_insert on public.notes for insert to authenticated with check (public.my_role() in ('owner', 'editor'));
create policy notes_update on public.notes for update to authenticated using (public.my_role() in ('owner', 'editor')) with check (public.my_role() in ('owner', 'editor'));
create policy notes_delete on public.notes for delete to authenticated using (public.my_role() in ('owner', 'editor'));

create policy history_read on public.note_history for select to authenticated using (public.my_role() is not null);
create policy history_insert on public.note_history for insert to authenticated with check (public.my_role() in ('owner', 'editor'));
create policy history_update on public.note_history for update to authenticated using (public.my_role() in ('owner', 'editor')) with check (public.my_role() in ('owner', 'editor'));
create policy history_delete on public.note_history for delete to authenticated using (public.my_role() in ('owner', 'editor'));

create policy npcs_read on public.npcs for select to authenticated using (public.my_role() is not null);
create policy npcs_insert on public.npcs for insert to authenticated with check (public.my_role() in ('owner', 'editor'));
create policy npcs_update on public.npcs for update to authenticated using (public.my_role() in ('owner', 'editor')) with check (public.my_role() in ('owner', 'editor'));
create policy npcs_delete on public.npcs for delete to authenticated using (public.my_role() in ('owner', 'editor'));

-- Live updates: other people's edits arrive without reloading.
alter publication supabase_realtime add table public.notes, public.npcs;
