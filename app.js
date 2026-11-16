const $=id=>document.getElementById(id);
let audio=$('audio'), interlude=$('interlude');
const icons={play:'<path d="m9 5 12 7-12 7z" fill="currentColor"/>',pause:'<path d="M8 5v14M16 5v14" stroke-width="5"/>',previous:'<path d="M6 5v14m13-14L8 12l11 7z"/>',next:'<path d="M18 5v14M5 5l11 7-11 7z"/>',shuffle:'<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-4-4 4 4-4 4"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>'};
icons.like='<path class="heart-shape" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>';
icons.dislike='<path d="M10 4.8a5.5 5.5 0 0 0-7 8L12 21l8.8-8.2a5.5 5.5 0 0 0-6.8-8L11 9l4 3-4 5"/>';
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;}
['play','previous','next','shuffle','repeat','like','dislike'].forEach(id=>$(id).innerHTML=icon(id));
function read(key,fallback){try{return JSON.parse(localStorage.getItem('static-player:'+key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem('static-player:'+key,JSON.stringify(value));}catch{$('status').textContent='Браузер не смог сохранить настройки.';}}
let tracks=[], order=[], current=null, shuffled=false, repeat=read('repeat',0), pending=null, isPreview=false, sessionToken='', busy=false, interludeUrl='';
let stats=read('stats',{songs:{},days:{},seconds:0});
const statsIdentities=read('stats-identities',{});
function statsKey(track){return track.contentId||statsIdentities[track.id]||track.id;}
function syncStatsTrack(track){
  const key=statsKey(track);
  if(track.contentId){statsIdentities[track.id]=key;const legacy=stats.songs[track.id];if(legacy&&key!==track.id){const dest=stats.songs[key];if(dest){dest.seconds=(dest.seconds||0)+(legacy.seconds||0);dest.plays=(dest.plays||0)+(legacy.plays||0);if(!dest.duration)dest.duration=legacy.duration;}else stats.songs[key]={...legacy};delete stats.songs[track.id];}}
  const record=stats.songs[key];
  if(record){record.name=trackName(track);record.reaction=reactions[track.id]||null;const duration=durations.get(track.id);if(Number.isFinite(duration)&&duration>0)record.duration=duration;}
  return key;
}
function listeningRecord(track){const key=syncStatsTrack(track);return stats.songs[key]??={name:trackName(track),seconds:0,plays:0,duration:durations.get(track.id)||null,reaction:reactions[track.id]||null};}
const durations=new Map();
let halfQueue=read('half-queue',false);
let interludeQueue=[],interludeNextId=null;
let starredInterlude=read('starred-interlude',null),startWithInterlude=read('start-with-interlude',true);
const starIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg>';
const reactions=read('track-reactions',{});
const trackEdits=read('track-edits',{});
function trackName(t){return trackEdits[t.id]?.name??t.name;}
function trackArtist(t){return trackEdits[t.id]?.artist??t.artist??'';}
function trackBounds(t,applyMode=true){const full=durations.get(t?.id);const edit=trackEdits[t?.id]||{};const start=Math.max(0,Math.min(edit.start||0,Math.max(0,full-.1)));let end=Math.min(edit.end??full,full);if(halfQueue&&applyMode)end=start+(end-start)/2;return {start,end:end>start?end:full,length:(end>start?end:full)-start};}
function trackLength(t){return trackBounds(t).length;}
function trackPosition(t,time){const b=trackBounds(t);return Number.isFinite(b.start)?Math.max(0,Math.min(b.length,time-b.start)):time||0;}
let duplicateLiked=read('duplicate-liked',true),weightedShuffle=read('weighted-shuffle',true);
let duplicateCount=Math.max(2,Math.min(5,Math.round(Number(read('duplicate-count',2))||2))),weightFactor=Math.max(1,Math.min(5,Number(read('weight-factor',2))||2));
function queueIndex(track){if(!track)return -1;let i=order.findIndex(t=>t.queueId&&t.queueId===track.queueId);return i<0?order.findIndex(t=>t.id===track.id):i;}
function rebuildQueue(keepCurrent=false){
  order=MusicEngine.buildQueue(tracks.filter(t=>!halfQueue||reactions[t.id]!=='dislike'),{duplicate:duplicateLiked,duplicateCount,weightFactor,weighted:weightedShuffle,shuffle:shuffled,reactions,pinned:keepCurrent?current:null});
  if(current){const replacement=order[queueIndex(current)];if(replacement){current=replacement;if(engine.active?.item.kind==='song')engine.active.item.track=current;}}
  engine.invalidate();renderQueue();updatePlaylistSummary();
}
function updateReactionQueue(id){
  if(halfQueue&&reactions[id]==='dislike'){order=order.filter(t=>t.id!==id);refreshHalfPlayback();engine.invalidate();renderQueue();updatePlaylistSummary();return;}
  const track=tracks.find(t=>t.id===id);
  if(track){
    const desired=duplicateLiked&&reactions[id]==='like'?duplicateCount:1;
    const copies=order.filter(t=>t.id===id);
    // Keep the playing occurrence even when it is one of the extra copies.
    const playing=copies.find(t=>t===current||t.queueId&&t.queueId===current?.queueId);
    const keep=new Set([...(playing?[playing]:[]),...copies.filter(t=>t!==playing)].slice(0,desired));
    order=order.filter(t=>t.id!==id||keep.has(t));
    while(order.filter(t=>t.id===id).length<desired){
      const slots=Array.from({length:order.length+1},(_,i)=>i);
      const separated=slots.filter(i=>order[i-1]?.id!==id&&order[i]?.id!==id);
      const circular=separated.filter(i=>(i!==0||order.at(-1)?.id!==id)&&(i!==order.length||order[0]?.id!==id));
      const candidates=circular.length?circular:separated.length?separated:slots;
      const index=candidates[Math.floor(Math.random()*candidates.length)];
      let copy=0;while(order.some(t=>t.queueId===id+':'+copy))copy++;
      order.splice(index,0,{...track,queueId:id+':'+copy});
    }
    if(engine.active?.item.kind==='interlude'){
      const after=engine.active.item.after;
      if(after&&!order.includes(after))engine.active.item.after=order.find(t=>t.queueId===after.queueId)||order.find(t=>t.id===after.id)||nextTrack(1,true,current);
    }
  }
  engine.invalidate();renderQueue();updatePlaylistSummary();
}
function updateShuffleButton(){$('shuffle').classList.toggle('on',shuffled);$('shuffle').setAttribute('aria-pressed',String(shuffled));}
function updateReactions(){
  $('current-track-menu').disabled=!current;
  for(const kind of ['like','dislike']){
    const button=$(kind),selected=!!current&&reactions[current.id]===kind;
    button.disabled=!current;button.setAttribute('aria-pressed',String(selected));
    button.classList.toggle('selected',selected);
  }
}
function react(kind){
  if(!current)return;
  if(reactions[current.id]===kind)delete reactions[current.id];else reactions[current.id]=kind;
  save('track-reactions',reactions);syncStatsTrack(current);save('stats',stats);updateReactionQueue(current.id);updateReactions();renderStats();
}
$('like').onclick=()=>react('like');$('dislike').onclick=()=>react('dislike');
updateReactions();
// Measure the natural stack, then fit it to the actual panel height.
// This also reacts to long titles, status messages, zoom and window resizing.
if(typeof ResizeObserver!=='undefined'){
  const content=$('player-content'),panel=content.parentElement;
  const fitPlayer=()=>{
    const style=getComputedStyle(panel);
    const available=panel.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    const scale=Math.min(1,Math.max(0,available)/Math.max(1,content.offsetHeight));
    content.style.setProperty('--player-scale',String(scale));
  };
  const playerObserver=new ResizeObserver(fitPlayer);
  playerObserver.observe(panel);playerObserver.observe(content);
  fitPlayer();
}
const fmt=value=>{if(!Number.isFinite(value))return '00:00';const n=Math.max(0,Math.floor(value));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;};
function day(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function message(text){$('status').textContent=text;}
async function api(route,data={}){
  if(route==='/api/library')return {tracks:await BrowserLibrary.list(),missing:0};
  if(route==='/api/remove-track'){await BrowserLibrary.remove(data.id);return {removed:true};}
  throw Error('Неизвестное действие.');
}
let draggedTrack=null;
function moveQueueTrack(track,target,after=false){
  const from=order.indexOf(track);if(from<0||track===target||!order.includes(target))return;
  order.splice(from,1);order.splice(order.indexOf(target)+(after?1:0),0,track);
  engine.invalidate();
  if(engine.active?.item.kind==='interlude')engine.active.item.after=nextTrack(1,true,current);
  renderQueue();updatePlaylistSummary();
}
function renderQueue(){
  if(draggedTrack)return;
  const query=$('search').value.toLocaleLowerCase(); $('queue').replaceChildren();
  const visible=order.filter(t=>trackName(t).toLocaleLowerCase().includes(query)||trackArtist(t).toLocaleLowerCase().includes(query)||t.relative.toLocaleLowerCase().includes(query));
  $('queue-count').textContent=order.length;
  if(!visible.length){const el=document.createElement('div');el.className='empty';el.textContent=tracks.length?'Ничего не найдено':'В папке пока нет музыкальных файлов';$('queue').append(el);return;}
  for(const t of visible){const button=document.createElement('button');button.className='track'+(order.indexOf(t)===queueIndex(current)?' active':'');button.title=t.relative;button.setAttribute('aria-current',String(order.indexOf(t)===queueIndex(current)));
    const number=document.createElement('span');number.className='number';number.textContent=order.indexOf(t)===queueIndex(current)&&!audio.paused?'♫':order.indexOf(t)+1;
    const details=document.createElement('span');details.className='details';const title=document.createElement('strong');title.textContent=trackName(t)+(trackEdits[t.id]?'*':'');const sub=document.createElement('small');sub.textContent=trackArtist(t)||'Неизвестный исполнитель';details.append(title,sub);
    const length=document.createElement('span');length.className='format';length.textContent=durations.has(t.id)?fmt(trackLength(t)):t.format;button.append(number,details);
    const reaction=reactions[t.id];
    if(reaction==='like'||reaction==='dislike'){
      const badge=document.createElement('span');badge.className='track-reaction '+reaction;
      badge.innerHTML=icon(reaction);badge.title=reaction==='like'?'Нравится':'Не нравится';badge.setAttribute('role','img');badge.setAttribute('aria-label',badge.title);button.append(badge);
    }
    button.append(length);button.onclick=()=>loadTrack(t,true);
    const row=document.createElement('div');row.className='queue-entry';
    const handle=document.createElement('button');handle.className='queue-drag';handle.draggable=true;
    handle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>';
    handle.title='Перетащить песню; стрелки вверх/вниз';handle.setAttribute('aria-label','Переместить: '+trackName(t));
    handle.onclick=e=>e.stopPropagation();
    handle.ondragstart=e=>{draggedTrack=t;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.queueId||t.id);row.classList.add('dragging');};
    handle.ondragend=()=>{draggedTrack=null;renderQueue();};
    handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const down=e.key==='ArrowDown',target=order[order.indexOf(t)+(down?1:-1)];if(target){moveQueueTrack(t,target,down);$('queue').querySelectorAll('.queue-drag')[order.filter(item=>trackName(item).toLocaleLowerCase().includes($('search').value.toLocaleLowerCase())||trackArtist(item).toLocaleLowerCase().includes($('search').value.toLocaleLowerCase())||item.relative.toLocaleLowerCase().includes($('search').value.toLocaleLowerCase())).indexOf(t)]?.focus();}}};
    row.ondragover=e=>{
      if(!draggedTrack||draggedTrack===t)return;e.preventDefault();e.dataTransfer.dropEffect='move';
      row.classList.add('drop-after');
      const bounds=$('queue').getBoundingClientRect();if(e.clientY<bounds.top+35)$('queue').scrollTop-=12;else if(e.clientY>bounds.bottom-35)$('queue').scrollTop+=12;
    };
    row.ondragleave=e=>{if(!row.contains(e.relatedTarget))row.classList.remove('drop-after');};
    row.ondrop=e=>{if(!draggedTrack)return;e.preventDefault();const source=draggedTrack;draggedTrack=null;moveQueueTrack(source,t,true);};
    const menu=document.createElement('button');menu.className='track-menu';menu.textContent='⋮';menu.title='Настройки песни';menu.setAttribute('aria-label','Настройки: '+trackName(t));menu.setAttribute('aria-haspopup','dialog');menu.onclick=()=>openTrackEditor(t);
    row.append(button,menu,handle);$('queue').append(row);
  }
}
function songItem(track){const edit=trackEdits[track?.id]||{};return track?{kind:'song',track,src:BrowserLibrary.url(track.id),start:edit.start||0,end:edit.end??null,half:halfQueue,gain:edit.volume??1}:null;}
function following(item){
  if(item.kind==='preview')return null;
  if(item.kind==='interlude')return songItem(item.after);
  const next=nextTrack(1,true,item.track);
  const entry=nextInterlude();
  if($('interlude-enabled').checked&&entry)return {kind:'interlude',src:entry.url,interludeId:entry.id,after:next||null};
  return songItem(next);
}
const engine=new MusicEngine({
  streamOutput:read('experimental-stream-output',true),
  next:following,
  onActive(item,media){
    $('player-error').textContent='';
    if(item.kind==='song'){
      audio=media;current=item.track;pending=null;isPreview=false;
      $('track-title').textContent=trackName(current);$('track-subtitle').textContent=trackArtist(current)||'Неизвестный исполнитель';
    }else{interlude=media;pending=item.kind==='interlude'?{track:item.after}:null;isPreview=item.kind==='preview';if(item.kind==='interlude'){const index=interludeQueue.findIndex(t=>t.id===item.interludeId);interludeNextId=interludeQueue[(index+1)%interludeQueue.length]?.id||null;save('interlude-next',interludeNextId);}renderInterludeQueue();}
    renderQueue();renderInterludeQueue();refreshPlayback();updateControls();
  },
  onState(){updateControls();},
  onTime(item,delta){if(item.kind!=='song')return;stats.seconds+=delta;const today=stats.days[day()]??={plays:0,seconds:0};today.seconds+=delta;const song=listeningRecord(item.track);song.seconds+=delta;},
  onFinish(item){if(item.kind!=='song')return;const song=listeningRecord(item.track);song.plays++;const today=stats.days[day()]??={plays:0,seconds:0};today.plays++;save('stats',stats);renderStats();},
  onError(text){$('player-error').textContent=text;}
});

