import './support/polyfills';
import {runDarkThemeDetector, stopDarkThemeDetector} from '../../src/inject/detector';
import {multiline} from './support/test-utils';

let hidden = false;

beforeEach(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
});

afterEach(() => {
    stopDarkThemeDetector();
    delete (document as any).hidden;
    hidden = false;
    document.body.innerHTML = '';
});

describe('DARK THEME DETECTOR', () => {
    // One spec, because a light result is remembered for the rest of the page.
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
        hidden = true;
        runDarkThemeDetector((hasDarkTheme) => results.push(hasDarkTheme), []);
        expect(results).toEqual([]);

        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        expect(results).toEqual([false]);
    });
});
