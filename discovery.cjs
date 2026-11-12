const dgram = require('node:dgram')
const os = require('node:os')
// Discovery only advertises the service; editing still requires a pairing token.
exports.advertise = server => {
  const socket = dgram.createSocket('udp4')
  socket.on('error', () => { try { socket.close() } catch {} })
  socket.on('message', (bytes, remote) => {
    if (bytes.toString() !== 'ELLESON_DOCS_DISCOVER_V1') return
    const response = Buffer.from(JSON.stringify({ service: 'elleson-docs', name: os.hostname(), port: server.address()?.port }))
    socket.send(response, remote.port, remote.address)
  })
  socket.bind(16944, '0.0.0.0', () => socket.unref())
  server.once('close', () => { try { socket.close() } catch {} })
}
