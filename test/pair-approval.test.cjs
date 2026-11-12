const {test} = require('node:test')
const assert = require('node:assert/strict')
const {start} = require('../server.cjs')
test('one-touch pairing requires PC approval and a single-use secret before document access', async () => {
  const host = await start()
  const post = (route, data, token) => fetch(host.address + route, {method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)})
  try {
    const ticket = await (await post('/api/pair-request',{})).json()
    assert.equal((await fetch(host.address + '/api/state')).status,401)
    assert.deepEqual(await (await post('/api/pair-request/status',ticket)).json(),{waiting:true})
    assert.equal((await post('/api/pair-request/approve',{id:ticket.id,approve:true})).status,401)
    assert.equal((await post('/api/pair-request/status',{...ticket,secret:'wrong'})).status,410)
    assert.equal((await post('/api/pair-request/approve',{id:ticket.id,approve:true},host.owner)).status,204)
    const paired = await (await post('/api/pair-request/status',ticket)).json()
    assert.equal((await fetch(host.address + '/api/state',{headers:{Authorization:'Bearer '+paired.token}})).status,200)
    assert.equal((await post('/api/pair-request/status',ticket)).status,410)
  } finally {await new Promise(resolve => host.server.close(resolve))}
})
