import {m} from 'malevic';
import {sync} from 'malevic/dom';

import type {DevToolsData, ExtensionData} from '../../definitions';
import Connector from '../connect/connector';

import Body from './components/body';

declare const __CHROMIUM_MV3__: boolean;

function renderBody(data: ExtensionData, devToolsData: DevToolsData, actions: Connector) {
    sync(document.body, <Body data={data} devtools={devToolsData} actions={actions} />);
}

async function start(): Promise<void> {
    const connector = new Connector();
    window.addEventListener('unload', () => connector.disconnect(), {passive: true});

    let [data, devToolsData] = await Promise.all([
        connector.getData(),
        connector.getDevToolsData(),
    ]);
    renderBody(data, devToolsData, connector);
    connector.subscribeToChanges(async (data_) => {
        data = data_;
        devToolsData = await connector.getDevToolsData();
        renderBody(data, devToolsData, connector);
    });
}

start();

declare const __TEST__: boolean;
if (__TEST__) {
    const socket = new WebSocket(`ws://localhost:8894`);
    socket.onopen = async () => {
        socket.send(JSON.stringify({
            data: {
                type: 'devtools',
                uuid: `ready-${document.location.pathname}`,
            },
            id: null,
        }));
    };
    socket.onmessage = (e) => {
        const respond = (message: {id: number; data?: string | boolean; error?: string}) => socket.send(JSON.stringify(message));
        const message: {type: string; id: number; data: string} = JSON.parse(e.data);
        const {type, id, data} = message;
        try {
            // The page may still be rendering, so poll for an element before giving up.
            const whenFound = (selector: string, found: (element: HTMLElement) => void) => {
                let attempts = 8;
                const check = () => {
                    const element: HTMLElement | null = document.querySelector(selector);
                    if (element) {
                        found(element);
                    } else if (attempts === 0) {
                        respond({id, data: false});
                    } else {
                        attempts--;
                        setTimeout(check, 250);
                    }
                };
                check();
            };
            switch (type) {
                case 'devtools-click':
                    whenFound(data, (element) => {
                        element.click();
                        respond({id, data: true});
                    });
                    break;
                case 'devtools-exists':
                    whenFound(data, () => respond({id, data: true}));
                    break;
                case 'devtools-paste':
                    whenFound('.config-editor textarea.editor', (textarea) => {
                        (textarea as HTMLTextAreaElement).value = data;
                        (document.querySelectorAll('.config-editor .buttons button')[1] as HTMLButtonElement).click();
                        respond({id});
                    });
                    break;
                case 'devtools-reset':
                    whenFound('.config-editor .buttons button', (buttonReset) => {
                        respond({id});
                        buttonReset.click();
                        (document.querySelector('button.message-box__button-ok') as HTMLButtonElement).click();
                    });
                    break;
            }
        } catch (err) {
            respond({id, error: String(err)});
        }
    };
}

if (__CHROMIUM_MV3__) {
    // See getExtensionPageTabMV3() for explanation of what it is
    chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
        if (message === 'getExtensionPageTabMV3_ping') {
            sendResponse('getExtensionPageTabMV3_pong');
        }
    });
}
