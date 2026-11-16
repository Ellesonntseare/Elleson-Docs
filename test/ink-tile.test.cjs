const {test}=require('node:test'),assert=require('node:assert/strict')
test('tall Word pages use bounded visible ink tiles without changing document coordinates',async()=>{
 const {inkTile}=await import('../web/ink-tile.mjs')
 for(const scale of [.4,1,4,12]){
  const tile=inkTile(794,9083,5000,700/scale,scale,3)
  assert.ok(tile.pixelWidth<=2049&&tile.pixelHeight<=2049)
  assert.ok(tile.pixelWidth*tile.pixelHeight<=4200000)
  assert.ok(tile.top<=5000&&tile.top+tile.height>5000)
  const point=[230,5100],pixel=[point[0]*tile.density,(point[1]-tile.top)*tile.density]
  assert.equal(pixel[0]/tile.density,point[0]);assert.equal(pixel[1]/tile.density+tile.top,point[1])
 }
 const {validInkPosition}=await import('../word-format.mjs')
 assert.ok(validInkPosition({x:100,y:7000,width:100,height:50}))
})
