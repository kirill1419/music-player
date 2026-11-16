/* Two independent media channels allow real overlap, including radio interludes. */
(function(root){
class MusicEngine {
  constructor({streamOutput=false,makeAudio=()=>new Audio(),next=()=>null,onActive=()=>{},onState=()=>{},onTime=()=>{},onFinish=()=>{},onError=()=>{}}={}) {
    Object.assign(this,{makeAudio,next,onActive,onState,onTime,onFinish,onError});
    this.active=null;this.prepared=null;this.fade=null;this.volume=.7;this.seconds=0;this.interludeSeconds=0;this.paused=true;this.generation=0;
    this.songNoFade=false;this.interludeNoFade=false;
    const nav=root.navigator;
    this.nativeAudio=!!nav&&(/iPad|iPhone|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1));
    this.isIOS=this.nativeAudio;
    this.streamOutput=this.isIOS&&streamOutput;
    if(this.isIOS){try{if(nav.audioSession)nav.audioSession.type='playback';}catch{}}
    if(this.streamOutput)this.nativeAudio=false;

  }
  channel(item) {
    const media=this.makeAudio();media.preload='auto';media.src=item.src;media.volume=this.volume;
    const c={item,media,finished:false,last:0,failedNext:false};
    const AudioContext=root.AudioContext||root.webkitAudioContext;
    if(AudioContext&&!this.nativeAudio){
      this.audioContext??=new AudioContext();
      if(this.streamOutput&&!this.streamDestination){
        this.streamDestination=this.audioContext.createMediaStreamDestination();
        this.output=this.makeAudio();this.output.autoplay=false;this.output.playsInline=true;
        this.output.srcObject=this.streamDestination.stream;
      }
      c.source=this.audioContext.createMediaElementSource(media);c.gain=this.audioContext.createGain();
      if(!this.analyser&&this.audioContext.createAnalyser){
        this.analyser=this.audioContext.createAnalyser();this.analyser.fftSize=1024;this.analyser.smoothingTimeConstant=.4;this.analyser.connect(this.streamDestination||this.audioContext.destination);
      }
      c.source.connect(c.gain);c.gain.connect(this.analyser||this.streamDestination||this.audioContext.destination);
    }
    this.channelGain(c,1);
    const initialize=()=>{if(c.initialized||!Number.isFinite(media.duration))return;c.initialized=true;const {start}=this.bounds(c);media.currentTime=start;c.last=start;};
    media.addEventListener('loadedmetadata',initialize);initialize();
    media.addEventListener('ended',()=>this.ended(c));
    media.addEventListener('error',()=>this.failed(c));
    return c;
  }
  dispose(c){if(!c)return;c.media.pause();c.source?.disconnect();c.gain?.disconnect();c.media.removeAttribute('src');c.media.load();}
  reset(){this.generation++;const channels=new Set([this.active,this.prepared,this.fade?.out]);this.active=this.prepared=this.fade=null;channels.forEach(c=>this.dispose(c));this.paused=true;this.output?.pause();}
  async load(item,play=false){this.reset();if(!item){this.onState();return;}this.active=this.channel(item);this.onActive(item,this.active.media);if(play)await this.play();else this.onState();}
  async play(){
    if(!this.active)return;
    if(this.active.finished){this.active.finished=false;this.seek(this.active.media,this.bounds(this.active).start);}
    this.paused=false;
    const channels=[this.active,...(this.fade?[this.fade.out]:[])];
    try{
      const starts=[];
      if(this.audioContext)starts.push(this.audioContext.resume());
      if(this.output)starts.push(this.output.play());
      starts.push(...channels.filter(c=>!c.media.ended).map(c=>c.media.play()));
      await Promise.all(starts);
    }
    catch(e){if(e.name!=='AbortError'){this.pause();this.onError('Нажмите воспроизведение или выберите другой файл.');}}
    this.onState();
  }
  pause(){this.paused=true;this.active?.media.pause();this.fade?.out.media.pause();this.output?.pause();this.onState();}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));this.applyGain();}
  setFade(value){if(this.nativeAudio){this.seconds=0;return;}this.seconds=Math.max(0,Math.min(5,Number(value)||0));}
  setInterludeFade(value){if(this.nativeAudio){this.interludeSeconds=0;return;}this.interludeSeconds=Math.max(0,Math.min(5,Number(value)||0));}
  setNoFade(kind,value){if(kind==='interlude')this.interludeNoFade=Boolean(value);else this.songNoFade=Boolean(value);}
  invalidate(){this.dispose(this.prepared);this.prepared=null;if(this.active)this.active.failedNext=false;}
  channelGain(c,envelope){const gain=c.item.kind==='song'?Math.max(.5,Math.min(2,Number(c.item.gain)||1)):1;if(c.gain){c.gain.gain.value=gain*this.volume*envelope;c.media.volume=1;}else c.media.volume=Math.min(1,this.volume*envelope*gain);}
  applyGain(){if(this.fade){const p=this.fade.progress;this.channelGain(this.fade.out,this.fade.noFade?1:1-p);this.channelGain(this.active,this.fade.noFade?1:p);}else if(this.active)this.channelGain(this.active,1);}
  finish(c){if(c.finished)return;c.finished=true;this.onFinish(c.item);}
  bounds(c){
    const duration=c.media.duration;
    const start=Math.max(0,Math.min(Number(c.item.start)||0,Math.max(0,duration-.1)));
    let end=c.item.end==null?duration:Math.min(duration,Number(c.item.end));
    if(c.item.half)end=start+((end>start?end:duration)-start)/2;
    return {start,end:end>start?end:duration,length:(end>start?end:duration)-start};
  }
  report(c){const time=c.media.currentTime;const delta=time-c.last;c.last=time;if(!this.paused&&delta>0&&delta<2)this.onTime(c.item,delta);}
  prepare(){
    if(!this.active||this.fade||this.active.failedNext)return;
    const item=this.next(this.active.item);
    if(!item){this.dispose(this.prepared);this.prepared=null;return;}
    const key=JSON.stringify(item);
    if(this.prepared?.key===key)return;
    this.dispose(this.prepared);this.prepared=this.channel(item);this.prepared.key=key;
  }
  tick(){
    if(!this.active)return;
    this.report(this.active);if(this.fade)this.report(this.fade.out);
    if(this.paused)return;
    if(this.fade&&this.fade.out.media.currentTime>=this.bounds(this.fade.out).end)this.completeFade();
    if(this.active.media.currentTime>=this.bounds(this.active).end){this.active.media.pause();this.ended(this.active);return;}
    if(this.fade){
      // Media time freezes on pause or buffering; wall-clock timers do not.
      this.fade.progress=Math.min(1,Math.max(0,(this.active.media.currentTime-this.bounds(this.active).start)/this.fade.duration));
      this.applyGain();
      if((!this.fade.noFade&&this.fade.progress>=1)||this.fade.out.media.ended)this.completeFade();
      return;
    }
    this.prepare();
    const out=this.active.media, incoming=this.prepared?.media;
    const seconds=this.active.item.kind==='interlude'?this.interludeSeconds:this.seconds;
    if(!seconds||!incoming||incoming.readyState<2||out.paused||out.seeking)return;
    const duration=Math.min(seconds,this.bounds(this.active).length/2,this.bounds(this.prepared).length/2);
    const remaining=this.bounds(this.active).end-out.currentTime;
    if(Number.isFinite(duration)&&duration>0&&remaining>0&&remaining<=duration)this.transition(Math.min(duration,remaining));
  }
  async transition(duration){
    const out=this.active, incoming=this.prepared;if(!out||!incoming||this.fade)return;
    const noFade=out.item.kind==='interlude'?this.interludeNoFade:this.songNoFade;
    this.prepared=null;this.active=incoming;this.fade={out,duration,progress:0,noFade};this.applyGain();
    const generation=this.generation;
    try{
      await incoming.media.play();
      if(generation!==this.generation||this.active!==incoming)return;
      if(this.paused)incoming.media.pause();
      this.onActive(incoming.item,incoming.media);this.onState();
    }catch(e){
      if(generation!==this.generation||this.active!==incoming)return;
      this.active=out;this.fade=null;out.failedNext=true;this.dispose(incoming);this.applyGain();
      if(e.name!=='AbortError')this.onError('Не удалось начать следующий файл. Текущая песня продолжит играть.');
    }
  }
  completeFade(){
    if(!this.fade)return;
    const out=this.fade.out;
    // A fade is scheduled for the natural end; a user seek/skip never counts it.
    this.finish(out);this.dispose(out);this.fade=null;this.applyGain();this.onState();
  }
  async ended(c){
    if(c!==this.active&&c!==this.fade?.out)return;
    this.finish(c);
    if(this.fade?.out===c){this.completeFade();return;}
    if(c!==this.active)return;
    if(this.fade)this.completeFade();
    this.prepare();const next=this.prepared;this.prepared=null;
    if(next){this.active=next;this.dispose(c);this.onActive(next.item,next.media);this.applyGain();if(!this.paused)await this.play();}
    else{this.paused=true;this.onState();}
  }
  seek(media,time){
    const c=this.active;if(!c||c.media!==media||!Number.isFinite(media.duration))return;
    if(this.fade){this.dispose(this.fade.out);this.fade=null;this.applyGain();}
    const {start,end}=this.bounds(c);
    media.currentTime=Math.max(start,Math.min(end,time));c.last=media.currentTime;
  }
  failed(c){
    if(c===this.prepared){this.prepared=null;if(this.active)this.active.failedNext=true;this.dispose(c);this.onError('Следующий файл недоступен или не поддерживается браузером.');}
    else if(c===this.active){
      if(this.fade){const out=this.fade.out;this.fade=null;this.active=out;out.failedNext=true;this.dispose(c);this.applyGain();this.onActive(out.item,out.media);}
      else this.pause();
      this.onError('Файл недоступен или не поддерживается браузером. Выберите другой трек.');
    }
  }
}
MusicEngine.buildQueue=function(tracks,{duplicate=true,duplicateCount=2,weightFactor=2,weighted=true,shuffle=false,reactions={},pinned=null,random=Math.random}={}){
  const pool=tracks.map(t=>({...t,queueId:t.id+':0'}));
  duplicateCount=Math.max(2,Math.min(5,Math.round(Number(duplicateCount)||2)));
  weightFactor=Math.max(1,Math.min(5,Number(weightFactor)||2));
  if(duplicate)for(const t of tracks)if(reactions[t.id]==='like')for(let copy=1;copy<duplicateCount;copy++)pool.push({...t,queueId:t.id+':'+copy});
  const result=[];
  const initialCounts=new Map();for(const t of pool)initialCounts.set(t.id,(initialCounts.get(t.id)||0)+1);
  const canLoop=pool.length>1&&Math.max(...initialCounts.values())<=Math.floor(pool.length/2);
  if(pinned){let i=pool.findIndex(t=>t.queueId===pinned.queueId);if(i<0)i=pool.findIndex(t=>t.id===pinned.id);if(i>=0)result.push(pool.splice(i,1)[0]);}
  while(pool.length){
    const previous=result.at(-1)?.id;
    let candidates=pool.map((t,i)=>i).filter(i=>pool[i].id!==previous);
    if(!candidates.length)candidates=pool.map((t,i)=>i);
    // Avoid choices that would strand repeated songs at the end.
    const counts=new Map();for(const t of pool)counts.set(t.id,(counts.get(t.id)||0)+1);
    const remaining=pool.length-1;
    const tooMany=[...counts].filter(([,n])=>n>Math.ceil(remaining/2)).map(([id])=>id);
    let feasible=candidates.filter(i=>counts.get(pool[i].id)-1<=Math.floor(remaining/2)&&tooMany.every(id=>id===pool[i].id));
    if(canLoop&&result.length){
      const first=result[0].id;
      const circular=feasible.filter(i=>remaining===0?pool[i].id!==first:[...counts].every(([id,n])=>n-(id===pool[i].id?1:0)<=Math.floor((remaining+1-(id===pool[i].id?1:0)-(id===first?1:0))/2)));
      if(circular.length)feasible=circular;
    }
    if(feasible.length)candidates=feasible;
    let chosen=candidates[0];
    if(shuffle){
      const weights=candidates.map(i=>!weighted?1:reactions[pool[i].id]==='like'?weightFactor:reactions[pool[i].id]==='dislike'?1/weightFactor:1);
      let draw=random()*weights.reduce((a,b)=>a+b,0);
      for(let j=0;j<candidates.length;j++){draw-=weights[j];chosen=candidates[j];if(draw<0)break;}
    }
    result.push(pool.splice(chosen,1)[0]);
  }
  return result;
};
if(typeof module!=='undefined'&&module.exports)module.exports=MusicEngine;
else root.MusicEngine=MusicEngine;
})(globalThis);
