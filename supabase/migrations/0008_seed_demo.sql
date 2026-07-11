-- ===========================================================================
--  Nexus v2 — Seed démo (équivalent manage.py seed_demo)
--
--  ⚠️ DÉVELOPPEMENT UNIQUEMENT. Crée des comptes à mots de passe connus
--  crédités de gros soldes. NE PAS exécuter en production.
--
--  Les utilisateurs doivent d'abord être créés via l'API auth-register, puis
--  ce script les crédite et génère marchés + carnet. En dev local, on peut
--  créer les utilisateurs directement dans auth.users via la console Supabase
--  (Auth → Users → Add user) avant de lancer ce script.
--
--  Avant de lancer : définir les UUID des utilisateurs ci-dessous, créés au
--  préalable dans auth.users (téléphones : 0341234567, 0340000099, 0340000088).
-- ===========================================================================

-- Raccourcis : on suppose que les 3 utilisateurs existent déjà dans auth.users.
-- Leurs wallets sont créés automatiquement par le trigger on_auth_user_created.
-- On récupère leurs IDs via le téléphone (stocké dans profiles).

do $$
declare
  v_player uuid;
  v_mm1 uuid;
  v_mm2 uuid;
  v_market_id bigint;
  v_deposit_id bigint;
  v_now timestamptz := now();
  v_titles text[] := array[
    'Madagascar se qualifiera-t-elle pour la phase finale de la prochaine Coupe du Monde ?',
    'Le Brésil atteindra-t-il les demi-finales de la Coupe du Monde 2026 ?',
    'Plus de 3 buts seront-ils marqués lors du prochain France – Argentine ?',
    'La page Facebook de Tefihaja atteindra-t-elle 1 000 000 d''abonnés avant le 31 décembre 2026 ?',
    'La page « Buzz Madagascar » atteindra-t-elle 500 000 fans avant le 31 juillet ?',
    'La vidéo de l''artiste X dépassera-t-elle 1 000 000 de vues avant le 10 juillet ?',
    'Le cyclone « Batsirai » touchera-t-il Toamasina avant le 20 juillet ?',
    'La température à Toliara dépassera-t-elle 38°C avant le 15 juillet ?',
    'Le groupe Facebook « Ankapobeny » franchira-t-il 200 000 membres avant le 25 juillet ?'
  ];
  v_cats public.market_category[] := array[
    'SPORTS','SPORTS','SPORTS','SOCIAL','SOCIAL','SOCIAL','WEATHER','WEATHER','TRENDING'
  ];
  v_idx integer;
begin
  -- Résolution des utilisateurs par téléphone.
  select id into v_player from public.profiles where phone = '0341234567';
  select id into v_mm1    from public.profiles where phone = '0340000099';
  select id into v_mm2    from public.profiles where phone = '0340000088';

  if v_player is null or v_mm1 is null or v_mm2 is null then
    raise exception 'Utilisateurs démo manquants. Créez-les d''abord dans auth.users (Auth → Users) avec les téléphones 0341234567, 0340000099, 0340000088.';
  end if;

  -- --- Création des marchés ---
  for v_idx in 1..array_length(v_titles, 1) loop
    insert into public.markets
      (question, description, category, source_url, source_rules,
       bet_close_at, resolve_at, status, is_featured)
    values
      (v_titles[v_idx],
       v_titles[v_idx] || E'\n\nRèglement strict et source vérifiable ci-dessous.',
       v_cats[v_idx],
       'https://example.org/source',
       'Si la source officielle est indisponible pendant plus de 24h après la date prévue, le marché sera ANNULÉ et toutes les mises remboursées intégralement.',
       v_now + make_interval(days => 7 + v_idx),
       v_now + make_interval(days => 10 + v_idx),
       'OPEN',
       v_idx <= 2)
    on conflict do nothing
    returning id into v_market_id;

    -- Pool associé.
    if v_market_id is not null then
      insert into public.market_pools (market_id) values (v_market_id) on conflict do nothing;
    end if;
  end loop;

  -- --- Crédit démo : joueur 500 000 Ar, market makers 1 000 000 Ar ---
  perform public.credit_demo(v_player, 500000);
  perform public.credit_demo(v_mm1, 1000000);
  perform public.credit_demo(v_mm2, 1000000);

  -- --- Carnet vivant sur les 3 premiers marchés ---
  for v_market_id in select id from public.markets where status = 'OPEN' order by id limit 3 loop
    -- Chaque market maker minte 20 paires (coûte 100 000 Ar).
    begin perform public.mint_pair(v_mm1, v_market_id, 20); exception when others then raise notice 'mint mm1 ignoré: %', sqlerrm; end;
    begin perform public.mint_pair(v_mm2, v_market_id, 20); exception when others then raise notice 'mint mm2 ignoré: %', sqlerrm; end;
    -- Ordres YES autour de 3000 Ar (60%).
    begin perform public.place_order(v_mm1, v_market_id, 'SELL', 'YES', 'LIMIT', 10, 3000); exception when others then raise notice 'ordre ignoré: %', sqlerrm; end;
    begin perform public.place_order(v_mm2, v_market_id, 'SELL', 'YES', 'LIMIT', 10, 3200); exception when others then raise notice 'ordre ignoré: %', sqlerrm; end;
    begin perform public.place_order(v_mm2, v_market_id, 'BUY', 'YES', 'LIMIT', 10, 2800); exception when others then raise notice 'ordre ignoré: %', sqlerrm; end;
  end loop;

  raise notice '✅ Seed terminé.';
end $$;
