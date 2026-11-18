-- Vérification du PLU avant paiement (fonction plu-check). « analyse » est un mot réservé : colonne `resultat`.
create table if not exists public.plu_checks (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    input_hash text not null,
    input jsonb not null,
    faits jsonb,
    cache_key text,
    token_hash text,
    status text not null default 'en_cours',   -- en_cours | extraction | analyse | pret | erreur
    verdict text,                               -- viable | a_verifier | non_viable | inconnu
    resultat jsonb,
    erreur text
);
create index if not exists plu_checks_hash_idx on public.plu_checks (input_hash, created_at desc);
alter table public.plu_checks enable row level security;

create table if not exists public.plu_reglement_cache (
    cache_key text primary key,                 -- url du règlement | code de zone
    texte text not null,
    created_at timestamptz not null default now()
);
alter table public.plu_reglement_cache enable row level security;

alter table public.orders add column if not exists plu_check_id uuid;
