export function buildWindow(extra?: Partial<Window>): any {
  return {
    origin: 'https://one.com',
    postMessage: () => {},
    ...extra,
  };
}

const requiredMessageEventProperties = {
  AT_TARGET: 0,
  BUBBLING_PHASE: 0,
  CAPTURING_PHASE: 0,
  NONE: 0,
  bubbles: false,
  cancelBubble: false,
  cancelable: false,
  composed: false,
  composedPath: () => [],
  defaultPrevented: false,
  eventPhase: 2,
  initEvent: () => undefined,
  initMessageEvent: () => undefined,
  isTrusted: true,
  lastEventId: '',
  ports: [],
  preventDefault: () => undefined,
  returnValue: true,
  stopImmediatePropagation: () => undefined,
  stopPropagation: () => undefined,
  timeStamp: 50000,
  type: 'message',
};

export function buildMessageEvent(extra?: Partial<WindowEventMap['message']>): WindowEventMap['message'] {
  const origin = 'https://one.com';
  const windowOne = buildWindow({ origin });
  const windowTwo = buildWindow({ origin: 'https://two.com' });
  return {
    /* properties that ts requires that we don't really care about in postMessenger: */
    ...requiredMessageEventProperties,
    currentTarget: windowTwo,
    data: {},
    origin,
    source: windowOne,
    srcElement: windowOne,
    target: windowTwo,
    ...extra,
  };
}
