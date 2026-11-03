import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const specifications = {
  apple: { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000 },
  'google-play': { title: 30, shortDescription: 80, fullDescription: 4000 },
};
for (const [platform, fields] of Object.entries(specifications)) {
  const data = JSON.parse(
    await readFile(
      new URL(`../docs/discovery-20261103/${platform}-en-US.json`, import.meta.url),
      'utf8',
    ),
  );
  for (const [field, limit] of Object.entries(fields)) {
    const count =
      field === 'keywords' ? Buffer.byteLength(data[field], 'utf8') : [...data[field]].length;
    assert.ok(count > 0 && count <= limit, `${platform}.${field}: ${count}/${limit}`);
    console.log(
      `${platform}.${field}: ${count}/${limit} ${field === 'keywords' ? 'UTF-8 bytes' : 'characters'}`,
    );
  }
  if (platform === 'apple') assert.ok(data.keywords.split(',').every((x) => x.length > 2));
}
