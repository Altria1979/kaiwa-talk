export function serviceAddress(location?: Pick<Location, 'protocol' | 'hostname' | 'port' | 'host'>, sameOrigin = false) {
  const local = !location || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (location && (sameOrigin || !local)) {
    return { serviceUrl: '', socketUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws` };
  }
  const port = location ? Number(location.port || 3000) + 1 : 3001;
  return { serviceUrl: `http://127.0.0.1:${port}`, socketUrl: `ws://127.0.0.1:${port}/ws` };
}
