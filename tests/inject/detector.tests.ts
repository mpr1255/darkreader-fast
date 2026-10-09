import './support/polyfills';
import {runDarkThemeDetector, stopDarkThemeDetector} from '../../src/inject/detector';
import {emulateColorScheme} from '../../src/utils/media-query';
import {multiline} from './support/test-utils';

let hidden = false;
let scheme: 'light' | 'dark' = 'light';

beforeEach(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
    // A light result is remembered until the colour scheme changes.
    scheme = scheme === 'light' ? 'dark' : 'light';
    emulateColorScheme(scheme);
});

afterEach(() => {
    stopDarkThemeDetector();
    delete (document as any).hidden;
    hidden = false;
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
});
