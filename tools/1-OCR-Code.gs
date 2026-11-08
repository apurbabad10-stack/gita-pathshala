/**
 * গীতা পাঠশালা — Bengali OCR for the book page images (Google Apps Script)
 *
 * What it does: reads every page image (p0001a.jpg … p0521b.jpg) in one Google Drive
 * folder, runs Google's Bengali text recognition on each, and joins the text in page
 * order into one file: gita-ocr.txt (in the same folder).
 * It works in batches of ~5 minutes and restarts itself until all pages are done.
 *
 * Setup (once):
 *  1. In Google Drive make a folder named exactly:  Gita Pages
 *     Upload the 8 files gita-zip-1.zip … gita-zip-8.zip into it (do NOT unzip them).
 *     The script unzips them inside Drive by itself.
 *  2. script.google.com → New project → paste this file.
 *  3. Left sidebar: Services (+) → "Drive API" → Version v3 → Add.
 *  4. Choose function "start" and press Run. Approve the permissions.
 *  5. Wait. Check progress with "status" (View → Logs). Takes roughly 1–2 hours.
 *     When finished, gita-ocr.txt appears in the folder.
 */

const FOLDER_NAME = 'Gita Pages';
const OUT_NAME = 'gita-ocr.txt';
const PART_PREFIX = 'ocr_part_';
const TIME_BUDGET_MS = 4.8 * 60 * 1000;

function start() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('next', '0');
  props.setProperty('part', '0');
  props.deleteProperty('unzipped');
  removeTriggers_();
  runOcr();
}

function runOcr() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const folder = getFolder_();

  // Step A: unzip any uploaded gita-zip-*.zip inside Drive (resumes across runs)
  const doneZips = JSON.parse(props.getProperty('unzipped') || '[]');
  const zips = [];
  const zit = folder.getFiles();
  while (zit.hasNext()) { const z = zit.next(); if (/^gita-zip-\d+\.zip$/i.test(z.getName()) && doneZips.indexOf(z.getName()) < 0) zips.push(z); }
  zips.sort((a, b) => a.getName().localeCompare(b.getName(), undefined, { numeric: true }));
  const have = {};
  listImages_(folder).forEach(f => have[f.getName()] = true);
  for (const z of zips) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;
    const blob = z.getBlob(); blob.setContentType('application/zip');
    const parts = Utilities.unzip(blob);
    let allDone = true;
    for (const b of parts) {
      if (have[b.getName()]) continue;
      if (Date.now() - t0 > TIME_BUDGET_MS) { allDone = false; break; }
      folder.createFile(b.setContentType('image/jpeg'));
      have[b.getName()] = true;
    }
    if (!allDone) break;
    doneZips.push(z.getName());
    props.setProperty('unzipped', JSON.stringify(doneZips));
    Logger.log('Unzipped ' + z.getName());
  }
  const pendingZips = zips.filter(z => doneZips.indexOf(z.getName()) < 0);
  if (pendingZips.length) {
    removeTriggers_();
    ScriptApp.newTrigger('runOcr').timeBased().after(60 * 1000).create();
    Logger.log('Still unzipping (' + pendingZips.length + ' zip files left). Continuing automatically in 1 minute.');
    return;
  }

  // Step B: OCR every page image
  const files = listImages_(folder);
  let next = Number(props.getProperty('next') || 0);
  let part = Number(props.getProperty('part') || 0);
  let buf = [];

  while (next < files.length && Date.now() - t0 < TIME_BUDGET_MS) {
    const f = files[next];
    let text = '';
    try {
      text = ocrOne_(f);
    } catch (e) {
      Utilities.sleep(3000);
      try { text = ocrOne_(f); } catch (e2) { text = '[[OCR FAILED: ' + e2 + ']]'; }
    }
    buf.push('=== ' + f.getName().replace(/\.jpe?g$/i, '') + ' ===\n' + text.trim() + '\n');
    next++;
  }

  if (buf.length) {
    folder.createFile(PART_PREFIX + String(part).padStart(4, '0') + '.txt', buf.join('\n'), MimeType.PLAIN_TEXT);
    part++;
  }
  props.setProperty('next', String(next));
  props.setProperty('part', String(part));

  removeTriggers_();
  if (next < files.length) {
    ScriptApp.newTrigger('runOcr').timeBased().after(60 * 1000).create();
    Logger.log('Done ' + next + ' of ' + files.length + ' pages. Continuing automatically in 1 minute.');
  } else {
    combine_();
    Logger.log('All ' + files.length + ' pages finished. Open ' + OUT_NAME + ' in the folder.');
  }
}

function status() {
  const props = PropertiesService.getScriptProperties();
  const total = listImages_(getFolder_()).length;
  const z = JSON.parse(props.getProperty('unzipped') || '[]').length;
  Logger.log('Zip files unzipped: ' + z + ' · Page images in folder: ' + total + ' / 1042 · OCR done: ' + (props.getProperty('next') || 0) + ' pages');
}

function ocrOne_(file) {
  const doc = Drive.Files.create(
    { name: 'tmp-' + file.getName(), mimeType: MimeType.GOOGLE_DOCS },
    file.getBlob(),
    { ocrLanguage: 'bn' }
  );
  const text = DocumentApp.openById(doc.id).getBody().getText();
  Drive.Files.remove(doc.id);
  return text;
}

function combine_() {
  const folder = getFolder_();
  const parts = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(PART_PREFIX) === 0) parts.push(f);
  }
  parts.sort((a, b) => a.getName().localeCompare(b.getName()));
  const all = parts.map(p => p.getBlob().getDataAsString('UTF-8')).join('\n');
  const old = folder.getFilesByName(OUT_NAME);
  while (old.hasNext()) old.next().setTrashed(true);
  folder.createFile(OUT_NAME, all, MimeType.PLAIN_TEXT);
  parts.forEach(p => p.setTrashed(true));
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!it.hasNext()) throw new Error('Drive folder "' + FOLDER_NAME + '" not found.');
  return it.next();
}

function listImages_(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^p\d{4}[ab]\.jpe?g$/i.test(f.getName())) out.push(f);
  }
  out.sort((a, b) => a.getName().localeCompare(b.getName()));
  return out;
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runOcr')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
