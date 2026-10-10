import {mkdir, readFile, writeFile, appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer-core';

// Run from the worktree: node src/one_offs/benchmark-load.mjs EXTENSION|none LABEL PORT URL...
// CHROME_BIN picks the browser; Chrome for Testing is needed because branded Chrome ignores --load-extension.
// Output includes all-page long tasks; extMs counts samples with an extension ancestor.
const [extension, label, port, ...urls] = process.argv.slice(2);
const colorScheme = process.env.BENCH_COLOR_SCHEME || 'light';
if (!['light', 'dark'].includes(colorScheme)) throw new Error('BENCH_COLOR_SCHEME must be light or dark');
if (!/^941[0-9]$/.test(port) || !/^[a-z0-9-]+$/.test(label || '') || urls.length === 0) throw new Error('Provide extension, label, port 9410-9419 and URLs');
const extensionSHA1 = extension === 'none' ? null : createHash('sha1').update(await readFile(resolve(extension, 'inject/index.js'))).digest('hex');
const root = resolve('build/bench');
const profile = `${root}/profile-${label}-${Date.now()}`;
await mkdir(profile, {recursive: true});
const endpoint = `http://127.0.0.1:${port}`;
try {
    await fetch(`${endpoint}/json/version`);
    throw new Error(`Port ${port} is already occupied`);
} catch (error) {
    if (error.message.includes('occupied')) throw error;
}
const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,900'];
if (extension !== 'none') args.push(`--disable-extensions-except=${resolve(extension)}`, `--load-extension=${resolve(extension)}`);
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const launched = spawn(chrome, args, {stdio: ['ignore', 'ignore', 'pipe']});
let launchErrors = '';
launched.stderr.on('data', (data) => launchErrors = (launchErrors + data).slice(-2000));
launched.on('error', (error) => launchErrors += error.message);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
for (let i = 0; i < 150; i++) {
    try { browser = await puppeteer.connect({browserURL: endpoint, defaultViewport: {width: 1280, height: 900}}); break; } catch { await sleep(200); }
}
if (!browser) {
    launched.kill();
    throw new Error(`Chrome did not start: ${launchErrors}`);
}
function summarize(profile, longTasks, navigationStart) {
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const parents = new Map(profile.nodes.flatMap((n) => (n.children || []).map((id) => [id, n.id])));
    const memo = new Map();
    function inExtension(id) {
        if (!memo.has(id)) memo.set(id, nodes.get(id).callFrame.url.startsWith('chrome-extension://') || (parents.has(id) && inExtension(parents.get(id))));
        return memo.get(id);
    }
    const top = {};
    let total = 0;
    let sampleTime = profile.startTime / 1000 - navigationStart * 1000;
    const taskExtensionMs = longTasks.map(() => 0);
    profile.samples.forEach((id, i) => {
        const dt = profile.timeDeltas[i] / 1000;
        sampleTime += dt;
        if (!inExtension(id)) return;
        total += dt;
        const task = longTasks.findIndex((task) => sampleTime >= task.start && sampleTime < task.start + task.duration);
        if (task >= 0) taskExtensionMs[task] += dt;
        const frame = nodes.get(id).callFrame;
        const name = `${frame.functionName || '(anonymous)'}:${frame.lineNumber + 1}`;
        top[name] = (top[name] || 0) + dt;
    });
    return {extMs: Math.round(total), taskExtensionMs: taskExtensionMs.map(Math.round), top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, Math.round(v)])};
}
try {
    const home = await browser.newPage();
    await home.emulateMediaFeatures([{name: 'prefers-color-scheme', value: 'light'}]);
    await home.goto('https://example.com');
    await sleep(3000);
    if (extension !== 'none') {
        await home.waitForFunction(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic', {timeout: 45000});
    }
    if (label.includes('filter')) {
        const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
        const workerTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith(`/${manifest.background.service_worker}`));
        const popup = await browser.newPage();
        await popup.goto(`chrome-extension://${new URL(workerTarget.url()).host}/ui/popup/index.html`);
        await popup.evaluate(() => chrome.runtime.sendMessage({type: 'ui-bg-set-theme', data: {engine: 'cssFilter'}}));
        await sleep(1000);
        await popup.close();
    }
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const page = await browser.newPage();
        await page.emulateMediaFeatures([{name: 'prefers-color-scheme', value: colorScheme}]);
        try { await page.goto(`${new URL(url).origin}/robots.txt`, {timeout: 30000}); } catch {}
        await page.evaluateOnNewDocument(() => {
            window.__bench = {longTasks: [], fallback: [], styles: []};
            new PerformanceObserver((list) => window.__bench.longTasks.push(...list.getEntries().map((e) => ({start: e.startTime, duration: e.duration})))).observe({type: 'longtask', buffered: true});
            const timer = setInterval(() => {
                const state = Boolean(document.querySelector('.darkreader--fallback')?.textContent);
                if (window.__bench.fallback.at(-1)?.state !== state) window.__bench.fallback.push({time: performance.now(), state});
                const sheets = [...document.querySelectorAll('style.darkreader--sync')];
                const rules = sheets.reduce((sum, sheet) => sum + (sheet.sheet?.cssRules.length || 0), 0);
                if (window.__bench.styles.at(-1)?.rules !== rules) window.__bench.styles.push({time: performance.now(), count: sheets.length, rules});
                if (performance.now() > 20000) clearInterval(timer);
            }, 25);
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)));
        const cdp = await page.createCDPSession();
        await cdp.send('Performance.enable');
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', {interval: 250});
        const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
        await cdp.send('Profiler.start');
        let status;
        try { status = (await page.goto(url, {waitUntil: 'load', timeout: 45000})).status(); } catch (e) { errors.push(e.message); }
        await sleep(6000);
        const prof = (await cdp.send('Profiler.stop')).profile;
        const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
        const state = await page.evaluate(() => ({...window.__bench, title: document.title, mode: document.documentElement.getAttribute('data-darkreader-mode'), elements: document.querySelectorAll('*').length, sheets: document.styleSheets.length, overrides: [...document.querySelectorAll('style.darkreader--sync')].map((s) => s.sheet?.cssRules.length || 0)}));
        const row = {label, browser: await browser.version(), headless: true, colorScheme, extensionSHA1, url, finalURL: page.url(), status, ...summarize(prof, state.longTasks, after.NavigationStart), ...Object.fromEntries(['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'].map((k) => [k, Math.round((after[k] - before[k]) * 1000)])), ...state, errors};
        await writeFile(`${root}/${label}-${i}.cpuprofile`, JSON.stringify(prof));
        await page.screenshot({path: `${root}/${label}-${i}.png`});
        await appendFile(`${root}/${label}.jsonl`, `${JSON.stringify(row)}\n`);
        console.log(JSON.stringify(row));
        await page.close();
    }
} finally {
    await browser.close();
}
for (let i = 0; i < 50; i++) {
    try { await fetch(`${endpoint}/json/version`); } catch { process.exit(0); }
    await sleep(200);
}
throw new Error('Owned browser is still listening');
