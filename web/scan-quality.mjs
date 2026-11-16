export function scanWarnings(data,width,height,corners){
 let sum=0,detail=0,bright=0;const count=width*height,gray=i=>(data[i]+data[i+1]+data[i+2])/3
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,l=gray(i);sum+=l;if(l>250)bright++;if(x&&y)detail+=Math.abs(l-gray(i-4))+Math.abs(l-gray(i-width*4))}
 const warnings=[];if(sum/count<65)warnings.push('Low light: add light or retake.');if(detail/count<4)warnings.push('Low detail: check focus and text clarity.');if(bright/count>.55)warnings.push('Large bright area: check for glare or washed-out text.');if(corners?.some(([x,y])=>x<.015||y<.015||x>.985||y>.985))warnings.push('Paper may reach the photo edge: check for cut-off content.');return warnings
}
