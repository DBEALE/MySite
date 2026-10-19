export const siteSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'theme', 'accent', 'sections'],
  properties: {
    title: { type: 'string' }, description: { type: 'string' },
    theme: { type: 'string', enum: ['light', 'dark'] },
    accent: { type: 'string', enum: ['blue', 'green', 'purple', 'orange'] },
    sections: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['heading', 'body', 'layout'],
      properties: { heading: { type: 'string' }, body: { type: 'string' }, layout: { type: 'string', enum: ['plain', 'card'] } }
    } }
  }
};
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw Error('Unexpected fields');
}
function text(value, max) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw Error('Invalid text');
}
export function validateSite(site) {
  exact(site, ['title', 'description', 'theme', 'accent', 'sections']);
  text(site.title, 120); text(site.description, 1000);
  if (!['light', 'dark'].includes(site.theme) || !['blue', 'green', 'purple', 'orange'].includes(site.accent)) throw Error('Invalid theme');
  if (!Array.isArray(site.sections) || site.sections.length > 20) throw Error('Too many sections');
  for (const section of site.sections) {
    exact(section, ['heading', 'body', 'layout']); text(section.heading, 160); text(section.body, 4000);
    if (!['plain', 'card'].includes(section.layout)) throw Error('Invalid layout');
  }
  return site;
}
export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw Error('Invalid history');
  for (const item of changes) {
    exact(item, ['id', 'date', 'summary']);
    if (!/^[a-f0-9-]{36}$/.test(item.id) || !/^\d{4}-\d{2}-\d{2}T/.test(item.date) || !Number.isFinite(Date.parse(item.date))) throw Error('Invalid history entry');
    text(item.summary, 500);
  }
  return changes;
}
export function validateDiff(files) {
  if (files.length !== 2 || files.some(f => !['content/site.json', 'content/changes.json'].includes(f.filename) || f.status !== 'modified')) throw Error('Only page data and change history may be changed');
  if (new Set(files.map(f => f.filename)).size !== 2) throw Error('Duplicate file');
}