let durationScan=null, durationLoading=false, durationFailures=0;
function readDuration(track,signal){
  return new Promise(resolve=>{
    const probe=new Audio();probe.preload='metadata';let settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timeout);signal.removeEventListener('abort',cancel);probe.onloadedmetadata=probe.ondurationchange=probe.onerror=null;probe.removeAttribute('src');probe.load();resolve(value);};
    const cancel=()=>finish(null);
    const accept=()=>{if(Number.isFinite(probe.duration)&&probe.duration>=0)finish(probe.duration);};
    const timeout=setTimeout(cancel,12000);
    signal.addEventListener('abort',cancel,{once:true});
    probe.onloadedmetadata=probe.ondurationchange=accept;probe.onerror=cancel;
    if(signal.aborted)cancel();else probe.src=BrowserLibrary.url(track.id);
  });
}
async function scanDurations(list){
  durationScan?.abort();const controller=new AbortController();durationScan=controller;
  durationLoading=true;durationFailures=0;let index=0;
  updatePlaylistSummary();
  async function worker(){
    while(index<list.length&&!controller.signal.aborted){
      const track=list[index++];
      if(durations.has(track.id))continue;
      const value=await readDuration(track,controller.signal);
      if(controller.signal.aborted)return;
      if(value!==null){durations.set(track.id,value);syncStatsTrack(track);}else durationFailures++;
      updatePlaylistSummary();
    }
  }
  await Promise.all(Array.from({length:Math.min(3,list.length)},worker));
  if(controller.signal.aborted)return;
  durationLoading=false;save('stats',stats);renderStats();renderQueue();updatePlaylistSummary();renderPlaylists();
}
function updatePlaylistSummary(){
  const index=queueIndex(current);
  $('playlist-position').textContent=(index<0?0:index+1)+'/'+order.length;
  let total=0,prefix=0,unknown=0,prefixUnknown=false;
  order.forEach((track,i)=>{const value=trackLength(track);if(Number.isFinite(value)){total+=value;if(i<index)prefix+=value;}else{unknown++;if(i<index)prefixUnknown=true;}});
  let position=0;
  if(index>=0){
    if(engine.active?.item.kind==='song')position=trackPosition(current,audio.currentTime);
    else if(engine.fade?.out.item.kind==='song')position=trackPosition(current,engine.fade.out.media.currentTime);
    else if(engine.active?.item.kind==='interlude')position=trackLength(current)||0;
    else position=trackPosition(current,audio.currentTime);
  }
  const elapsed=prefixUnknown?'…':listeningTime(prefix+position);
  const totalLabel=unknown?(durationLoading?'…':'≥ '+listeningTime(total)):listeningTime(total);
  $('playlist-time').textContent=elapsed+' / '+totalLabel;
  $('playlist-time').title='Позиция в очереди / сумма длительностей песен. Без проигрыша; наслаивание не вычитается.';
  $('duration-status').textContent=durationLoading&&unknown?'Считаем длительность: '+(order.length-unknown)+'/'+order.length:unknown?'Длительность недоступна для '+unknown+' файлов. Показана известная сумма.':'';

}
let queueHidden=read('queue-hidden',false);
function updateQueueVisibility(){
  $('library-panel').classList.toggle('playlists-open',queueHidden);
  $('queue-content').inert=queueHidden;
  $('playlist-list-wrap').inert=!queueHidden;
  const eye=queueHidden?'<path d="M3 9c2 4 5 6 9 6s7-2 9-6M5 12l-2 3m6-1-1 4m7-4 1 4m3-6 2 3"/>':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  $('queue-toggle').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+eye+'</svg>';
  const label=queueHidden?'Показать очередь':'Показать плейлисты';
  $('queue-toggle').setAttribute('aria-label',label);$('queue-toggle').title=label;
  $('queue-toggle').setAttribute('aria-expanded',String(!queueHidden));
}
$('queue-toggle').onclick=()=>{queueHidden=!queueHidden;save('queue-hidden',queueHidden);updateQueueVisibility();};
updateQueueVisibility();

