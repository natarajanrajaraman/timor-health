'use strict';
/**
 * setup-form.js - create the public suggestions form, once.
 *
 * WHY A SCRIPT: the form is part of the document's correction mechanism (decision F, 2026-08-25):
 * no login for submitters, nothing lands in the editor's inbox, and the quarterly refresh reads the
 * responses via the API. The exact questions matter - the page promises that contact details are
 * never published and that removal requests are honoured, so the form must collect contact
 * SEPARATELY from the publishable fields, and must offer removal explicitly.
 *
 * PREREQUISITE: the Google Forms API must be enabled on the gog OAuth project (a one-click,
 * human-only step in the Cloud console). Until then every call below 403s.
 *
 * Usage:  node scripts/setup-form.js            (refuses if a form is already configured)
 *         node scripts/setup-form.js --force    (create another anyway)
 *
 * After it prints the form URL it writes corrections.formUrl into content/_meta.json and rebuilds,
 * so the page's CTA goes live in the same run. Publishing is still publish.js's job.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const META = path.join(ROOT, 'content', '_meta.json');
const ACCOUNT = 'natarajan.rajaraman@gmail.com';

function gog(args) {
  return execFileSync('gog', args.concat(['-a', ACCOUNT, '--no-input']), { encoding: 'utf8' });
}
function gogJson(args) {
  return JSON.parse(gog(args.concat(['-j', '--results-only'])));
}

function main() {
  const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
  if (meta.corrections && meta.corrections.formUrl && !process.argv.includes('--force')) {
    console.error('A form is already configured: ' + meta.corrections.formUrl);
    console.error('Refusing to create a second one. Pass --force if you really mean to.');
    process.exit(2);
  }

  console.log('creating form...');
  const created = gogJson(['forms', 'create',
    '--title', 'Start Here - Health in Timor-Leste: suggestions and corrections']);
  const formId = created.formId || (created.form && created.form.formId);
  if (!formId) throw new Error('no formId in response: ' + JSON.stringify(created).slice(0, 300));
  console.log('  formId: ' + formId);

  gog(['forms', 'update', formId, '--description',
    'For the public guide at https://natarajanrajaraman.github.io/timor-health/ . ' +
    'What happens to your submission: suggestions are PUBLISHED on the page with a status ' +
    '(new / verified / incorporated / disputed), with your name and organisation if you give them. ' +
    'Your contact email is NEVER published - it is only used if we need to ask you something. ' +
    'If you ask to be removed from the directory, that is honoured permanently. ' +
    'Nothing is rejected for disagreeing with the document.']);

  const Q = (args) => gog(['forms', 'add-question', formId].concat(args));

  // Order matters: the substantive field first, identity last, contact very last -
  // the same order the page's own promise is written in.
  Q(['--title', 'Your suggestion, correction, or addition', '--type', 'paragraph', '--required']);

  Q(['--title', 'Which part of the document does it concern?', '--type', 'dropdown',
     '-o', 'The whole document',
     '-o', 'S1 Executive summary', '-o', 'S2 Country context', '-o', 'S3 Health status',
     '-o', 'S4 Organization and governance', '-o', 'S5 Financing',
     '-o', 'S6 Workforce and education', '-o', 'S7 Service delivery and programmes',
     '-o', 'S8 Who is doing what (the directory)', '-o', 'S8b National guidelines and documents',
     '-o', 'S10 Sources and method', '-o', 'Somewhere else / not sure']);

  Q(['--title', 'A source or link that supports it (if any)', '--type', 'text']);

  Q(['--title', 'Is this a request about your own organisation’s directory entry?', '--type', 'radio',
     '-o', 'No',
     '-o', 'Yes - please CORRECT our entry (say what is wrong above)',
     '-o', 'Yes - please REMOVE our entry entirely',
     '-o', 'Yes - keep the entry but remove the contact details']);

  Q(['--title', 'Your name, as you would like it shown if published (leave blank to stay anonymous)',
     '--type', 'text']);
  Q(['--title', 'Organisation (optional - shown if given)', '--type', 'text']);
  Q(['--title', 'Contact email - NEVER published; only used if we need to follow up', '--type', 'text']);

  const info = gogJson(['forms', 'get', formId]);
  const url = info.responderUri || (info.form && info.form.responderUri);
  if (!url) throw new Error('no responderUri: ' + JSON.stringify(info).slice(0, 300));

  meta.corrections.formUrl = url;
  meta.corrections.formId = formId;
  meta.corrections.$comment = 'Created by scripts/setup-form.js. Responses are read via ' +
    '"gog forms responses list ' + formId + '" - nothing reaches the editor’s inbox. ' +
    'The quarterly refresh reads them as an input.';
  fs.writeFileSync(META, JSON.stringify(meta, null, 2));
  console.log('\nform URL: ' + url);
  console.log('written to content/_meta.json; rebuilding...');
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
  console.log('\nDone. Review the form in the editor, then run: node scripts/publish.js --apply');
}

main();
