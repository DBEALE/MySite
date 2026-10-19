import { readFile } from 'node:fs/promises';
import { validateSite, validateChanges } from '../lib/policy.mjs';
validateSite(JSON.parse(await readFile(new URL('../content/site.json', import.meta.url))));
validateChanges(JSON.parse(await readFile(new URL('../content/changes.json', import.meta.url))));
console.log('Page schema and release history validated');