function updateControls(){
  updateReactions();
  const playing=!engine.paused;const kind=engine.active?.item.kind;
  $('play').innerHTML=icon(playing?'pause':'play');$('play').setAttribute('aria-label',playing?'Пауза':'Воспроизвести');
  $('play-state').textContent=playing?(engine.fade?'ПЛАВНЫЙ ПЕРЕХОД':kind==='song'?'СЕЙЧАС ИГРАЕТ':'ПРОИГРЫШ МЕЖДУ ПЕСНЯМИ'):current?'НА ПАУЗЕ':'ВАША МУЗЫКА. ВАШ РИТМ.';
  const interludePlaying=playing&&kind!=='song';$('preview').innerHTML=icon(interludePlaying?'pause':'play');$('preview').setAttribute('aria-label',interludePlaying?'Пауза проигрыша':'Прослушать проигрыш');
}
function refreshPlayback(){
  updatePlaylistSummary();
  const activeSong=engine.active?.item.kind==='song';
  $('elapsed').textContent=fmt(trackPosition(current,audio.currentTime));$('duration').textContent=fmt(trackLength(current));
  $('seek').max=Number.isFinite(trackLength(current))?trackLength(current):0;$('seek').value=trackPosition(current,audio.currentTime);$('seek').disabled=!activeSong||!Number.isFinite(audio.duration);
  if(activeSong&&Number.isFinite(audio.duration)&&!durations.has(current.id)){durations.set(current.id,audio.duration);renderQueue();}
  $('interlude-time').textContent=fmt(interlude.currentTime);$('interlude-duration').textContent=fmt(interlude.duration);
  $('interlude-seek').max=Number.isFinite(interlude.duration)?interlude.duration:0;$('interlude-seek').value=interlude.currentTime;
  $('interlude-seek').disabled=engine.active?.media!==interlude||!Number.isFinite(interlude.duration);
}
setInterval(()=>{engine.tick();refreshPlayback();},50);
function stopInterlude(){
  if(engine.active?.item.kind!=='song'){engine.reset();if(current)engine.load(songItem(current));}
  pending=null;isPreview=false;
}
function loadTrack(track,play=false){if(!track)return;pending=null;isPreview=false;engine.load(songItem(track),play);}
function nextTrack(direction=1,automatic=false,from=current){if(!from)return order[0];if(automatic&&repeat===1)return from;const i=queueIndex(from)+direction;if(i>=0&&i<order.length)return order[i];return (repeat===2||!automatic)&&order.length?order[(i+order.length)%order.length]:null;}
function go(direction){if(!order.length)return;if(direction===-1&&engine.active?.item.kind==='song'&&trackPosition(current,audio.currentTime)>3){engine.seek(audio,trackBounds(current).start||0);return;}loadTrack(nextTrack(direction),true);}
function togglePlay(){
  if(engine.active?.item.kind==='preview'&&engine.active.media.ended){if(current)loadTrack(current,true);return;}
  if(!engine.active){if(order.length)loadTrack(order[0],true);else message('Сначала выберите папку с музыкой.');return;}
  if(engine.paused)engine.play();else engine.pause();
}
function randomize(list){const copy=[...list];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
function updateRepeat(){const labels=['Повтор выключен','Повтор одной песни','Повтор всего списка'];$('repeat').classList.toggle('on',repeat!==0);$('repeat').title=labels[repeat];$('repeat').setAttribute('aria-label',labels[repeat]);$('repeat').setAttribute('aria-pressed',String(repeat!==0));$('repeat').innerHTML=icon('repeat')+(repeat===1?'<sup>1</sup>':'');}

$('choose-folder').onclick=()=>{if(!busy)$('music-files').click();};
$('music-files').onchange=async()=>{
  const selected=Array.from($('music-files').files||[]);if(!selected.length)return;
  busy=true;$('choose-folder').disabled=true;let added=0,failures=0;
  try{
    for(const [index,file] of selected.entries()){
      message('Добавляем треки: '+(index+1)+'/'+selected.length);
      try{
        const result=await BrowserLibrary.add(file);if(result.added)added++;
      }catch{failures++;}
    }
    applyLibrary(await api('/api/library'));message('Добавлено: '+added+(failures?' · Не удалось добавить: '+failures:''));
  }catch(e){message(e.message);}finally{busy=false;$('choose-folder').disabled=false;$('music-files').value='';}
};
$('search').oninput=renderQueue;
$('play').onclick=togglePlay;$('previous').onclick=()=>go(-1);$('next').onclick=()=>go(1);
$('shuffle').onclick=()=>{shuffled=!shuffled;rebuildQueue(shuffled);updateShuffleButton();};

function refreshHalfPlayback(){
  const playing=!engine.paused;
  if(current&&!order.some(t=>t.id===current.id)){
    if(order.length)loadTrack(order[0],playing);
    else{engine.reset();current=null;$('track-title').textContent='Нет песен для воспроизведения';$('track-subtitle').textContent='Все песни отмечены дизлайком';updateControls();}
  }
  for(const channel of [engine.active,engine.fade?.out])if(channel?.item.kind==='song')channel.item.half=halfQueue;
  if(engine.active?.item.kind==='interlude')engine.active.item.after=order.find(t=>t.queueId===engine.active.item.after?.queueId)||order[0]||null;
}
function updateHalfButton(){$('queue-half').setAttribute('aria-pressed',String(halfQueue));$('queue-half').classList.toggle('on',halfQueue);}
$('queue-half').onclick=()=>{
  halfQueue=!halfQueue;save('half-queue',halfQueue);updateHalfButton();
  const previous=[...order];
  rebuildQueue(true);
  const ranks=new Map(previous.map((t,i)=>[t.queueId,i]));
  order.sort((a,b)=>(ranks.get(a.queueId)??Infinity)-(ranks.get(b.queueId)??Infinity));
  refreshHalfPlayback();engine.invalidate();renderQueue();updatePlaylistSummary();
};
updateHalfButton();
$('queue-shuffle').innerHTML=icon('shuffle');
$('queue-shuffle').onclick=()=>{
  if(!tracks.length)return message('Сначала выберите папку с музыкой.');
  shuffled=true;rebuildQueue(false);updateShuffleButton();
  startQueuePlayback();
};
function startQueuePlayback(){
  interludeQueue=randomize(interludeQueue);
  const starred=interludeQueue.findIndex(t=>t.id===starredInterlude);
  if(startWithInterlude&&starred>0)interludeQueue.unshift(interludeQueue.splice(starred,1)[0]);
  interludeChanged();
  const intro=startWithInterlude?nextInterlude():null;
  if(intro){loadTrack(order[0],false);engine.load({kind:'interlude',src:intro.url,interludeId:intro.id,after:order[0]},true);}
  else loadTrack(order[0],true);
}
$('duplicate-liked').checked=duplicateLiked;$('weighted-shuffle').checked=weightedShuffle;
$('duplicate-liked').onchange=()=>{duplicateLiked=$('duplicate-liked').checked;save('duplicate-liked',duplicateLiked);updateChanceSettings();rebuildQueue(false);};
$('weighted-shuffle').onchange=()=>{weightedShuffle=$('weighted-shuffle').checked;save('weighted-shuffle',weightedShuffle);updateChanceSettings();engine.invalidate();};
function updateChanceSettings(){
  $('duplicate-count').disabled=!duplicateLiked;$('weight-factor').disabled=!weightedShuffle;
  $('duplicate-count-value').textContent=duplicateCount;$('weight-factor-value').textContent=weightFactor.toLocaleString('ru-RU',{maximumFractionDigits:1});
  const factor=weightedShuffle?weightFactor:1,weights=[(duplicateLiked?duplicateCount:1)*factor,1,1/factor],total=weights.reduce((a,b)=>a+b,0);
  for(const [i,id]of ['chance-like','chance-neutral','chance-dislike'].entries()){
    const kind=i===2?'dislike':'like';$(id).innerHTML=icon(kind)+'<span>'+(weights[i]/total*100).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+'%</span>';
    $(id).setAttribute('aria-label',['Нравится','Без отметки','Не нравится'][i]+': '+(weights[i]/total*100).toFixed(1)+'%');
  }
}
$('duplicate-count').value=duplicateCount;$('weight-factor').value=weightFactor;
$('duplicate-count').oninput=()=>{duplicateCount=Number($('duplicate-count').value);save('duplicate-count',duplicateCount);updateChanceSettings();rebuildQueue(false);};
$('weight-factor').oninput=()=>{weightFactor=Number($('weight-factor').value);save('weight-factor',weightFactor);updateChanceSettings();engine.invalidate();};
updateChanceSettings();
$('repeat').onclick=()=>{repeat=repeat===0?2:repeat===2?1:0;save('repeat',repeat);updateRepeat();};updateRepeat();
function setVolume(value){engine.setVolume(value);$('volume-value').textContent=Math.round(engine.volume*100)+'%';}
$('volume').value=read('volume',.7);setVolume(Number($('volume').value));$('volume').oninput=()=>{setVolume(Number($('volume').value));save('volume',engine.volume);};
$('seek').oninput=()=>engine.seek(audio,(trackBounds(current).start||0)+Number($('seek').value));
// Persist File objects, not temporary blob URLs; preserve the legacy single file.
let interludeRevision=0,interludeWrites=Promise.resolve(),draggedInterlude=null;
function storedInterlude(snapshot){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('static-player-interludes',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('files',snapshot?'readwrite':'readonly'),store=tx.objectStore('files');let result;
      if(snapshot){store.put(snapshot,'interlude-queue');store.delete('interlude');}
      else{const get=store.get('interlude-queue');get.onsuccess=()=>{if(get.result!==undefined)result=get.result;else{const legacy=store.get('interlude');legacy.onsuccess=()=>{result=legacy.result?[{id:crypto.randomUUID(),file:legacy.result}]:[];};}};}
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error||Error('Storage unavailable'));};db.onversionchange=()=>db.close();
    };
  });
}
function persistInterludes(){
  const snapshot=interludeQueue.map(({id,file})=>({id,file}));
  interludeWrites=interludeWrites.catch(()=>{}).then(()=>storedInterlude(snapshot)).catch(()=>message('Не удалось сохранить очередь проигрышей в браузере.'));
}
function nextInterlude(){return interludeQueue.find(t=>t.id===interludeNextId)||interludeQueue[0];}
function refreshInterludeSelection(){
  engine.invalidate();const next=nextInterlude();interludeUrl=next?.url||'';
  if(!engine.active||engine.active.item.kind==='song'){
    interlude=new Audio();interlude.preload='metadata';if(next)interlude.src=next.url;
  }
  renderInterludeQueue();
}
function selectedInterlude(){return (engine.active?.item.kind!=='song'&&!engine.active?.media.ended?interludeQueue.find(t=>t.id===engine.active?.item.interludeId):null)||nextInterlude();}
$('interlude-star').innerHTML=starIcon;
$('interlude-star').onclick=()=>{const selected=selectedInterlude();if(!selected)return;starredInterlude=starredInterlude===selected.id?null:selected.id;save('starred-interlude',starredInterlude);renderInterludeQueue();};
$('start-with-interlude').checked=startWithInterlude;
$('start-with-interlude').onchange=()=>{startWithInterlude=$('start-with-interlude').checked;save('start-with-interlude',startWithInterlude);};
function renderInterludeQueue(){
  const active=engine.active?.item.kind!=='song'&&!engine.active?.media.ended?interludeQueue.find(t=>t.id===engine.active?.item.interludeId):null;
  const selected=active||nextInterlude();
  $('interlude-star').disabled=!selected;$('interlude-star').setAttribute('aria-pressed',String(!!selected&&selected.id===starredInterlude));
  $('interlude-name').textContent=selected?.file.name||'Ваш проигрыш';
  $('interlude-description').textContent=selected?(active?'Сейчас играет':'Следующий проигрыш'):'Добавьте аудиофайлы';
  $('preview').disabled=!selected;$('interlude-previous').disabled=$('interlude-next').disabled=interludeQueue.length<2;$('interlude-count').textContent=interludeQueue.length;$('interlude-shuffle').disabled=interludeQueue.length<2;
  const box=$('interlude-queue');box.replaceChildren();
  for(const entry of interludeQueue){
    const row=document.createElement('div');row.className='interlude-row'+(selected?.id===entry.id?' selected':'');
    const handle=document.createElement('button');handle.className='drag-handle';handle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';handle.draggable=true;handle.title='Перетащите для изменения порядка; стрелки вверх/вниз';handle.setAttribute('aria-label','Переместить '+entry.file.name);
    handle.ondragstart=e=>{draggedInterlude=entry.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',entry.id);};handle.ondragend=()=>{draggedInterlude=null;};
    handle.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const from=interludeQueue.findIndex(t=>t.id===entry.id),target=interludeQueue[from+(e.key==='ArrowUp'?-1:1)];if(target)moveInterlude(entry.id,target.id);}};
    row.ondragover=e=>{if(draggedInterlude){e.preventDefault();e.dataTransfer.dropEffect='move';}};
    row.ondrop=e=>{e.preventDefault();if(draggedInterlude)moveInterlude(draggedInterlude,entry.id);draggedInterlude=null;};
    const name=document.createElement('span');name.className='interlude-row-name';name.textContent=entry.file.name;name.title=entry.file.name;
    const remove=document.createElement('button');remove.className='delete-interlude';remove.title='Удалить из очереди';remove.setAttribute('aria-label','Удалить '+entry.file.name);remove.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';remove.onclick=()=>removeInterlude(entry.id);
    row.append(handle,name);if(entry.id===starredInterlude){const star=document.createElement('span');star.className='interlude-star-mark';star.innerHTML=starIcon;star.setAttribute('role','img');star.setAttribute('aria-label','Начальный проигрыш');row.append(star);}row.append(remove);box.append(row);
  }
}
function moveInterlude(id,targetId){
  const from=interludeQueue.findIndex(t=>t.id===id),to=interludeQueue.findIndex(t=>t.id===targetId);if(from<0||to<0||from===to)return;
  interludeQueue.splice(to,0,interludeQueue.splice(from,1)[0]);interludeChanged();
}
function interludeChanged(){
  interludeRevision++;interludeNextId=interludeQueue[0]?.id||null;save('interlude-next',interludeNextId);refreshInterludeSelection();persistInterludes();
}
function removeInterlude(id){
  const entry=interludeQueue.find(t=>t.id===id);if(!entry)return;
  if(starredInterlude===id){starredInterlude=null;save('starred-interlude',null);}
  const playing=engine.active?.item.interludeId===id;
  if(playing){const next=engine.active.item.after,wasPlaying=!engine.paused;engine.reset();if(next)loadTrack(next,wasPlaying);else if(current)loadTrack(current,false);else updateControls();}
  if(engine.fade?.out.item.interludeId===id){engine.dispose(engine.fade.out);engine.fade=null;engine.applyGain();}
  interludeQueue=interludeQueue.filter(t=>t.id!==id);engine.invalidate();URL.revokeObjectURL(entry.url);
  if(!interludeQueue.length){$('interlude-enabled').checked=false;save('interlude-enabled',false);}
  interludeChanged();
}
$('interlude-file').onchange=()=>{
  const files=Array.from($('interlude-file').files||[]).filter(f=>/\.(mp3|wav|flac)$/i.test(f.name));if(!files.length)return;
  for(const file of files)interludeQueue.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file)});
  $('interlude-enabled').checked=true;save('interlude-enabled',true);$('interlude-file').value='';interludeChanged();
};
async function restoreInterlude(){const revision=interludeRevision;try{const saved=await storedInterlude();if(revision!==interludeRevision)return;interludeQueue=(saved||[]).map(t=>({...t,url:URL.createObjectURL(t.file)}));interludeNextId=read('interlude-next',null);$('interlude-enabled').checked=interludeQueue.length>0&&read('interlude-enabled',true);refreshInterludeSelection();}catch{$('interlude-description').textContent='Хранилище недоступно. Добавьте файлы';}}
restoreInterlude();
$('interlude-seek').oninput=()=>engine.seek(interlude,Number($('interlude-seek').value));
$('preview').innerHTML=icon('play');$('interlude-previous').innerHTML=icon('previous');$('interlude-next').innerHTML=icon('next');
$('interlude-add').onclick=()=>$('interlude-file').click();
function skipInterlude(direction){
  if(!interludeQueue.length)return;
  const active=engine.active;
  const inInterlude=active&&active.item.kind!=='song'&&!active.media.ended;
  const selected=inInterlude?interludeQueue.find(t=>t.id===active.item.interludeId):nextInterlude();
  const index=interludeQueue.indexOf(selected),entry=interludeQueue[(index+direction+interludeQueue.length)%interludeQueue.length];
  interludeNextId=entry.id;save('interlude-next',interludeNextId);
  if(inInterlude){const item={...active.item,src:entry.url,interludeId:entry.id};engine.load(item,!engine.paused);}
  else refreshInterludeSelection();
}
$('interlude-previous').onclick=()=>skipInterlude(-1);$('interlude-next').onclick=()=>skipInterlude(1);
$('preview').onclick=()=>{if(engine.active?.item.kind!=='song'&&engine.active&&!engine.active.media.ended){if(engine.paused)engine.play();else engine.pause();return;}const entry=nextInterlude();if(entry)engine.load({kind:'interlude',src:entry.url,interludeId:entry.id,after:current||order[0]||null},true);};
$('interlude-enabled').onchange=()=>{
  if(!$('interlude-enabled').checked&&engine.active?.item.kind==='interlude'){const next=engine.active.item.after;engine.reset();if(next)loadTrack(next,true);else updateControls();}
  else if($('interlude-enabled').checked&&!interludeQueue.length){$('interlude-enabled').checked=false;$('interlude-file').click();}
  engine.invalidate();save('interlude-enabled',$('interlude-enabled').checked);
};
$('interlude-shuffle').innerHTML=icon('shuffle');$('interlude-shuffle').onclick=()=>{interludeQueue=randomize(interludeQueue);interludeChanged();};
let interludeHidden=read('interlude-hidden',false);
function updateInterludeVisibility(){
  $('interlude-queue').hidden=interludeHidden;
  $('interlude-toggle').innerHTML=interludeHidden?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 9q9 12 18 0M5 12l-2 3m6-1-1 4m7-4 1 4m3-6 2 3"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  $('interlude-toggle').setAttribute('aria-expanded',String(!interludeHidden));const label=interludeHidden?'Показать очередь проигрышей':'Скрыть очередь проигрышей';$('interlude-toggle').setAttribute('aria-label',label);$('interlude-toggle').title=label;
}
$('interlude-toggle').onclick=()=>{interludeHidden=!interludeHidden;save('interlude-hidden',interludeHidden);updateInterludeVisibility();};updateInterludeVisibility();
let editingTrack=null,editReaction=null,editDuration=null,editReset=false,editProbe=null,editToken=0;
const trackDialog=$('track-dialog');
function renderEditReaction(){for(const kind of ['like','dislike']){const button=$('edit-'+kind);button.innerHTML=icon(kind);button.setAttribute('aria-pressed',String(editReaction===kind));button.classList.toggle('selected',editReaction===kind);}}
function updateTrimInputs(start,end){
  for(const [id,value]of [['trim-start',start],['trim-end',end],['trim-start-number',start],['trim-end-number',end]])$(id).value=Math.round(value*10)/10;
  $('trim-info').textContent=fmt(start)+' → '+fmt(end)+' · '+fmt(end-start);
}
function setEditorDuration(duration){
  if(!Number.isFinite(duration)||duration<.1){$('trim-info').textContent='Длительность недоступна. Можно изменить название и исполнителя.';return;}
  editDuration=Math.floor(duration*10)/10;
  for(const id of ['trim-start','trim-end','trim-start-number','trim-end-number']){$(id).disabled=false;$(id).max=editDuration;}
  const edit=editReset?{}:trackEdits[editingTrack.id]||{};
  const start=Math.min(edit.start||0,Math.max(0,editDuration-.1)),end=Math.max(start+.1,Math.min(edit.end??editDuration,editDuration));updateTrimInputs(start,end);
}
$('current-track-menu').onclick=()=>{if(current)openTrackEditor(current);};
$('edit-volume').oninput=()=>{$('edit-volume-value').textContent=$('edit-volume').value+'%';};
async function openTrackEditor(track){
  $('edit-volume').value=Math.round((trackEdits[track.id]?.volume??1)*100);$('edit-volume').oninput();
  editingTrack=tracks.find(t=>t.id===track.id)||track;editReaction=reactions[track.id]||null;editDuration=null;editReset=false;
  const token=++editToken;editProbe?.abort();editProbe=new AbortController();
  $('edit-name').value=trackName(track);$('edit-artist').value=trackArtist(track);$('edit-error').textContent='';
  for(const id of ['trim-start','trim-end','trim-start-number','trim-end-number']){$(id).disabled=true;$(id).value=0;}
  $('trim-info').textContent='Определяем длительность…';renderEditReaction();trackDialog.showModal();
  const duration=durations.get(track.id)??await readDuration(track,editProbe.signal);
  if(token!==editToken||!trackDialog.open)return;
  if(duration!==null&&Number.isFinite(duration)){durations.set(track.id,duration);setEditorDuration(duration);}else setEditorDuration(NaN);
}
function closeTrackEditor(){editToken++;editProbe?.abort();trackDialog.close();}
$('track-close').onclick=closeTrackEditor;trackDialog.addEventListener('cancel',()=>{editToken++;editProbe?.abort();});
$('reset-name').onclick=()=>{$('edit-name').value=editingTrack.name;};$('reset-artist').onclick=()=>{$('edit-artist').value=editingTrack.artist||'';};
for(const kind of ['like','dislike'])$('edit-'+kind).onclick=()=>{editReaction=editReaction===kind?null:kind;renderEditReaction();};
for(const id of ['trim-start','trim-end','trim-start-number','trim-end-number'])$(id).oninput=()=>{
  if(editDuration===null)return;let start=Number($('trim-start').value),end=Number($('trim-end').value);
  if(id.includes('start'))start=Math.max(0,Math.min(Number($(id).value)||0,end-.1));else end=Math.min(editDuration,Math.max(Number($(id).value)||0,start+.1));
  updateTrimInputs(start,end);
};
$('track-reset').onclick=()=>{
  editReset=true;
  $('edit-volume').value=100;$('edit-volume').oninput();
  $('edit-name').value=editingTrack.name;$('edit-artist').value=editingTrack.artist||'';editReaction=null;renderEditReaction();
  if(editDuration!==null)updateTrimInputs(0,editDuration);
};
$('track-form').onsubmit=e=>{
  e.preventDefault();if(!editingTrack)return;
  const name=$('edit-name').value.trim(),artist=$('edit-artist').value.trim();
  if(!name){$('edit-error').textContent='Введите название песни.';return;}
  const edit={};const volume=Math.max(.5,Math.min(2,Number($('edit-volume').value)/100||1));if(volume!==1)edit.volume=volume;if(name!==editingTrack.name)edit.name=name;if(artist!==(editingTrack.artist||''))edit.artist=artist;
  if(editDuration!==null){const start=Number($('trim-start').value),end=Number($('trim-end').value);if(!(start>=0&&end>start&&end<=editDuration)){ $('edit-error').textContent='Конец должен быть позже начала.';return;}if(start>0)edit.start=start;if(end<editDuration)edit.end=end;}
  else if(!editReset){const old=trackEdits[editingTrack.id];if(old?.start)edit.start=old.start;if(old?.end!=null)edit.end=old.end;}
  const id=editingTrack.id,old=trackEdits[id]||{},reactionChanged=(reactions[id]||null)!==editReaction;
  const trimChanged=(old.start||0)!==(edit.start||0)||(old.end??null)!==(edit.end??null);
  if(Object.keys(edit).length)trackEdits[id]=edit;else delete trackEdits[id];
  if(editReaction)reactions[id]=editReaction;else delete reactions[id];
  save('track-edits',trackEdits);save('track-reactions',reactions);
  syncStatsTrack(editingTrack);save('stats',stats);
  if(reactionChanged)updateReactionQueue(id);else{engine.invalidate();renderQueue();updatePlaylistSummary();}updateReactions();
  if(current?.id===id){$('track-title').textContent=trackName(current);$('track-subtitle').textContent=trackArtist(current)||'Неизвестный исполнитель';if(trimChanged&&engine.active?.item.kind==='song'){
    const channel=engine.active;channel.item.start=edit.start||0;channel.item.end=edit.end??null;
    const {start,end}=engine.bounds(channel),position=channel.media.currentTime;
    if(position<start||position>end)engine.seek(channel.media,position);
    updatePlaylistSummary();
  }}
  for(const channel of [engine.active,engine.fade?.out])if(channel?.item.kind==='song'&&channel.item.track.id===id)channel.item.gain=edit.volume??1;engine.applyGain();
  renderStats();renderPlaylists();closeTrackEditor();
};
const settingsDialog=$('settings-dialog');
$('settings-open').onclick=()=>settingsDialog.showModal();$('settings-close').onclick=()=>settingsDialog.close();
settingsDialog.addEventListener('click',e=>{if(e.target===settingsDialog){const r=settingsDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)settingsDialog.close();}});
$('dark-theme').checked=read('dark-theme',false);
function applyTheme(){document.documentElement.dataset.theme=$('dark-theme').checked?'dark':'light';save('dark-theme',$('dark-theme').checked);}
$('dark-theme').onchange=applyTheme;applyTheme();
// Migrate the old toggle without enabling a previously disabled transition.
for(const [id,kind] of [['song-no-fade','song'],['interlude-no-fade','interlude']]){
  $(id).checked=!read(id,false);
  const apply=()=>{engine.setNoFade(kind,!$(id).checked);save(id,!$(id).checked);};
  $(id).onchange=apply;apply();
}
let savedFade=read('crossfade-seconds',0);
if(!read('crossfade-slider-only',false)){
  if(!read('crossfade-enabled',false))savedFade=0;
  save('crossfade-seconds',savedFade);save('crossfade-slider-only',true);
}
$('crossfade-seconds').value=Math.max(0,Math.min(5,Number(savedFade)||0));
function applyFade(){const seconds=Number($('crossfade-seconds').value);$('crossfade-value').textContent=seconds===0?'0 сек — выключено':seconds+' сек';engine.setFade(seconds);save('crossfade-seconds',seconds);}
$('crossfade-seconds').oninput=applyFade;applyFade();
$('interlude-crossfade-seconds').value=Math.max(0,Math.min(5,Number(read('interlude-crossfade-seconds',savedFade))||0));
function applyInterludeFade(){const seconds=Number($('interlude-crossfade-seconds').value);$('interlude-crossfade-value').textContent=seconds===0?'0 сек — выключено':seconds+' сек';engine.setInterludeFade(seconds);save('interlude-crossfade-seconds',seconds);}
$('interlude-crossfade-seconds').oninput=applyInterludeFade;applyInterludeFade();
function statRow(rank,name,value){const row=document.createElement('div');row.className='stat-row';for(const [i,text]of [rank,name,value].entries()){const cell=document.createElement('span');cell.textContent=text;if(i===1)cell.className='stat-name';row.append(cell);}return row;}
function listeningTime(value){const seconds=Math.max(0,Math.floor(value));return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');}
let statsSort=read('stats-sort','time')==='plays'?'plays':'time';
function fullListens(song){return Number.isFinite(song.duration)&&song.duration>0?Math.floor(song.seconds/song.duration+1e-9):null;}
function statsMetric(song){return statsSort==='plays'?(fullListens(song)??0):song.seconds;}
function updateStatsSort(){
  const plays=statsSort==='plays',label=plays?'По полным прослушиваниям. Нажмите для сортировки по времени':'По времени. Нажмите для сортировки по полным прослушиваниям';
  $('stats-sort').title=label;$('stats-sort').setAttribute('aria-label',label);
  $('stats-sort').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(plays?'<path d="M3 5h10M3 10h7M3 15h4m11-10v14m-3-3 3 3 3-3"/><path d="m9 16 4 2-4 2z"/>':'<circle cx="9" cy="10" r="6"/><path d="M9 6v4l3 2m8-6v14m-3-3 3 3 3-3"/>')+'</svg>';
}
$('stats-sort').onclick=()=>{statsSort=statsSort==='time'?'plays':'time';save('stats-sort',statsSort);updateStatsSort();$('stats').scrollTop=0;renderStats();};updateStatsSort();
function renderStats(){
  const box=$('stats'),scroll=box.scrollTop;box.replaceChildren();
  const entries=Object.values(stats.songs).filter(song=>Number.isFinite(song.seconds)&&song.seconds>=1).sort((a,b)=>statsMetric(b)-statsMetric(a)||b.seconds-a.seconds);
  if(!entries.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Пока нет прослушанных песен';box.append(empty);return;}
  const maximum=Math.max(1,statsMetric(entries[0]));
  for(const song of entries){
    const row=document.createElement('div');row.className='listening-stat';
    const heading=document.createElement('div');heading.className='listening-stat-heading';const name=document.createElement('span');name.className='listening-stat-name';name.textContent=song.name;name.title=song.name;heading.append(name);
    if(song.reaction==='like'||song.reaction==='dislike'){const badge=document.createElement('span');badge.className='track-reaction '+song.reaction;badge.innerHTML=icon(song.reaction);badge.setAttribute('role','img');badge.setAttribute('aria-label',song.reaction==='like'?'Нравится':'Не нравится');heading.append(badge);}
    const values=document.createElement('div');values.className='listening-stat-values';const count=fullListens(song)??'—';values.textContent=listeningTime(song.seconds)+' / '+count;values.title=count==='—'?'Выберите папку с этой песней, чтобы определить её длительность':'Целая часть времени прослушивания, делённого на полную длительность файла';
    const bar=document.createElement('progress');bar.className='listening-stat-bar';bar.max=maximum;bar.value=statsMetric(song);bar.setAttribute('aria-label',statsSort==='plays'?'Полные прослушивания относительно лидера':'Время относительно самой прослушиваемой песни');
    row.append(heading,values,bar);box.append(row);
  }
  box.scrollTop=scroll;
}
let clearStatsDeadline=0,clearStatsTimer=null;
const clearStatsDialog=$('clear-stats-dialog');
function updateClearStatsButton(){const left=Math.max(0,Math.ceil((clearStatsDeadline-Date.now())/1000));$('clear-stats-confirm').disabled=left>0;$('clear-stats-confirm').textContent=left?'Очистить ('+left+')':'Очистить';if(left>0)clearStatsTimer=setTimeout(updateClearStatsButton,100);}
function cancelClearStats(){clearTimeout(clearStatsTimer);clearStatsDeadline=0;clearStatsDialog.close();}
$('clear-stats-open').onclick=()=>{clearTimeout(clearStatsTimer);clearStatsDeadline=Date.now()+2000;clearStatsDialog.showModal();updateClearStatsButton();};
$('clear-stats-cancel').onclick=cancelClearStats;clearStatsDialog.addEventListener('cancel',cancelClearStats);
$('clear-stats-confirm').onclick=()=>{
  if(!clearStatsDialog.open||!clearStatsDeadline||Date.now()<clearStatsDeadline)return;
  stats={songs:{},days:{},seconds:0};
  for(const channel of [engine.active,engine.fade?.out])if(channel)channel.last=channel.media.currentTime;
  save('stats',stats);renderStats();cancelClearStats();
};
document.addEventListener('keydown',e=>{if($('playlist-delete-dialog').open||$('playlist-dialog').open||clearStatsDialog.open||$('track-dialog').open||settingsDialog.open||['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(['ArrowLeft','ArrowRight'].includes(e.code)&&Number.isFinite(audio.duration)){e.preventDefault();engine.seek(audio,audio.currentTime+(e.code==='ArrowRight'?5:-5));}});
setInterval(()=>save('stats',stats),10000);setInterval(renderStats,1000);window.addEventListener('pagehide',()=>save('stats',stats));

let libraryTracks=[],playlists=read('playlists',[]),activePlaylist=read('active-playlist','all'),playlistSelection=new Set(),editingPlaylist=null,draggedPlaylist=null;
function playlistMembers(id){const ids=playlists.find(p=>p.id===id)?.tracks||[];return id==='all'?libraryTracks:ids.map(id=>libraryTracks.find(t=>t.id===id)).filter(Boolean);}

const folderSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7V5h7l2 3h9v12H3Z"/></svg>';
const dotsSvg='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
const gripSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const trashSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
let playlistOrder=read('playlist-order',[]);
function sortedPlaylists(){const list=[{id:'all',name:'Все песни'},...playlists],fallback=list.map(p=>p.id);const rank=id=>{const n=playlistOrder.indexOf(id);return n<0?playlistOrder.length+fallback.indexOf(id):n;};return list.sort((a,b)=>rank(a.id)-rank(b.id));}
function movePlaylist(id,target){
  const ids=sortedPlaylists().map(p=>p.id);if(id===target||!ids.includes(id)||!ids.includes(target))return;
  ids.splice(ids.indexOf(id),1);ids.splice(ids.indexOf(target)+1,0,id);playlistOrder=ids;save('playlist-order',ids);renderPlaylists();
}
function playlistSummary(id){
  const members=playlistMembers(id),known=members.every(t=>Number.isFinite(trackBounds(t,false).length));
  const minutes=Math.floor(members.reduce((sum,t)=>sum+(trackBounds(t,false).length||0),0)/60);
  return members.length+' / '+(known?String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'):'…');
}
function renderPlaylists(){
  if(draggedPlaylist)return;
  $('playlist-list').replaceChildren();
  for(const playlist of sortedPlaylists()){
    const row=document.createElement('div');row.className='queue-entry playlist-entry';row.classList.toggle('active',playlist.id===activePlaylist);
    const handle=document.createElement('button');handle.className='playlist-handle';handle.innerHTML='<span class="playlist-folder">'+folderSvg+'</span><span class="playlist-grip">'+gripSvg+'</span>';handle.draggable=true;
    handle.title='Перетащить плейлист';handle.setAttribute('aria-label','Переместить '+playlist.name);
    handle.ondragstart=e=>{draggedPlaylist=playlist.id;e.dataTransfer.setData('text/plain',playlist.id);e.dataTransfer.effectAllowed='move';row.classList.toggle('dragging',true);};
    handle.ondragend=()=>{draggedPlaylist=null;renderPlaylists();};
    row.ondragover=e=>{if(draggedPlaylist&&draggedPlaylist!==playlist.id){e.preventDefault();row.classList.toggle('drop-after',true);}};
    row.ondragleave=()=>row.classList.toggle('drop-after',false);
    row.ondrop=e=>{e.preventDefault();const id=draggedPlaylist;draggedPlaylist=null;if(id)movePlaylist(id,playlist.id);};
    handle.onkeydown=e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const ids=sortedPlaylists().map(p=>p.id),from=ids.indexOf(playlist.id),to=from+(e.key==='ArrowUp'?-1:1);if(to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to],ids[from]];playlistOrder=ids;save('playlist-order',ids);renderPlaylists();};
    const button=document.createElement('button');button.className='playlist-play';button.onclick=()=>selectPlaylist(playlist.id,true);
    const name=document.createElement('span');name.textContent=playlist.name;name.title=playlist.name;
    const count=document.createElement('small');count.className='playlist-total';count.textContent=playlistSummary(playlist.id);count.title='Количество песен / длительность, часы:минуты';
    button.append(name,count);
    const menu=document.createElement('button');menu.className='track-menu';menu.innerHTML=dotsSvg;menu.setAttribute('aria-label','Редактировать '+playlist.name);menu.onclick=()=>openPlaylistEditor(playlist.id);
    row.append(handle,button,menu);$('playlist-list').append(row);
  }
}
function selectPlaylist(id,play=false){
  if(id!=='all'&&!playlists.some(p=>p.id===id))id='all';
  activePlaylist=id;save('active-playlist',id);tracks=playlistMembers(id);
  engine.reset();current=null;shuffled=play;updateShuffleButton();rebuildQueue();
  if(order.length){if(play)startQueuePlayback();else loadTrack(order[0],false);}
  else{$('track-title').textContent='В плейлисте пока нет песен';$('track-subtitle').textContent='Добавьте треки в коллекцию';updateControls();}
  renderPlaylists();scanDurations(libraryTracks);
}
function applyLibrary(result){
  libraryTracks=result.tracks;libraryTracks.forEach(syncStatsTrack);
  save('stats-identities',statsIdentities);save('stats',stats);
  if(!current)selectPlaylist(activePlaylist,false);
  else{tracks=playlistMembers(activePlaylist);rebuildQueue(true);renderPlaylists();scanDurations(libraryTracks);}
  message('Всего треков: '+libraryTracks.length+(result.missing?' · Недоступно: '+result.missing:''));
}
function renderPlaylistChoices(){
  const query=$('playlist-search').value.toLocaleLowerCase();$('playlist-tracks').replaceChildren();
  for(const track of libraryTracks.filter(t=>(trackName(t)+' '+trackArtist(t)).toLocaleLowerCase().includes(query)).sort((a,b)=>Number(playlistSelection.has(b.id))-Number(playlistSelection.has(a.id)))){
    const row=document.createElement(editingPlaylist==='all'?'div':'button');row.type='button';row.className='playlist-choice';const selected=playlistSelection.has(track.id);
    row.classList.toggle('selected',selected);row.setAttribute('aria-pressed',String(selected));
    const text=document.createElement('span'),name=document.createElement('strong'),artist=document.createElement('small');
    name.textContent=trackName(track);artist.textContent=trackArtist(track)||'Неизвестный исполнитель';text.append(name,artist);
    const mark=document.createElement(editingPlaylist==='all'?'button':'span');mark.className='playlist-mark';if(editingPlaylist==='all'){mark.innerHTML=trashSvg;mark.type='button';mark.setAttribute('aria-label','Удалить из коллекции: '+trackName(track));mark.onclick=()=>removeLibraryTrack(track.id);}else mark.textContent=selected?'✓':'+';row.append(text,mark);
    row.onclick=async()=>{if(editingPlaylist==='all')return;if(selected)playlistSelection.delete(track.id);else playlistSelection.add(track.id);renderPlaylistChoices();};
    $('playlist-tracks').append(row);
  }
  if(!$('playlist-tracks').children.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=libraryTracks.length?'Ничего не найдено':'Сначала добавьте треки кнопкой папки.';$('playlist-tracks').append(empty);}
}

function openPlaylistEditor(id=null){
  editingPlaylist=id;const playlist=playlists.find(p=>p.id===id);playlistSelection=new Set(playlist?.tracks||[]);
  $('playlist-dialog-title').textContent=id?'Редактировать плейлист':'Новый плейлист';
  $('playlist-name').value=id==='all'?'Все песни':playlist?.name||'';$('playlist-name').disabled=id==='all';
  $('playlist-delete').hidden=!id||id==='all';$('playlist-search').value='';$('playlist-error').textContent='';
  renderPlaylistChoices();$('playlist-dialog').showModal();
}
async function removeLibraryTrack(id){
  if(busy)return;busy=true;
  try{
    await api('/api/remove-track',{id});
    const wasPlaying=!engine.paused,wasCurrent=current?.id===id;
    libraryTracks=libraryTracks.filter(t=>t.id!==id);for(const p of playlists)p.tracks=p.tracks.filter(t=>t!==id);
    save('playlists',playlists);playlistSelection.delete(id);tracks=playlistMembers(activePlaylist);
    if(wasCurrent){engine.reset();current=null;}
    else if(engine.fade?.out.item.track?.id===id){engine.dispose(engine.fade.out);engine.fade=null;engine.applyGain();}
    rebuildQueue(true);
    if(wasCurrent){if(order.length)loadTrack(order[0],wasPlaying);else{$('track-title').textContent='В плейлисте пока нет песен';$('track-subtitle').textContent='Добавьте треки в коллекцию';updateControls();}}
    if(engine.active?.item.kind==='interlude'&&engine.active.item.after?.id===id)engine.active.item.after=order[0]||null;
    renderPlaylists();renderPlaylistChoices();message('Всего треков: '+libraryTracks.length);
  }catch(e){$('playlist-error').textContent=e.message;}finally{busy=false;}
}
$('playlist-add').onclick=()=>openPlaylistEditor();
$('playlist-search').oninput=renderPlaylistChoices;
$('playlist-close').onclick=$('playlist-cancel').onclick=()=>$('playlist-dialog').close();
$('playlist-delete').onclick=()=>{if(editingPlaylist&&editingPlaylist!=='all')$('playlist-delete-dialog').showModal();};
$('playlist-delete-cancel').onclick=()=>$('playlist-delete-dialog').close();
$('playlist-delete-confirm').onclick=()=>{
  if(!editingPlaylist||editingPlaylist==='all')return;
  const id=editingPlaylist;playlists=playlists.filter(p=>p.id!==id);save('playlists',playlists);
  playlistOrder=playlistOrder.filter(p=>p!==id);save('playlist-order',playlistOrder);
  if(activePlaylist===id){activePlaylist='all';save('active-playlist','all');tracks=libraryTracks;rebuildQueue(true);}
  $('playlist-delete-dialog').close();$('playlist-dialog').close();renderPlaylists();
};
$('playlist-form').onsubmit=e=>{
  e.preventDefault();const name=$('playlist-name').value.trim();
  if(!name){$('playlist-error').textContent='Введите название плейлиста.';return;}
  if(editingPlaylist!=='all'){
    const item={id:editingPlaylist||crypto.randomUUID(),name,tracks:[...playlistSelection]};
    const index=playlists.findIndex(p=>p.id===editingPlaylist);if(index<0)playlists.push(item);else playlists[index]=item;
    save('playlists',playlists);
    if(activePlaylist===item.id){tracks=playlistMembers(activePlaylist);if(current&&!tracks.some(t=>t.id===current.id)){engine.reset();current=null;}rebuildQueue(true);if(!current&&order.length)loadTrack(order[0],false);updateControls();}
  }
  renderPlaylists();$('playlist-dialog').close();
};
renderPlaylists();
renderStats();
api('/api/library').then(applyLibrary).catch(()=>message('Не удалось открыть хранилище браузера. Проверьте разрешения и свободное место.'));
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>message('Офлайн-кеш недоступен; приложение работает в текущей вкладке.'));



// Ambient droplets are decorative and never intercept player controls.
if(typeof requestAnimationFrame==='function'&&typeof ResizeObserver!=='undefined'){
  const layers=Array.from(document.querySelectorAll('.panel')).map(panel=>{
    const canvas=document.createElement('canvas');canvas.className='ambient-drops';canvas.setAttribute('aria-hidden','true');panel.prepend(canvas);
    const layer={canvas,ctx:canvas.getContext('2d'),width:0,height:0,drops:Array.from({length:18},()=>({x:Math.random(),y:Math.random(),r:9+Math.random()*13,phase:Math.random()*Math.PI*2,vx:(Math.random()-.5)*.035,vy:(Math.random()-.5)*.035,mass:1,cooldown:2+Math.random()*3,splitAt:Infinity}))};
    new ResizeObserver(()=>{
      const rect=panel.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
      layer.width=rect.width;layer.height=rect.height;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);layer.ctx?.setTransform(dpr,0,0,dpr,0,0);
    }).observe(panel);
    return layer;
  });
  let enabled=read('animations-enabled',!window.matchMedia('(prefers-reduced-motion: reduce)').matches),frame=0,last=0,phase=0,bass=0,baseline=0,previousEnergy=0,bins;
  function draw(now){
    if(!enabled||document.hidden){frame=0;return;}
    const dt=Math.min((now-last)/1000||0,.05);last=now;phase+=dt;
    let energy=0;
    if(engine.analyser&&!engine.paused){
      bins??=new Float32Array(engine.analyser.frequencyBinCount);engine.analyser.getFloatFrequencyData(bins);
      const hz=engine.audioContext.sampleRate/engine.analyser.fftSize;
      const low=Math.max(1,Math.floor(35/hz)),high=Math.min(bins.length-1,Math.ceil(180/hz));
      for(let i=low;i<=high;i++)energy+=Math.pow(10,bins[i]/20);
      energy/=Math.max(1,high-low+1);
    }
    // Adaptive relative bass onset: sustained bass fades instead of holding the glow.
    baseline+=(energy-baseline)*(1-Math.exp(-dt/1.2));
    const onset=Math.max(0,(energy-previousEnergy)/Math.max(.0005,baseline));
    const contrast=Math.max(0,(energy-baseline)/Math.max(.0005,baseline));
    const pulse=energy>.0001?Math.min(.75,onset*1.4+contrast*.35):0;
    previousEnergy=energy;
    bass+=(pulse-bass)*(1-Math.exp(-dt/(pulse>bass?.12:.4)));
    const dark=document.documentElement.dataset.theme==='dark';
    for(const layer of layers){
      const {ctx,width:w,height:h}=layer;if(!ctx||!w||!h)continue;ctx.clearRect(0,0,w,h);
      for(const drop of layer.drops){
        drop.cooldown=Math.max(0,drop.cooldown-dt);
        drop.vx+=Math.sin(phase*.4+drop.phase)*dt*.0005;
        drop.vy+=Math.cos(phase*.3+drop.phase)*dt*.0005;
        drop.vx=Math.max(-.025,Math.min(.025,drop.vx));drop.vy=Math.max(-.025,Math.min(.025,drop.vy));
        drop.x+=drop.vx*dt;drop.y+=drop.vy*dt;
        if(drop.x<.04||drop.x>.96){drop.vx*=-1;drop.x=Math.max(.04,Math.min(.96,drop.x));}
        if(drop.y<.04||drop.y>.96){drop.vy*=-1;drop.y=Math.max(.04,Math.min(.96,drop.y));}
      }
      for(let i=0;i<layer.drops.length;i++){
        const a=layer.drops[i];if(a.cooldown||a.mass>=4)continue;
        for(let j=i+1;j<layer.drops.length;j++){
          const b=layer.drops[j];if(b.cooldown||a.mass+b.mass>4)continue;
          if(Math.hypot((a.x-b.x)*w,(a.y-b.y)*h)>(a.r+b.r)*.8)continue;
          const area=a.r*a.r,barea=b.r*b.r,total=area+barea;
          a.x=(a.x*area+b.x*barea)/total;a.y=(a.y*area+b.y*barea)/total;
          a.vx=(a.vx*area+b.vx*barea)/total;a.vy=(a.vy*area+b.vy*barea)/total;
          a.displayR=a.r;a.r=Math.sqrt(total);a.mass+=b.mass;a.cooldown=1;
          a.splitAt=phase+5+Math.random()*7;layer.drops.splice(j,1);break;
        }
      }
      for(const a of [...layer.drops]){
        if(a.mass<2||phase<a.splitAt)continue;
        const mass=a.mass,part=Math.floor(mass/2),radius=a.r,angle=Math.random()*Math.PI*2;
        const b={...a,mass:mass-part,r:radius*Math.sqrt((mass-part)/mass),phase:a.phase+2,cooldown:3,splitAt:phase+7+Math.random()*5};
        a.mass=part;a.r=radius*Math.sqrt(part/mass);a.cooldown=3;a.splitAt=phase+7+Math.random()*5;
        const dx=Math.cos(angle),dy=Math.sin(angle);
        a.vx=-dx*.02;a.vy=-dy*.02;b.vx=dx*.02;b.vy=dy*.02;
        a.x-=dx*a.r*.25/w;a.y-=dy*a.r*.25/h;b.x+=dx*b.r*.25/w;b.y+=dy*b.r*.25/h;
        a.displayR=a.r;b.displayR=b.r;layer.drops.push(b);
      }
      for(const drop of layer.drops){
        const x=drop.x*w,y=drop.y*h;
        drop.displayR=(drop.displayR??drop.r)+(drop.r-(drop.displayR??drop.r))*(1-Math.exp(-dt*5));
        const r=drop.displayR*(1+bass*.12),glow=ctx.createRadialGradient(x,y,r*.1,x,y,r*2.7);
        glow.addColorStop(0,'rgba(95,195,255,'+((dark?.13:.10)+bass*.22)+')');
        glow.addColorStop(.45,'rgba(66,157,245,'+(.045+bass*.1)+')');glow.addColorStop(1,'rgba(66,157,245,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,r*2.7,0,Math.PI*2);ctx.fill();
        ctx.beginPath();
        for(let i=0;i<=64;i++){
          const angle=i/64*Math.PI*2;
          const radius=r*(1+.10*Math.sin(angle*3+phase*.8+drop.phase)+.06*Math.sin(angle*2-phase*.55+drop.phase));
          const px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;
          if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.fillStyle='rgba(100,190,245,'+(.035+bass*.05)+')';ctx.fill();
        ctx.strokeStyle='rgba(150,220,255,'+(.13+bass*.25)+')';ctx.lineWidth=1;ctx.stroke();
      }
    }
    frame=requestAnimationFrame(draw);
  }
  function syncAnimation(){
    enabled=$('animations-enabled').checked;save('animations-enabled',enabled);
    cancelAnimationFrame(frame);frame=0;last=0;
    for(const {canvas} of layers)canvas.hidden=!enabled;
    if(enabled&&!document.hidden)frame=requestAnimationFrame(draw);
  }
  $('animations-enabled').checked=enabled;$('animations-enabled').onchange=syncAnimation;
  document.addEventListener('visibilitychange',syncAnimation);syncAnimation();
}


if(typeof window.matchMedia==='function'){
  const compact=window.matchMedia('(max-width: 1180px)');
  const left=$('library-panel'),right=$('right-panel'),player=document.querySelector('.player');
  let open=null,trigger=null;
  function setDrawer(side,restore=false){
    open=compact.matches?side:null;
    document.body.dataset.drawer=open||'';
    left.inert=compact.matches&&open!=='left';right.inert=compact.matches&&open!=='right';
    player.inert=Boolean(open);
    $('drawer-backdrop').hidden=!open;$('drawer-close').hidden=!open;
    $('drawer-left').setAttribute('aria-expanded',String(open==='left'));
    $('drawer-right').setAttribute('aria-expanded',String(open==='right'));
    if(open)$('drawer-close').focus();
    else if(restore&&trigger&&compact.matches)trigger.focus();
  }
  for(const side of ['left','right'])$('drawer-'+side).onclick=()=>{trigger=$('drawer-'+side);setDrawer(open===side?null:side,true);};
  $('drawer-backdrop').onclick=$('drawer-close').onclick=()=>setDrawer(null,true);
  document.addEventListener('keydown',e=>{
    if(!open||document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'){e.preventDefault();setDrawer(null,true);}
    if(e.key==='Tab'){
      const panel=open==='left'?left:right;
      const focusable=[$('drawer-close'),...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[inert]'));
      const index=focusable.indexOf(document.activeElement);
      if(e.shiftKey&&index<=0){e.preventDefault();focusable.at(-1)?.focus();}
      else if(!e.shiftKey&&(index<0||index===focusable.length-1)){e.preventDefault();focusable[0].focus();}
    }
  });
  compact.addEventListener('change',()=>{const focused=document.activeElement;setDrawer(null);if(compact.matches&&(left.contains(focused)||right.contains(focused)))$('drawer-left').focus();});
  setDrawer(null);
}


$('experimental-stream-row').hidden=!engine.isIOS;
$('experimental-stream-output').checked=read('experimental-stream-output',true);
$('experimental-stream-output').onchange=()=>{
  save('experimental-stream-output',$('experimental-stream-output').checked);
  engine.pause();
  location.reload();
};
