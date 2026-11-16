/* Browser-only library. Audio never leaves this device. */
const BrowserLibrary=(()=>{
  const urls=new Map();
  let pending;
  function db(){
    return pending??=new Promise((resolve,reject)=>{
      const request=indexedDB.open('static-player-library',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('tracks',{keyPath:'id'});
      request.onsuccess=()=>{const database=request.result;database.onversionchange=()=>{database.close();pending=null;};resolve(database);};
      request.onerror=()=>{pending=null;reject(request.error);};
      request.onblocked=()=>{pending=null;reject(Error('Закройте другие вкладки плеера.'));};
    });
  }
  async function transaction(mode,action){
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction('tracks',mode),request=action(tx.objectStore('tracks'));
      let result;request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Не удалось сохранить файл.'));tx.onerror=()=>{};
    });
  }
  function decode(bytes,encoding=3){
    try{
      let text;
      if(encoding===1)text=new TextDecoder(bytes[0]===254?'utf-16be':'utf-16le').decode(bytes);
      else text=new TextDecoder(encoding===0?'windows-1252':encoding===2?'utf-16be':'utf-8').decode(bytes);
      return text.replace(/\0/g,' / ').replace(/^(\s*\/\s*)+|(\s*\/\s*)+$/g,'').trim();
    }catch{return '';}
  }
  function artistFromTags(buffer){
    const bytes=new Uint8Array(buffer),view=new DataView(buffer);
    const ascii=(start,n)=>String.fromCharCode(...bytes.subarray(start,start+n));
    const sync=i=>(bytes[i]<<21)|(bytes[i+1]<<14)|(bytes[i+2]<<7)|bytes[i+3];
    if(ascii(0,3)==='ID3'&&bytes.length>=10){
      const version=bytes[3],end=Math.min(bytes.length,10+sync(6));
      let pos=10;
      if(bytes[5]&64&&version>=3){if(pos+4>end)return '';pos+=version===4?sync(pos):4+view.getUint32(pos);}
      while(pos+(version===2?6:10)<=end){
        const id=ascii(pos,version===2?3:4),size=version===2?(bytes[pos+3]<<16)|(bytes[pos+4]<<8)|bytes[pos+5]:version===4?sync(pos+4):view.getUint32(pos+4);
        const start=pos+(version===2?6:10);if(!size||start+size>end)break;
        if(id==='TPE1'||id==='TP1')return decode(bytes.subarray(start+1,start+size),bytes[start]);
        pos=start+size;
      }
    }
    if(ascii(0,4)==='fLaC'){
      let pos=4;
      while(pos+4<=bytes.length){
        const type=bytes[pos]&127,last=bytes[pos]&128,size=(bytes[pos+1]<<16)|(bytes[pos+2]<<8)|bytes[pos+3],end=pos+4+size;
        pos+=4;if(end>bytes.length)break;
        if(type===4&&pos+4<=end){
          let cursor=pos+4+view.getUint32(pos,true);
          if(cursor+4>end)return '';const count=view.getUint32(cursor,true);cursor+=4;
          const artists=[];
          for(let i=0;i<count&&cursor+4<=end;i++){
            const len=view.getUint32(cursor,true);cursor+=4;if(cursor+len>end)break;
            const text=decode(bytes.subarray(cursor,cursor+len));cursor+=len;
            if(/^ARTIST=/i.test(text))artists.push(text.slice(7));
          }
          return artists.join(' / ');
        }
        pos=end;if(last)break;
      }
    }
    if(bytes.length>=128&&ascii(bytes.length-128,3)==='TAG')return decode(bytes.subarray(bytes.length-95,bytes.length-65),0);
    return '';
  }
  function record(row){
    if(!urls.has(row.id))urls.set(row.id,URL.createObjectURL(row.file));
    const {file,...track}=row;return track;
  }
  return {
    async list(){return (await transaction('readonly',store=>store.getAll())).map(record);},
    url(id){return urls.get(id)||'';},
    async add(file){
      const format=file.name.split('.').pop().toLowerCase();
      if(!['mp3','wav','flac'].includes(format))throw Error('Поддерживаются MP3, WAV и FLAC.');
      if(!file.size)throw Error('Пустой файл.');
      const buffer=await file.arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',buffer);
      const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
      const id='content:'+digest;
      if(await transaction('readonly',store=>store.get(id)))return {added:false};
      const row={id,contentId:id,name:file.name.replace(/\.[^.]+$/,''),artist:artistFromTags(buffer),relative:file.name,format:format.toUpperCase(),file};
      await transaction('readwrite',store=>store.put(row));record(row);
      navigator.storage?.persist?.().catch(()=>{});
      return {added:true};
    },
    async remove(id){
      await transaction('readwrite',store=>store.delete(id));
      // Keep an existing object URL alive until this page closes: a fading channel may still use it.
    }
  };
})();
