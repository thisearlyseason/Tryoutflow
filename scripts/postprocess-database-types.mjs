import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/infrastructure/supabase/database.types.ts', import.meta.url);
let source = await readFile(path, 'utf8');

function nullableFunctionFields(functionName, fields) {
  const start = source.indexOf(`      ${functionName}: {`);
  const end = source.indexOf('\n      };', start);
  if (start < 0 || end < 0) throw new Error(`Could not find generated function ${functionName}`);
  let block = source.slice(start, end);
  for (const [field, type] of Object.entries(fields)) {
    const pattern = new RegExp(`(${field}: )${type.replace('|', '\\|')};`);
    if (!pattern.test(block) && !block.includes(`${field}: ${type} | null;`)) {
      throw new Error(`Could not find ${functionName}.${field}: ${type}`);
    }
    block = block.replace(pattern, `$1${type} | null;`);
  }
  source = source.slice(0, start) + block + source.slice(end);
}

function nullableFunctionArgs(functionName, fields) {
  const start = source.indexOf(`      ${functionName}: {`);
  const end = source.indexOf('\n      };', start);
  if (start < 0 || end < 0) throw new Error(`Could not find generated function ${functionName}`);
  let block = source.slice(start, end);
  const argsEnd = block.indexOf('\n        Returns:');
  if (argsEnd < 0) throw new Error(`Could not find generated function args ${functionName}`);
  let args = block.slice(0, argsEnd);
  for (const [field, type] of Object.entries(fields)) {
    const pattern = new RegExp(`(${field}\\??: )${type.replace('|', '\\|')};`);
    if (
      !pattern.test(args) &&
      !args.includes(`${field}: ${type} | null;`) &&
      !args.includes(`${field}?: ${type} | null;`)
    ) {
      throw new Error(`Could not find ${functionName}.${field}: ${type}`);
    }
    args = args.replace(pattern, `$1${type} | null;`);
  }
  block = args + block.slice(argsEnd);
  source = source.slice(0, start) + block + source.slice(end);
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
nullableFunctionArgs('complete_evaluation', { p_group_id: 'string' });
nullableFunctionArgs('configure_evaluation_note_tag', { p_note_tag_id: 'string' });
nullableFunctionArgs('lock_evaluation', { p_group_id: 'string' });
nullableFunctionArgs('manage_director_evaluation_flag', {
  p_flag_id: 'string',
  p_group_id: 'string',
});
nullableFunctionArgs('reopen_evaluation', { p_group_id: 'string' });
nullableFunctionArgs('save_evaluation_draft', {
  p_group_id: 'string',
  p_note: 'string',
});

await writeFile(path, source);
