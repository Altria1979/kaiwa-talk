import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let rendering;
const sameDependencies = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
mock.module('react', { exports: {
  useRef(initial) {
    const owner = rendering, index = owner.cursor++;
    return owner.slots[index] ??= { current: initial };
  },
  useState(initial) {
    const owner = rendering, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = initial;
    return [owner.slots[index], value => { owner.writes++; owner.slots[index] = value; }];
  },
  useCallback(callback, dependencies) {
    const owner = rendering, index = owner.cursor++;
    if (!sameDependencies(owner.slots[index]?.dependencies, dependencies)) owner.slots[index] = { callback, dependencies };
    return owner.slots[index].callback;
  },
  useEffect(effect, dependencies) {
    const owner = rendering, index = owner.cursor++;
    const previous = owner.slots[index];
    if (sameDependencies(previous?.dependencies, dependencies)) return;
    owner.slots[index] = { dependencies, cleanup: previous?.cleanup };
    owner.effects.push(() => {
      owner.slots[index].cleanup?.();
      owner.slots[index].cleanup = effect();
    });
  },
} });
const { useConversationScroll } = await import('../src/hooks/use-conversation-scroll.ts');

function harness(t) {
  const previousObserver = globalThis.ResizeObserver;
  class TestResizeObserver {
    static latest;
    observed = [];
    disconnected = false;
    constructor(callback) { this.callback = callback; TestResizeObserver.latest = this; }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  }
  globalThis.ResizeObserver = TestResizeObserver;
  const listeners = new Map();
  let top = 0;
  const node = {
    scrollHeight: 1200, clientHeight: 400,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
  };
  const content = {};
  const owner = { slots: [], effects: [], cursor: 0, writes: 0 };
  let options = { sessionId: 'session', latestUserMessageId: 'user-1', recognizing: false };
  let unmounted = false;
  const current = function Harness() {
    rendering = owner;
    owner.cursor = 0;
    const result = useConversationScroll(options);
    result.chatScroll.current = node;
    result.chatContent.current = content;
    for (const effect of owner.effects.splice(0)) effect();
    return result;
  };
  const resize = (dimensions = {}) => {
    Object.assign(node, dimensions);
    node.scrollTop = node.scrollTop;
    TestResizeObserver.latest.callback();
  };
  const scroll = value => { node.scrollTop = value; current().onScroll(); };
  const emit = (type, event) => listeners.get(type)?.({ target: node, ...event });
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    for (const slot of owner.slots) slot?.cleanup?.();
  };
  t.after(() => { unmount(); globalThis.ResizeObserver = previousObserver; });
  current();
  resize();
  return {
    node, content, current, resize, scroll, emit, observer: TestResizeObserver.latest, listeners, owner, unmount,
    async update(next) { options = { ...options, ...next }; current(); await Promise.resolve(); return current(); },
  };
}

test('initial content and streamed growth stay at the latest message', t => {
  const h = harness(t);
  assert.deepEqual(h.observer.observed, [h.node, h.content]);
  assert.equal(h.node.scrollTop, 800);
  h.resize({ scrollHeight: 1600 });
  assert.equal(h.node.scrollTop, 1200);
  h.current().onScroll();
  h.resize({ scrollHeight: 1900 });
  assert.equal(h.node.scrollTop, 1500);
  assert.equal(h.current().showLatest, false);
});

test('a layout scroll before ResizeObserver does not disable following', t => {
  const h = harness(t);
  h.node.scrollHeight = 1600;
  h.node.clientHeight = 280;
  h.current().onScroll();
  assert.equal(h.node.scrollTop, 1320);
  h.resize();
  assert.equal(h.node.scrollTop, 1320);
  assert.equal(h.current().showLatest, false);
});

test('ResizeObserver before a delayed scroll event keeps following', t => {
  const h = harness(t);
  h.resize({ scrollHeight: 1500, clientHeight: 250 });
  h.current().onScroll();
  h.resize({ scrollHeight: 1700 });
  assert.equal(h.node.scrollTop, 1450);
  assert.equal(h.current().showLatest, false);
});

test('content shrinking and suggestion panel resizing cannot be mistaken for manual scrolling', t => {
  const h = harness(t);
  h.node.scrollHeight = 650;
  h.node.scrollTop = h.node.scrollTop;
  h.current().onScroll();
  h.resize();
  assert.equal(h.node.scrollTop, 250);
  h.resize({ clientHeight: 220 });
  assert.equal(h.node.scrollTop, 430);
  h.resize({ clientHeight: 500 });
  assert.equal(h.node.scrollTop, 150);
  h.resize({ scrollHeight: 1000 });
  assert.equal(h.node.scrollTop, 500);
  assert.equal(h.current().showLatest, false);
});

