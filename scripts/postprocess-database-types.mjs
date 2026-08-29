import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const path = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL('../src/infrastructure/supabase/database.types.ts', import.meta.url);
let source = await readFile(path, 'utf8');

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function functionSections(functionName) {
  const start = source.indexOf(`      ${functionName}: {`);
  const end = source.indexOf('\n      };', start);
  if (start < 0 || end < 0) throw new Error(`Could not find generated function ${functionName}`);
  const returns = source.indexOf('Returns:', start);
  if (returns < 0 || returns >= end) {
    throw new Error(`Could not find generated function returns ${functionName}`);
  }
  return { start, returns, end };
}

function makeNullable(section, functionName, fields, allowOptional = false) {
  let result = section;
  for (const [field, type] of Object.entries(fields)) {
    const optional = allowOptional ? '(\\??)' : '';
    const prefix = new RegExp(
      `(^|[\\s{;])(${escaped(field)}${optional}: )${escaped(type)}(?=;|[\\s}])`,
      'm',
    );
    const nullable = new RegExp(
      `(^|[\\s{;])${escaped(field)}${allowOptional ? '\\??' : ''}: ${escaped(type)} \\| null(?=;|[\\s}])`,
      'm',
    );
    if (!prefix.test(result) && !nullable.test(result)) {
      throw new Error(`Could not find ${functionName}.${field}: ${type}`);
    }
    result = result.replace(prefix, `$1$2${type} | null`);
  }
  return result;
}

function nullableFunctionFields(functionName, fields) {
  const { returns, end } = functionSections(functionName);
  const section = makeNullable(source.slice(returns, end), functionName, fields);
  source = source.slice(0, returns) + section + source.slice(end);
}

function nullableFunctionArgs(functionName, fields) {
  const { start, returns } = functionSections(functionName);
  const section = makeNullable(source.slice(start, returns), functionName, fields, true);
  source = source.slice(0, start) + section + source.slice(returns);
}

nullableFunctionFields('list_assigned_athletes', {
  group_id: 'string',
  group_name: 'string',
  session_id: 'string',
  session_name: 'string',
  tryout_number: 'number',
});
nullableFunctionFields('list_manageable_evaluator_assignments', {
  division_id: 'string',
  expires_at: 'string',
  group_id: 'string',
  session_id: 'string',
});
nullableFunctionFields('complete_evaluation', { version: 'number' });
nullableFunctionFields('configure_evaluation_note_tag', { note_tag_id: 'string' });
nullableFunctionFields('lock_evaluation', { version: 'number' });
nullableFunctionFields('manage_director_evaluation_flag', { athlete_flag_id: 'string' });
nullableFunctionFields('reopen_evaluation', { version: 'number' });
nullableFunctionFields('save_evaluation_draft', {
  evaluation_id: 'string',
  version: 'number',
});
nullableFunctionArgs('complete_evaluation', {
  p_expected_version: 'number',
  p_group_id: 'string',
});
nullableFunctionArgs('configure_evaluation_note_tag', { p_note_tag_id: 'string' });
nullableFunctionArgs('lock_evaluation', {
  p_expected_version: 'number',
  p_group_id: 'string',
});
nullableFunctionArgs('manage_director_evaluation_flag', {
  p_flag_id: 'string',
  p_group_id: 'string',
});
nullableFunctionArgs('reopen_evaluation', {
  p_expected_version: 'number',
  p_group_id: 'string',
});
nullableFunctionArgs('save_evaluation_draft', {
  p_expected_version: 'number',
  p_group_id: 'string',
  p_note: 'string',
});

await writeFile(path, source);
