-- ===========================================================================
--  Nexus v2 — Helper credit_demo (utilisé par le seed 0008)
--
--  Crédite un wallet de démo en simulant un dépôt approuvé. DEV UNIQUEMENT.
-- ===========================================================================
create or replace function public.credit_demo(
  p_user_id uuid,
  p_amount  numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id bigint;
  v_deposit_id bigint;
begin
  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  insert into public.deposit_requests
    (code, user_id, amount, operator, sender_phone, status)
  values
    (public.gen_payment_code('DEP'), p_user_id, p_amount, 'MVOLA',
     (select phone from public.profiles where id = p_user_id), 'PENDING')
  returning id into v_deposit_id;
  perform public.approve_deposit(v_deposit_id, p_user_id, 'Seed démo');
end;
$$;
