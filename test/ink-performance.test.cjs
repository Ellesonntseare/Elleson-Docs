const {test}=require('node:test'),assert=require('node:assert/strict')
test('live ink draws every curve once as a long stroke grows',async()=>{
 const {incrementalStroke}=await import('../web/smooth-ink.mjs');let curves=0;const context={beginPath(){},moveTo(){},quadraticCurveTo(){curves++},lineTo(){},stroke(){}};const points=[[0,0]];let from=1
 for(let i=1;i<3000;i++){points.push([i,Math.sin(i/10)]);from=incrementalStroke(context,points,from)}
 assert.equal(curves,2998);incrementalStroke(context,points,from,true);assert.equal(curves,2998)
})
