-- ===========================================================================
--  FIX v_markets : proba_yes/no calculées depuis les pools (pari mutuel)
--
--  Avant : proba_yes/no venaient du last_price (modèle Polymarket) → toujours
--  0.5000/0.5000 car plus de trades.
--
--  Maintenant : proba = pool_côté / (pool_yes + pool_no). Reflète directement
--  la répartition des mises des joueurs en temps réel.
--  last_price reste pour compat (toujours NULL en pari mutuel).
-- ===========================================================================

create or replace view public.v_markets as
select
  m.id, m.question, m.description, m.category,
  public.category_label(m.category) as category_label,
  m.source_url, m.source_rules, m.status, m.outcome,
  m.bet_close_at, m.resolve_at, m.resolved_at, m.image_url, m.is_featured,
  m.created_at,
  m.pool_yes, m.pool_no,
  -- Probas = répartition des mises (pari mutuel).
  case when (m.pool_yes + m.pool_no) > 0
    then to_char(m.pool_yes / (m.pool_yes + m.pool_no), 'FM0.0000')
    else '0.5000' end as proba_yes,
  case when (m.pool_yes + m.pool_no) > 0
    then to_char(m.pool_no / (m.pool_yes + m.pool_no), 'FM0.0000')
    else '0.5000' end as proba_no,
  -- last_price : NULL en pari mutuel (plus de prix de trade).
  null::varchar as last_price
from public.markets m;
