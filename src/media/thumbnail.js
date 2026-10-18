export function thumbnail(video){
  const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
  const context=canvas.getContext('2d');context.drawImage(video,0,0,90,160);return canvas.toDataURL('image/jpeg',.65);
}
