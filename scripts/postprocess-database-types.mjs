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

await writeFile(path, source);
