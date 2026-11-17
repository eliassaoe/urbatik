-- Dossiers générés par l'IA : une ligne par lancement du générateur (GitHub Actions).
-- Le jeton de lancement n'est stocké que haché ; il expire après 3 heures.
create table if not exists public.dossier_generations (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete cascade,
    token_hash text not null,
    status text not null default 'lancee' check (status in ('lancee', 'en_cours', 'a_relire', 'echec', 'validee')),
    a_verifier jsonb not null default '[]'::jsonb,
    pdf_path text,
    insertion_path text,
    erreur text,
    appels_vision int not null default 0,
    appels_image int not null default 0,
    lance_par text not null default 'auto',
    expires_at timestamptz not null default now() + interval '3 hours',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists dossier_generations_order_idx on public.dossier_generations (order_id, created_at desc);
alter table public.dossier_generations enable row level security;
-- aucune politique : seules les Edge Functions (clé service) y accèdent.
