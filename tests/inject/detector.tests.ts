import './support/polyfills';
import {runDarkThemeDetector, stopDarkThemeDetector} from '../../src/inject/detector';
import {emulateColorScheme} from '../../src/utils/media-query';
import {multiline} from './support/test-utils';

let hidden = false;
let readyState: DocumentReadyState = 'complete';
let scheme: 'light' | 'dark' = 'light';

beforeEach(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
    Object.defineProperty(document, 'readyState', {configurable: true, get: () => readyState});
    // A light result is remembered until the colour scheme changes.
    scheme = scheme === 'light' ? 'dark' : 'light';
    emulateColorScheme(scheme);
});

afterEach(() => {
    stopDarkThemeDetector();
    delete (document as any).hidden;
    delete (document as any).readyState;
    hidden = false;
    readyState = 'complete';
    document.body.innerHTML = '';
});

describe('DARK THEME DETECTOR', () => {
    it('should decide from markup in a hidden tab but sample styles only once it is shown', () => {
        const fromMarkup: boolean[] = [];
        document.body.innerHTML = '<meta name="color-scheme" content="dark"><p style="height: 100px">Dark page</p>';
        hidden = true;
        runDarkThemeDetector((hasDarkTheme) => fromMarkup.push(hasDarkTheme), []);
        expect(fromMarkup).toEqual([true]);

        document.body.innerHTML = multiline(
            '<style>body { background: white; color: black; min-height: 100px; }</style>',
            '<style class="darkreader">html, body, p { background: black !important; color: white !important; }</style>',
            '<p>Light page under a dark override</p>',
        );
        const results: boolean[] = [];
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([]);

        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        expect(results).toEqual([false]);
    });

    it('should read the page colours when the page transitions every property', () => {
        document.body.innerHTML = multiline(
            '<style>html, body { background: white; color: black; } body { min-height: 100px; }</style>',
            '<style class="darkreader">html, body, p { background: black !important; color: white !important; }</style>',
            '<p>Light page under a dark override</p>',
        );
        expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(0, 0, 0)');
        document.body.insertAdjacentHTML('afterbegin', '<style>* { transition: 10s; }</style>');
        const results: boolean[] = [];
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([false]);
        expect(getComputedStyle(document.body).backgroundColor).toBe('rgb(0, 0, 0)');
    });

    it('should wait until the page has loaded', () => {
        document.body.innerHTML = multiline(
            '<style>body { min-height: 100px; }</style>',
            '<p>Dark page whose style sheet is loading</p>',
        );
        readyState = 'interactive';
        const results: boolean[] = [];
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([]);

        document.body.insertAdjacentHTML('beforeend', '<style>html, body { background: black; color: white; }</style>');
        readyState = 'complete';
        document.dispatchEvent(new Event('readystatechange'));
        expect(results).toEqual([true]);
    });

    it('should not take a vivid button for a light page', () => {
        document.body.innerHTML = multiline(
            '<style>',
            '    html, body { background: #111; color: #eee; margin: 0; }',
            '    body { min-height: 100vh; }',
            '    button { display: block; width: 100vw; height: 50vh; border: 0; background: rgb(233, 207, 30); color: #1a1708; }',
            '</style>',
            '<button>Try it</button>',
        );
        const results: boolean[] = [];
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([true]);
    });

    it('should read the body text colour when the page paints its background on a wrapper', () => {
        document.body.innerHTML = multiline(
            '<style>',
            '    html, body { background: transparent; margin: 0; }',
            '    body { color: #e5e5e5; }',
            '    main { min-height: 100vh; background: #1b2c36; }',
            '</style>',
            '<main><p>Light text on a dark wrapper</p></main>',
        );
        const results: boolean[] = [];
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([true]);
    });
});
