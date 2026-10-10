import karma from 'karma';

// Uses only the owned test port; never attaches to another browser.
const port = 9419;
try {
    await fetch(`http://127.0.0.1:${port}/json/version`);
    throw new Error(`Port ${port} is occupied`);
} catch (error) {
    if (error.message.includes('occupied')) throw error;
}
const config = await karma.config.parseConfig(`${process.cwd()}/tests/inject/karma.conf.cjs`, {
    browsers: ['OwnedChrome'], port: 9881, singleRun: true,
    customLaunchers: {
        OwnedChrome: {base: 'ChromeHeadless', flags: [`--remote-debugging-port=${port}`]},
    },
}, {promiseConfig: true, throwErrors: true});
// Karma owns the temporary profile and closes only the browser it launches.
process.env.CHROME_BIN ||= '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await new karma.Server(config, (code) => process.exit(code)).start();