test('manually scrolling upward preserves the reading position as replies grow', t => {
  const h = harness(t);
  h.scroll(400);
  assert.equal(h.current().showLatest, true);
  h.resize({ scrollHeight: 1800, clientHeight: 280 });
  assert.equal(h.node.scrollTop, 400);
  h.current().onScroll();
  assert.equal(h.node.scrollTop, 400);
  h.scroll(1520);
  assert.equal(h.current().showLatest, false);
  h.resize({ scrollHeight: 2000 });
  assert.equal(h.node.scrollTop, 1720);
});

test('small upward scrolls within the bottom threshold are never pulled back', t => {
  const h = harness(t);
  h.scroll(780);
  assert.equal(h.node.scrollTop, 780);
  assert.equal(h.current().showLatest, true);
  h.resize();
  assert.equal(h.node.scrollTop, 780);
  h.scroll(760);
  h.scroll(740);
  h.scroll(720);
  assert.equal(h.node.scrollTop, 720);
  h.resize({ scrollHeight: 1300 });
  assert.equal(h.node.scrollTop, 720);
  h.scroll(860);
  assert.equal(h.current().showLatest, false, 'scrolling down near the bottom restores following');
  assert.equal(h.node.scrollTop, 860, 'ordinary scroll events do not force a position jump');
  h.resize({ scrollHeight: 1400 });
  assert.equal(h.node.scrollTop, 1000);
});

test('explicit upward input survives a resize before its scroll event', async t => {
  for (const input of ['wheel', 'keyboard', 'touch']) await t.test(input, t => {
    const h = harness(t);
    if (input === 'wheel') h.emit('wheel', { deltaY: -200 });
    if (input === 'keyboard') h.emit('keydown', { key: 'PageUp' });
    if (input === 'touch') {
      h.emit('touchstart', { touches: [{ clientY: 100 }] });
      h.emit('touchmove', { touches: [{ clientY: 300 }] });
    }
    h.resize({ scrollHeight: 1500 });
    assert.equal(h.node.scrollTop, 800);
    h.scroll(600);
    h.resize({ scrollHeight: 1700 });
    assert.equal(h.node.scrollTop, 600);
    assert.equal(h.current().showLatest, true);
  });
});

test('latest-message action immediately resumes following and clears its button', t => {
  const h = harness(t);
  h.scroll(300);
  h.current().scrollToLatest();
  assert.equal(h.node.scrollTop, 800);
  assert.equal(h.current().showLatest, false);
  h.current().onScroll();
  h.resize({ scrollHeight: 1600 });
  assert.equal(h.node.scrollTop, 1200);
});

test('following also reveals the latest message in the page without losing the inner bottom', t => {
  const h = harness(t);
  const calls = [];
  h.content.lastElementChild = { scrollIntoView(options) {
    calls.push(options);
    h.node.scrollTop = 200;
  } };
  h.current().scrollToLatest();
  assert.deepEqual(calls, [{ block: 'nearest', inline: 'nearest', behavior: 'instant' }]);
  assert.equal(h.node.scrollTop, 800);
  h.scroll(300);
  h.resize({ scrollHeight: 1600 });
  assert.equal(calls.length, 1, 'reading history must not move the outer page');
  assert.equal(h.node.scrollTop, 300);
});

test('new final user messages and session changes resume following', async t => {
  for (const options of [{ latestUserMessageId: 'user-2' }, { sessionId: 'other-session' }]) await t.test(JSON.stringify(options), async t => {
    const h = harness(t);
    h.scroll(300);
    h.node.scrollHeight = 1600;
    await h.update(options);
    assert.equal(h.node.scrollTop, 1200);
    assert.equal(h.current().showLatest, false);
    h.resize({ scrollHeight: 1800 });
    assert.equal(h.node.scrollTop, 1400);
  });
});

test('recognition onset resumes following once per utterance without trapping a reader', async t => {
  const h = harness(t);
  h.scroll(300);
  await h.update({ recognizing: true });
  assert.equal(h.node.scrollTop, 800);
  h.scroll(200);
  await h.update({ recognizing: true });
  assert.equal(h.node.scrollTop, 200, 'additional partial transcripts must not steal scroll position');
  await h.update({ recognizing: false });
  assert.equal(h.node.scrollTop, 200, 'recognition completion alone does not force scrolling');
  await h.update({ recognizing: true });
  assert.equal(h.node.scrollTop, 800);
});

test('unmount disconnects observers, removes input handlers and cancels queued scrolling', async t => {
  const h = harness(t);
  h.scroll(300);
  const pending = h.update({ latestUserMessageId: 'user-2' });
  const writes = h.owner.writes;
  h.unmount();
  await pending;
  h.observer.callback();
  assert.equal(h.observer.disconnected, true);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.node.scrollTop, 300);
  assert.equal(h.owner.writes, writes);
});
