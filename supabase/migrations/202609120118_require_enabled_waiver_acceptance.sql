-- Enabled consent always requires explicit acceptance, including saved schemas
-- whose required flag is false. Hidden fields retain their existing semantics.
-- No saved form schemas, waiver text or accepted registration responses change.
-- Historical optional-consent retries without acceptance fail current validation;
-- accepted true responses retain their existing idempotent replay behavior.

create or replace function private.normalize_registration_responses(
  p_schema jsonb,
  p_responses jsonb
) returns jsonb
language plpgsql immutable set search_path=''
as $$
declare
  normalized jsonb:=p_responses;
  field jsonb;
  current_field_key text;
  field_kind text;
  answer jsonb;
  answer_text text;
begin
  if jsonb_typeof(p_schema)<>'object'
    or jsonb_typeof(p_schema->'fields')<>'array'
    or jsonb_array_length(p_schema->'fields')>100
    or jsonb_typeof(p_responses)<>'object'
    or octet_length(p_responses::text)>32768
  then
    raise invalid_parameter_value using message='invalid registration responses';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_schema->'fields') item
    where jsonb_typeof(item)<>'object'
      or coalesce(item->>'key','')!~'^[a-z][a-z0-9_]{0,62}$'
  ) or exists(
    select candidate.field_key
    from (
      select item->>'key' as field_key
      from jsonb_array_elements(p_schema->'fields') item
    ) candidate
    group by candidate.field_key having count(*)<>1
  ) then
    raise invalid_parameter_value using message='invalid registration form fields';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_responses) response_key
    where not exists(
      select 1 from jsonb_array_elements(p_schema->'fields') item
      where item->>'key'=response_key
    )
  ) then
    raise invalid_parameter_value using message='unknown registration response';
  end if;

  for field in select value from jsonb_array_elements(p_schema->'fields') loop
    current_field_key:=field->>'key';
    field_kind:=field->>'kind';
    answer:=p_responses->current_field_key;
    if field_kind not in('text','email','phone','date','select','checkbox','textarea','consent')
      or jsonb_typeof(field->'required')<>'boolean'
    then
      raise invalid_parameter_value using message='invalid registration response kind';
    end if;
    if field_kind='select' and (
      jsonb_typeof(field->'options')<>'array'
      or jsonb_array_length(field->'options') not between 1 and 100
      or exists(
        select option_text from jsonb_array_elements_text(field->'options') option_text
        group by option_text having count(*)<>1
      )
    ) then
      raise invalid_parameter_value using message='invalid registration select options';
    end if;
    if field->'enabled'='false'::jsonb then
      if answer is not null and answer<>'null'::jsonb
        and not (jsonb_typeof(answer)='string' and public.canonical_registration_text(answer#>>'{}')='')
      then raise invalid_parameter_value using message='hidden registration response supplied'; end if;
      normalized:=normalized-current_field_key;
      continue;
    end if;
    if ((field->>'required')::boolean or field_kind='consent') and (
      answer is null
      or answer='null'::jsonb
      or (
        jsonb_typeof(answer)='string'
        and public.canonical_registration_text(answer#>>'{}')=''
      )
    ) then
      raise invalid_parameter_value using message='required registration response missing';
    end if;
    if answer is null or answer='null'::jsonb then continue; end if;

    if field_kind in('checkbox','consent') then
      if jsonb_typeof(answer)<>'boolean'
        or (
          field_kind='consent'
          and answer<>'true'::jsonb
        )
      then
        raise invalid_parameter_value using message='invalid registration response';
      end if;
      continue;
    end if;
    if jsonb_typeof(answer)<>'string' then
      raise invalid_parameter_value using message='invalid registration response';
    end if;
    answer_text:=answer#>>'{}';
    if field_kind in('text','textarea','email','phone') then
      answer_text:=public.canonical_registration_text(answer_text);
      normalized:=jsonb_set(normalized,array[current_field_key],to_jsonb(answer_text));
    end if;
    case field_kind
      when 'text' then
        if char_length(answer_text)>500 then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'textarea' then
        if char_length(answer_text)>5000 then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'email' then
        if not public.is_valid_registration_email(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'phone' then
        if not public.is_valid_registration_phone(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'date' then
        if not public.is_valid_registration_calendar_date(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'select' then
        if not ((field->'options')?answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      else
        raise invalid_parameter_value using message='invalid registration response kind';
    end case;
  end loop;
  return normalized;
end;
$$;

-- CREATE OR REPLACE retains the existing ACL; restate the private boundary.
revoke all on function private.normalize_registration_responses(jsonb,jsonb)
from public,anon,authenticated,service_role;
