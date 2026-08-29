begin;
select plan(8);

select throws_ok(
  $$select E'{"note":"\\u0000"}'::jsonb$$,
  '22P05',
  'unsupported Unicode escape sequence',
  'PostgreSQL rejects an escaped NUL before evaluation synchronization'
);
select throws_ok(
  $$select E'{"note":"\\ud800"}'::jsonb$$,
  '22P02',
  'invalid input syntax for type json',
  'PostgreSQL rejects a lone high surrogate before evaluation synchronization'
);
select throws_ok(
  $$select E'{"note":"\\udc00"}'::jsonb$$,
  '22P02',
  'invalid input syntax for type json',
  'PostgreSQL rejects a lone low surrogate before evaluation synchronization'
);
select is(
  ('{"note":"valid 😀 emoji"}'::jsonb)->>'note',
  'valid 😀 emoji',
  'PostgreSQL accepts a valid supplementary Unicode pair'
);
select is(
  ('{"note":"é"}'::jsonb)->>'note',
  'é',
  'PostgreSQL preserves NFC strings'
);
select is(
  ('{"note":"é"}'::jsonb)->>'note',
  'é',
  'PostgreSQL preserves NFD strings'
);
select is(
  encode(extensions.digest(private.canonical_evaluation_json(
    '{"b":[{"x":"é"},2],"a":{"z":"😀","a":"é"}}'::jsonb
  ),'sha256'),'hex'),
  '5ab4d537db8177b589093223d55322a499b02e56a0d797cea7f2485bcba47163',
  'nested PostgreSQL canonical digest matches the browser literal'
);
select is(
  (select count(*) from public.evaluation_mutations),
  0::bigint,
  'parser-rejected strings create no evaluation mutation receipt'
);

select * from finish();
rollback;
