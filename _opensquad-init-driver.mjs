import { pathToFileURL } from 'node:url';

const initUrl = pathToFileURL(
  'C:/Users/Desktop/AppData/Local/npm-cache/_npx/65fade7ffa1ea354/node_modules/opensquad/src/init.js'
).href;

const { init } = await import(initUrl);

await init(process.cwd(), {
  _skipPrompts: true,
  _language: 'Português (Brasil)',
  _ides: ['claude-code', 'antigravity'],
});
