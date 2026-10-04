const $ = s => document.querySelector(s);
const audio = $('#audio');
let library = [], queue = [], playlists = {}, activePlaylist = '', libraryView = 'Songs', current = -1, shuffle = false, repeat = false, shuffleOrder = [], shuffleRemaining = [], shuffleRecent = [], shuffleScope = '', mode = 0, panelMode = '', selectionMode = false, selectedSongIds = new Set(), barPlusPeaks = Array(29).fill(0), barPlusLevels = Array(29).fill(.18), bandAveragePlus = Array(15).fill(-58), speakerBandLevels = Array(15).fill(0), raf, audioCtx, analyser, waveAnalyser, source, lastSpeakerPulse = 0;
let folder = localStorage.getItem('aurora-folder') || '';
try { playlists = JSON.parse(localStorage.getItem('aurora-playlists') || '{}'); } catch {}
try { const history=JSON.parse(localStorage.getItem('akrasia-shuffle-history') || '[]'); if(Array.isArray(history))shuffleRecent=history.filter(x=>typeof x==='string').slice(-200); } catch {}
const persist = () => { localStorage.setItem('aurora-playlists', JSON.stringify(playlists)); renderPlaylistControls(); };
const fmt = n => { n = Math.max(0, Math.floor(n || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2,'0')}`; };
const recordMarkup = () => '<div class="record-deck"><div class="fallback-disc"><i></i></div><div class="record-arm"><i></i></div></div>';
const syncRecordSpin = () => $('#albumArt')?.classList.toggle('is-playing',Boolean(audio.src&&!audio.paused&&!audio.ended));
function toast(msg) { const el=$('#toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
function setFolderLabel() { $('#folderLabel').textContent = folder || 'Choose a folder to begin'; }
function playlistTracks(name=activePlaylist) { return (playlists[name] || []).slice().reverse().map(id=>library.find(s=>s.id===id)).filter(Boolean); }
function getList() { if (queue.length) return queue; if (activePlaylist) return playlistTracks(); return library; }
function getViewList() { return activePlaylist ? playlistTracks() : library; }
function currentSong() { const list=getList(); return list[current] || null; }
function renderPlaylistControls() {
  const names=Object.keys(playlists);
  $('#playlistFolderLabel b').textContent='Playlists';
  $('#playlistNav').innerHTML=names.length?names.map(n=>`<button class="playlist-nav-item ${activePlaylist===n?'selected':''}" data-playlist="${esc(n)}" aria-label="${esc(n)}"><span class="playlist-glyph" aria-hidden="true">♫</span><span class="playlist-name" title="${esc(n)}">${esc(n)}</span></button>`).join(''):'<div class="playlist-empty">Your playlists will appear here.</div>';
  $('#playlistNav').querySelectorAll('[data-playlist]').forEach(b=>{
    b.onclick=()=>{const playingId=currentSong()?.id;activePlaylist=b.dataset.playlist;queue=[];const list=playlistTracks();current=playingId?list.findIndex(s=>s.id===playingId):-1;shuffleScope='';selectionMode=false;selectedSongIds.clear();libraryView='Songs';render();};
    b.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();playlistMenu(b,b.dataset.playlist);};
  });
  $('#removeSidebarPlaylist').disabled=!activePlaylist;$('.side-item[data-view=Songs]').classList.toggle('selected',!activePlaylist);
}
async function importMediaPlayerPlaylists(){
  if(!folder){toast('Choose your music folder first');return;}
  try{
    const found=await window.aurora.scanPlaylists(folder);
    if(!found.length){toast('No WPL or M3U playlists found in this folder');return;}
    const byPath=new Map(library.map(track=>[track.path.replace(/\//g,'\\').toLowerCase(),track.id]));
    let playlistCount=0,addedCount=0,matchedCount=0;
    for(const item of found){
      const ids=item.tracks.map(file=>byPath.get(file.replace(/\//g,'\\').toLowerCase())).filter(Boolean);
      if(!ids.length)continue;
      matchedCount+=ids.length;
      const name=item.name;
      if(!playlists[name]){playlists[name]=[];playlistCount++;}
      const existing=new Set(playlists[name]);
      for(const id of ids)if(!existing.has(id)){playlists[name].push(id);existing.add(id);addedCount++;}
    }
    if(!matchedCount){toast('Found playlist files, but none of their songs are in this library');return;}
    persist();render();
    toast(`Imported ${playlistCount} playlists · ${addedCount} songs added`);
  }catch{toast('Could not read playlists from this folder');}
}
const esc = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function displaySongs() {
  const view=libraryView, term=$('#search').value.toLowerCase().trim(), sort=$('#sort').value, source=getViewList();
  let data=source.filter(s=>[s.title,s.artist,s.album].join(' ').toLowerCase().includes(term));
  if(view==='Albums'&&!activePlaylist){const seen=new Set();data=data.filter(s=>{const k=s.artist+'\u0000'+s.album;if(seen.has(k))return false;seen.add(k);return true;});}
  if(view==='Artists'&&!activePlaylist){const seen=new Set();data=data.filter(s=>{if(seen.has(s.artist))return false;seen.add(s.artist);return true;});}
  if(sort==='title')data.sort((a,b)=>a.title.localeCompare(b.title));if(sort==='artist')data.sort((a,b)=>a.artist.localeCompare(b.artist)||a.title.localeCompare(b.title));if(sort==='album')data.sort((a,b)=>a.album.localeCompare(b.album)||a.title.localeCompare(b.title));if(sort==='latest')data.sort((a,b)=>activePlaylist?0:b.added-a.added);if(sort==='oldest')data.sort((a,b)=>a.added-b.added);
  $('#libraryTitle').textContent=activePlaylist?activePlaylist:(view==='Songs'?'All songs':view);$('#visibleCount').textContent=`${data.length} ${view==='Albums'?'albums':view==='Artists'?'artists':'tracks'}`;
  const selectButton=$('#selectSongs');selectButton.classList.toggle('is-on',selectionMode);selectButton.textContent=selectionMode?(selectedSongIds.size?`Selected ${selectedSongIds.size}`:'Done'):'Select';
  $('#rowSelectorHeading').innerHTML=selectionMode?'<input id="selectAllSongs" type="checkbox" aria-label="Select all visible songs">':'#';
  $('#songRows').innerHTML=data.map((s,i)=>{const label=view==='Albums'?s.album:view==='Artists'?s.artist:s.title;const cover=s.cover?`<img class="mini-cover" src="${s.cover}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mini-cover fallback-mini',textContent:'◉'}))">`:'<span class="mini-cover fallback-mini">◉</span>';const index=selectionMode?`<input class="song-select" type="checkbox" aria-label="Select ${esc(s.title)}" ${selectedSongIds.has(s.id)?'checked':''}>`:String(i+1).padStart(2,'0');return `<tr data-id="${esc(s.id)}" class="${currentSong()?.id===s.id?'playing':''} ${selectedSongIds.has(s.id)?'selected-song':''}"><td>${index}</td><td><div class="song-cell">${cover}<span>${esc(label)}</span></div></td><td>${esc(view==='Artists'?`${source.filter(x=>x.artist===s.artist).length} songs`:s.artist)}</td><td>${esc(s.album)}</td><td>${fmt(s.duration)}</td><td><button class="row-menu" title="Song actions" aria-label="Song actions" data-menu="${esc(s.id)}">⋯</button></td></tr>`;}).join('');
  $('#emptyState').classList.toggle('show',data.length===0);$('#songCount').textContent=library.length;
  $('#songRows').querySelectorAll('tr').forEach(row=>{
    row.onclick=e=>{if(e.target.closest('[data-menu],.song-select'))return;if(selectionMode)return;const song=library.find(s=>s.id===row.dataset.id);if(!song)return;if(view==='Albums'||view==='Artists'){activePlaylist='';queue=library.filter(x=>view==='Albums'?x.album===song.album&&x.artist===song.artist:x.artist===song.artist);current=queue.findIndex(x=>x.id===song.id);}else{queue=[];const list=getViewList();current=list.findIndex(x=>x.id===song.id);}playCurrent();};
    row.oncontextmenu=e=>{e.preventDefault();const song=library.find(s=>s.id===row.dataset.id);if(song)rowMenu(row,song);};
    row.querySelector('.song-select')?.addEventListener('change',e=>{e.stopPropagation();if(e.target.checked)selectedSongIds.add(row.dataset.id);else selectedSongIds.delete(row.dataset.id);row.classList.toggle('selected-song',e.target.checked);displaySongs();});
  });
  $('#songRows').querySelectorAll('[data-menu]').forEach(b=>b.onclick=e=>{e.stopPropagation();const s=library.find(x=>x.id===b.dataset.menu);if(s)rowMenu(b,s);});
  $('#selectAllSongs')?.addEventListener('change',e=>{if(e.target.checked)data.forEach(s=>selectedSongIds.add(s.id));else data.forEach(s=>selectedSongIds.delete(s.id));displaySongs();});
  const selectAll=$('#selectAllSongs');if(selectAll)selectAll.checked=data.length>0&&data.every(s=>selectedSongIds.has(s.id));
  renderQueue();
}
function placePopup(menu,anchor){const r=anchor.getBoundingClientRect(),w=menu.offsetWidth||190,h=menu.offsetHeight||160;menu.style.left=`${Math.max(8,Math.min(innerWidth-w-8,r.left))}px`;menu.style.top=`${r.bottom+h+8>innerHeight?Math.max(8,r.top-h-4):r.bottom+4}px`;}
function rowMenu(button,song){
  document.querySelector('.popup-menu')?.remove();
  const targets=selectionMode&&selectedSongIds.has(song.id)?library.filter(s=>selectedSongIds.has(s.id)):[song];
  const menu=document.createElement('div');menu.className='popup-menu';
  const drawMain=()=>{menu.classList.remove('playlist-picker');menu.innerHTML=`<button data-action="queue">Add to queue</button><button data-action="add">Add to playlist</button>${activePlaylist?'<button data-action="remove">Remove from playlist</button>':''}<button class="danger" data-action="delete">Delete</button>`;menu.querySelectorAll('[data-action]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const action=b.dataset.action;if(action==='add'){if(!Object.keys(playlists).length){menu.remove();toast('Create a playlist in Collection first');return;}menu.classList.add('playlist-picker');menu.innerHTML=`<div class="popup-heading">ADD TO PLAYLIST</div>${Object.keys(playlists).map(n=>`<button data-playlist="${esc(n)}">${esc(n)}</button>`).join('')}<button data-action="back">‹ Back</button>`;menu.querySelectorAll('[data-playlist]').forEach(item=>item.onclick=ev=>{ev.stopPropagation();const name=item.dataset.playlist,ids=new Set(playlists[name]);for(const track of targets)if(!ids.has(track.id))playlists[name].push(track.id);persist();menu.remove();exitSelection();toast(`Added ${targets.length} song${targets.length===1?'':'s'} to ${name}`);});menu.querySelector('[data-action="back"]').onclick=ev=>{ev.stopPropagation();drawMain();};placePopup(menu,button);return;}menu.remove();if(action==='queue')queueSongAfterCurrent(targets);if(action==='remove')removeFromPlaylist(targets);if(action==='delete')await deleteLibrarySongs(targets);});placePopup(menu,button);};
  document.body.append(menu);drawMain();
}
function queueSongAfterCurrent(songs){
  const additions=Array.isArray(songs)?songs:[songs],playing=currentSong();let order=queue.length?[...queue]:[...getList()];
  const ids=new Set(additions.map(s=>s.id));order=order.filter((s,i)=>!ids.has(s.id)||s.id===playing?.id);
  const index=playing?order.findIndex(s=>s.id===playing.id):-1;order.splice(index>=0?index+1:0,...additions.filter(s=>s.id!==playing?.id));
  queue=order;current=playing?order.findIndex(s=>s.id===playing.id):-1;
  if(shuffle){syncShuffleOrder();shuffleOrder=shuffleOrder.filter(id=>!ids.has(id));shuffleRemaining=shuffleRemaining.filter(id=>!ids.has(id));shuffleOrder.unshift(...additions.map(s=>s.id).filter(id=>id!==playing?.id));}
  render();exitSelection();toast(`Added ${additions.length} song${additions.length===1?'':'s'} next`);
}
function exitSelection(){selectionMode=false;selectedSongIds.clear();$('#selectSongs').classList.remove('is-on');displaySongs();}
function removeFromPlaylist(songs){
  if(!activePlaylist)return;
  const items=Array.isArray(songs)?songs:[songs],ids=new Set(items.map(s=>s.id)),oldList=[...getList()],playing=currentSong(),playingId=playing?.id,oldIndex=current;
  playlists[activePlaylist]=(playlists[activePlaylist]||[]).filter(id=>!ids.has(id));
  if(queue.length){queue=queue.filter(s=>!ids.has(s.id)||s.id===playingId);current=queue.findIndex(s=>s.id===playingId);}
  else if(playing&&ids.has(playingId)){queue=[playing,...oldList.slice(oldIndex+1).filter(s=>!ids.has(s.id))];current=0;}
  else{const list=getList();current=playingId?list.findIndex(s=>s.id===playingId):-1;}
  shuffleScope='';persist();render();exitSelection();toast(`Removed ${items.length} song${items.length===1?'':'s'} from playlist`);
}
async function deleteLibrarySongs(songs){
  const items=Array.isArray(songs)?songs:[songs],paths=items.map(s=>s.path),playingId=currentSong()?.id;
  try{
    const result=await window.aurora.deleteFiles(paths);
    if(!result?.removed?.length)return;
    const removed=new Set(result.removed),removedIds=new Set(library.filter(s=>removed.has(s.path)).map(s=>s.id));
    library=library.filter(s=>!removed.has(s.path));queue=queue.filter(s=>!removedIds.has(s.id));
    for(const name of Object.keys(playlists))playlists[name]=playlists[name].filter(id=>!removedIds.has(id));
    if(removedIds.has(playingId)){audio.pause();audio.removeAttribute('src');current=-1;}
    else current=getList().findIndex(s=>s.id===playingId);
    shuffleScope='';persist();render();exitSelection();
    toast(result.failed?.length?`${removedIds.size} file${removedIds.size===1?'':'s'} permanently gone; ${result.failed.length} failed`:`${removedIds.size} file${removedIds.size===1?'':'s'} permanently gone from this PC`);
  }catch{toast('The file action failed for the selected songs');}
}
function removePlaylist(name){
  confirmAction(`Remove the playlist “${name}”? Songs in your library will stay untouched.`,()=>{
    const playingId=currentSong()?.id;delete playlists[name];
    if(activePlaylist===name){activePlaylist='';queue=[];current=playingId?library.findIndex(s=>s.id===playingId):-1;shuffleScope='';}
    persist();render();toast(`Playlist “${name}” removed`);
  });
}
function playlistMenu(button,name){
  document.querySelector('.popup-menu')?.remove();const menu=document.createElement('div');menu.className='popup-menu';
  menu.innerHTML='<button data-action="rename">Rename playlist</button><button class="danger" data-action="remove">Remove playlist</button>';document.body.append(menu);placePopup(menu,button);
  menu.querySelector('[data-action="rename"]').onclick=()=>{menu.remove();renamePlaylist(name);};menu.querySelector('[data-action="remove"]').onclick=()=>{menu.remove();removePlaylist(name);};
}
function renamePlaylist(oldName){
  const dlg=$('#appDialog');dlg.innerHTML=`<form id="renamePlaylistForm"><div class="dialog-top"><div class="eyebrow">PLAYLISTS</div><button class="dialog-x" type="button" aria-label="Close">×</button></div><h2>Rename playlist</h2><label class="dialog-label" for="playlistRename">Playlist name</label><input id="playlistRename" class="dialog-input" maxlength="48" value="${esc(oldName)}" required><div id="dialogError" class="dialog-error"></div><div class="dialog-actions"><span></span><button id="cancelDialog" class="outline" type="button">Cancel</button><button class="primary-button" type="submit">Save name</button></div></form>`;dlg.showModal();dlg.querySelector('.dialog-x').onclick=()=>dlg.close();$('#cancelDialog').onclick=()=>dlg.close();$('#renamePlaylistForm').onsubmit=e=>{e.preventDefault();const next=$('#playlistRename').value.trim();if(!next)return;if(next!==oldName&&playlists[next]){$('#dialogError').textContent='A playlist with that name already exists.';return;}if(next!==oldName){playlists[next]=playlists[oldName];delete playlists[oldName];if(activePlaylist===oldName)activePlaylist=next;persist();render();}dlg.close();};$('#playlistRename').focus();$('#playlistRename').select();
}
function renderQueue(){const q=getList();let upcoming;if(shuffle){syncShuffleOrder();if(!shuffleOrder.length&&repeat)refillShuffle();upcoming=shuffleOrder.slice(0,5).map(id=>q.find(s=>s.id===id)).filter(Boolean);}else{const start=current<0?0:current+1;upcoming=q.slice(start,start+5);if(repeat&&upcoming.length<5)upcoming=upcoming.concat(q.slice(0,5-upcoming.length));}$('#queueCount').textContent=`${upcoming.length} next`;$('#queueRows').innerHTML=upcoming.map((s,i)=>`<div class="queue-row" data-id="${esc(s.id)}"><span class="queue-no">${String(i+1).padStart(2,'0')}</span>${s.cover?`<img class="queue-cover" src="${s.cover}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'queue-cover fallback-mini',textContent:'◉'}))">`:'<span class="queue-cover fallback-mini">◉</span>'}<div class="queue-info"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div><span class="queue-duration">${fmt(s.duration)}</span></div>`).join('');$('#queueRows').querySelectorAll('.queue-row').forEach(r=>r.onclick=()=>{current=q.findIndex(x=>x.id===r.dataset.id);playCurrent();});}
function render(){renderPlaylistControls();displaySongs();setFolderLabel();}
async function loadFolder(path=folder){if(!path){path=await window.aurora.chooseFolder();if(!path)return;}folder=path;localStorage.setItem('aurora-folder',folder);$('#folderLabel').textContent='Scanning…';try{const scan=await window.aurora.scanFolder(folder);library=Array.isArray(scan)?scan:(Array.isArray(scan?.songs)?scan.songs:[]);queue=[];activePlaylist='';current=-1;render();const warning=Array.isArray(scan?.warnings)&&scan.warnings.length?`${scan.warnings[0]} `:'';toast(`${warning}Found ${library.length} songs`);}catch(e){toast('Could not scan this folder');setFolderLabel();}}
async function playCurrent(){const s=currentSong();if(!s){toast('Choose a song first');return;}resetSpeakerRise();rememberPlayed(s.id);audio.src=await window.aurora.fileUrl(s.path);audio.play().catch(()=>toast('This audio format could not be played'));$('#nowTitle').textContent=s.title;$('#nowArtist').textContent=s.artist;$('#nowAlbum').textContent=s.album;$('#artTitle').textContent=s.title;$('#artArtist').textContent=s.artist;$('#fileType').textContent=s.path.split('.').pop().toUpperCase();const art=$('#albumArt');art.innerHTML=s.cover?`<img src="${s.cover}">`:recordMarkup();art.querySelector('img')?.addEventListener('error',()=>{art.innerHTML=recordMarkup();syncRecordSpin();},{once:true});syncRecordSpin();$('#play').textContent='Ⅱ';render();startViz();}
function secureRandomInt(max){if(max<=1)return 0;const range=0x100000000,limit=range-(range%max),values=new Uint32Array(1);let value;do{crypto.getRandomValues(values);value=values[0];}while(value>=limit);return value%max;}
function secureShuffle(items){const result=[...items];for(let i=result.length-1;i>0;i--){const j=secureRandomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
function refillShuffle(){const currentId=currentSong()?.id,recent=new Set(shuffleRecent.slice(-200));let candidates=shuffleRemaining.filter(id=>id!==currentId&&!recent.has(id));if(!candidates.length&&shuffleRemaining.length)candidates=shuffleRemaining.filter(id=>id!==currentId);shuffleOrder=secureShuffle(candidates);}
function syncShuffleOrder(){const ids=getList().map(s=>s.id),signature=[...ids].sort().join('\u0001');if(signature!==shuffleScope){shuffleScope=signature;shuffleOrder=[];shuffleRemaining=ids.filter(id=>id!==currentSong()?.id);if(shuffle)refillShuffle();}else{const valid=new Set(ids);shuffleOrder=shuffleOrder.filter(id=>valid.has(id));shuffleRemaining=shuffleRemaining.filter(id=>valid.has(id));}}
function rememberPlayed(id){syncShuffleOrder();shuffleOrder=shuffleOrder.filter(x=>x!==id);shuffleRemaining=shuffleRemaining.filter(x=>x!==id);shuffleRecent=shuffleRecent.filter(x=>x!==id);shuffleRecent.push(id);if(shuffleRecent.length>200)shuffleRecent.shift();localStorage.setItem('akrasia-shuffle-history',JSON.stringify(shuffleRecent));}
function next(){const list=getList();if(!list.length)return;if(shuffle){syncShuffleOrder();if(!shuffleOrder.length&&shuffleRemaining.length)refillShuffle();if(!shuffleOrder.length&&repeat){shuffleRemaining=list.map(s=>s.id).filter(id=>id!==currentSong()?.id);refillShuffle();}const id=shuffleOrder.shift();if(!id){audio.pause();audio.currentTime=0;render();return;}shuffleRemaining=shuffleRemaining.filter(x=>x!==id);current=list.findIndex(s=>s.id===id);playCurrent();return;}if(current>=list.length-1){if(!repeat){audio.pause();audio.currentTime=0;current=list.length-1;render();return;}current=0;}else current++;playCurrent();}
function previous(){if(audio.currentTime>3){audio.currentTime=0;return;}const list=getList();if(list.length){current=(current-1+list.length)%list.length;playCurrent();}}
function newPlaylist(){const dlg=$('#appDialog');dlg.innerHTML=`<form id="createPlaylistForm"><div class="dialog-top"><div class="eyebrow">PLAYLISTS</div><button class="dialog-x" type="button" aria-label="Close">×</button></div><h2>Create a playlist</h2><p class="dialog-copy">Give your collection a name.</p><label class="dialog-label" for="playlistName">Playlist name</label><input id="playlistName" class="dialog-input" maxlength="48" placeholder="e.g. Late night drive" autocomplete="off" required><div id="dialogError" class="dialog-error"></div><div class="dialog-actions"><span></span><button id="cancelDialog" class="outline" type="button">Cancel</button><button class="primary-button" type="submit">Create playlist</button></div></form>`;if(!dlg.open)dlg.showModal();dlg.querySelector('.dialog-x').onclick=()=>dlg.close();$('#cancelDialog').onclick=()=>dlg.close();$('#createPlaylistForm').onsubmit=e=>{e.preventDefault();const n=$('#playlistName').value.trim();if(!n)return;if(playlists[n]){$('#dialogError').textContent='A playlist with that name already exists.';return;}playlists[n]=[];persist();activePlaylist=n;queue=[];current=-1;shuffleScope='';dlg.close();render();toast(`Playlist “${n}” created`);};$('#playlistName').focus();}
function confirmAction(message,onYes){const dlg=$('#appDialog');dlg.innerHTML=`<div class="dialog-top"><div class="eyebrow">PLAYLISTS</div><button class="dialog-x" type="button" aria-label="Close">×</button></div><h2>Remove playlist</h2><p class="dialog-copy">${esc(message)}</p><div class="dialog-actions"><span></span><button id="cancelDialog" class="outline" type="button">Cancel</button><button id="confirmRemove" class="primary-button" type="button">Remove playlist</button></div>`;dlg.showModal();dlg.querySelector('.dialog-x').onclick=()=>dlg.close();$('#cancelDialog').onclick=()=>dlg.close();$('#confirmRemove').onclick=()=>{dlg.close();onYes();};}
function initAudio(){if(audioCtx)return;audioCtx=new AudioContext();analyser=audioCtx.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.46;analyser.minDecibels=-85;analyser.maxDecibels=0;waveAnalyser=audioCtx.createAnalyser();waveAnalyser.fftSize=256;source=audioCtx.createMediaElementSource(audio);source.connect(analyser);source.connect(waveAnalyser);analyser.connect(audioCtx.destination);}
function resetSpeakerRise(){speakerBandLevels.fill(0);lastSpeakerPulse=0;}
function pulseSpeakers(strength){if(document.body.classList.contains('speakers-off'))return;const speakers=document.querySelectorAll('.speaker-cluster');if(!speakers.length)return;lastSpeakerPulse=performance.now();const bounded=Math.max(.18,Math.min(1,strength));speakers.forEach(speaker=>{speaker.style.setProperty('--speaker-flash-brightness',(1.3+bounded*1.2).toFixed(2));speaker.style.setProperty('--speaker-flash-scale',(1.012+bounded*.043).toFixed(3));speaker.classList.remove('speaker-hit');});void speakers[0].offsetWidth;speakers.forEach(speaker=>speaker.classList.add('speaker-hit'));window.setTimeout(()=>speakers.forEach(speaker=>speaker.classList.remove('speaker-hit')),145);}
function pulseOnStrongestRise(levels,now){
  const first=mode===0?0:mode===1?6:0,last=mode===0?5:14;let strongestRise=0,strongestLevel=0;
  for(let band=first;band<=last;band++){const level=levels[band]||0,rise=level-speakerBandLevels[band];speakerBandLevels[band]=level;if(rise>strongestRise){strongestRise=rise;strongestLevel=level;}}
  if(audio.paused||document.body.classList.contains('speakers-off'))return;
  if(strongestLevel>=.08&&strongestRise>=.035&&now-lastSpeakerPulse>=105){const strength=Math.max(.18,Math.min(1,.24+strongestRise*2.8+strongestLevel*.3));pulseSpeakers(strength);}
}
function startViz(){initAudio();if(audioCtx.state==='suspended')audioCtx.resume();if(!raf)drawViz();}
function setPanelMode(mode){panelMode=panelMode===mode?'':mode;const layout=$('.layout');layout.classList.toggle('focus-visualizer',panelMode==='visualizer');layout.classList.toggle('focus-library',panelMode==='library');for(const [id,name,label] of [['maximizeVisualizer','visualizer','visualizer'],['maximizeLibrary','library','song list']]){const b=$(`#${id}`),expanded=panelMode===name;b.setAttribute('aria-pressed',String(expanded));b.title=expanded?`Restore ${label} panel`:`Expand ${label}`;b.setAttribute('aria-label',b.title);b.textContent=expanded?'↙':'⤢';}}
function drawViz(){
  raf=requestAnimationFrame(drawViz);
  const c=$('#visualizer'),r=c.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  if(c.width!==Math.round(r.width*dpr)||c.height!==Math.round(r.height*dpr)){c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);const w=r.width,h=r.height;ctx.clearRect(0,0,w,h);
  const data=new Float32Array(analyser?.frequencyBinCount||1024),wave=new Uint8Array(waveAnalyser?.fftSize||256);
  if(analyser)analyser.getFloatFrequencyData(data);else data.fill(-85);
  if(waveAnalyser)waveAnalyser.getByteTimeDomainData(wave);else wave.fill(128);
  ctx.shadowBlur=14;ctx.shadowColor='#338dff';
  if(mode===0||mode===1){
    const bands=15,columns=29,centerIndex=(columns-1)/2,baseGap=Math.max(1,Math.min(6,w/330)),baseBarWidth=(w-(columns-1)*baseGap)/columns,bw=baseBarWidth*.95,gap=(w-columns*bw)/(columns-1),maxBin=data.length-1,bandDb=Array(bands).fill(-Infinity),maxHeight=h*.98,barGradient=ctx.createLinearGradient(0,h,0,h-maxHeight);
    const perspective=mode===1,projectScale=y=>1-.48*Math.max(0,Math.min(1,(h-y)/maxHeight)),appendBarRect=(x,y,width,height)=>{if(!perspective){ctx.rect(x,y,width,height);return;}const bottom=y+height,topScale=projectScale(y),bottomScale=projectScale(bottom),topLeft=w/2+(x-w/2)*topScale,topRight=w/2+(x+width-w/2)*topScale,bottomLeft=w/2+(x-w/2)*bottomScale,bottomRight=w/2+(x+width-w/2)*bottomScale;ctx.moveTo(topLeft,y);ctx.lineTo(topRight,y);ctx.lineTo(bottomRight,bottom);ctx.lineTo(bottomLeft,bottom);ctx.closePath();};
    if(perspective){barGradient.addColorStop(0,'rgba(7,22,79,.98)');barGradient.addColorStop(.2,'rgba(18,76,170,.95)');barGradient.addColorStop(.35,'rgba(66,201,255,.9)');barGradient.addColorStop(.48,'rgba(136,215,202,.82)');barGradient.addColorStop(.6,'rgba(255,173,66,.68)');barGradient.addColorStop(.78,'rgba(238,117,56,.48)');barGradient.addColorStop(.91,'rgba(169,45,55,.24)');barGradient.addColorStop(1,'rgba(97,23,44,.04)');}
    else{barGradient.addColorStop(0,'#07164f');barGradient.addColorStop(.2,'#124caa');barGradient.addColorStop(.35,'#42c9ff');barGradient.addColorStop(.48,'#88d7ca');barGradient.addColorStop(.6,'#ffad42');barGradient.addColorStop(.78,'#ee7538');barGradient.addColorStop(.91,'#a92d37');barGradient.addColorStop(1,'#61172c');}
    const sampleRate=audioCtx?.sampleRate||48000,binHz=sampleRate/analyser.fftSize,minFreq=35,maxFreq=Math.min(22050,sampleRate/2),frequencyRatio=Math.pow(maxFreq/minFreq,1/(bands-1)),bandEdgeRatio=Math.sqrt(frequencyRatio);
    for(let band=0;band<bands;band++){
      const centerFreq=minFreq*Math.pow(frequencyRatio,band),lowEdge=band===0?minFreq:centerFreq/bandEdgeRatio,highEdge=band===bands-1?maxFreq:centerFreq*bandEdgeRatio;let start=Math.max(1,Math.ceil(lowEdge/binHz)),end=Math.min(data.length-1,Math.floor(highEdge/binHz));if(end<start)start=end=Math.min(data.length-1,Math.max(1,Math.round(centerFreq/binHz)));
      let totalPower=0,count=0;for(let k=start;k<=end;k++){if(Number.isFinite(data[k])){totalPower+=Math.pow(10,data[k]/10);count++;}}
      bandDb[band]=count?10*Math.log10(totalPower/count):-Infinity;
      if(bandDb[band]>-95){const rate=bandDb[band]>bandAveragePlus[band] ? .035 : .006;bandAveragePlus[band]+=(bandDb[band]-bandAveragePlus[band])*rate;}
    }
    let totalPower=0,powerCount=0;for(let k=1;k<data.length;k++){if(Number.isFinite(data[k])){totalPower+=Math.pow(10,data[k]/10);powerCount++;}}
    const averageDb=powerCount?10*Math.log10(totalPower/powerCount):-120,activity=Math.max(0,Math.min(1,(averageDb+76)/26));
    const bandLevel=(band,boost=0)=>{const db=bandDb[band];if(!Number.isFinite(db)||db<-88)return 0;const makeup=Math.max(0,Math.min(14,(-48-bandAveragePlus[band])*.55)),linear=Math.max(0,Math.min(1,(db+82+makeup+boost)/64));return linear>0?Math.pow(linear,.84):0;};
    const speakerLevels=bandDb.map((_,band)=>bandLevel(band,band>9?5:2));pulseOnStrongestRise(speakerLevels,performance.now());
    const sampleBand=(position,boost)=>{const low=Math.max(0,Math.min(bands-1,Math.floor(position))),high=Math.min(bands-1,low+1),fraction=Math.max(0,Math.min(1,position-low));return bandLevel(low,boost)*(1-fraction)+bandLevel(high,boost)*fraction;};
    const targetLevels=[];
    for(let i=0;i<columns;i++){
      const edgeDistance=Math.abs(i-centerIndex)/centerIndex;let level;
      // Fifteen equal logarithmic bands run bass-to-treble from either edge
      // toward one shared center bar; each side mirrors the same live spectrum.
      const frequencyPosition=(perspective?edgeDistance:1-edgeDistance)*(bands-1),boost=frequencyPosition>9?5:2;
      level=sampleBand(frequencyPosition,boost);
      // Keep the single center bar in the strong musical upper mids even when
      // the narrowest treble band is quiet; the signal is still taken from audio.
      if(i===centerIndex&&!perspective){let upperMidPeak=0;for(let band=9;band<bands;band++)upperMidPeak=Math.max(upperMidPeak,bandLevel(band,5));level=Math.max(level,upperMidPeak*.78);}
      targetLevels.push(Math.max(audio.paused ? .015 : .02,level*activity));
    }
    const visualLevels=[];
    for(let i=0;i<columns;i++){
      let neighborhood=0,weightTotal=0;for(let offset=-1;offset<=1;offset++){const index=i+offset;if(index<0||index>=columns)continue;const weight=offset===0?8:1;neighborhood+=targetLevels[index]*weight;weightTotal+=weight;}
      const target=neighborhood/weightTotal,rate=target>barPlusLevels[i] ? .55 : .27;barPlusLevels[i]+=(target-barPlusLevels[i])*rate;
      const centerPosition=i/centerIndex,centerDistance=Math.abs(centerPosition-1)/.3,bell=centerDistance < 1 ? .5+.5*Math.cos(Math.PI*centerDistance) : 0,centerGain=1+.05*bell;
      visualLevels.push(Math.min(1,Math.pow(barPlusLevels[i],.95)*1.12*centerGain));
    }
    const visualMean=visualLevels.reduce((sum,value)=>sum+value,0)/columns;
    for(let i=0;i<columns;i++){
      const contrastedLevel=Math.max(0,visualMean+(visualLevels[i]-visualMean)*1.10),heightLevel=Math.min(1,contrastedLevel);
      const bh=Math.max(h*.018,heightLevel*maxHeight),displayHeight=perspective?Math.min(maxHeight,bh*1.15):bh,x=i*(bw+gap),y=h-displayHeight;
      barPlusPeaks[i]=Math.max(bh,barPlusPeaks[i]-Math.max(1,h*.008));
      ctx.beginPath();appendBarRect(x,y,bw,displayHeight);ctx.fillStyle=barGradient;ctx.fill();
      ctx.globalAlpha=perspective?.55:1;ctx.beginPath();appendBarRect(x,y,bw,Math.max(1,displayHeight*.12));ctx.fillStyle='rgba(204,245,255,.15)';ctx.fill();
      const sliceHeight=Math.max(1,h*.003);ctx.globalAlpha=perspective?.3:1;ctx.beginPath();for(let mark=5;mark<=95;mark+=5){const markY=h-maxHeight*mark/100;if(markY>=y)appendBarRect(x,markY,bw,sliceHeight);}ctx.fillStyle='rgba(5,14,38,.52)';ctx.fill();ctx.globalAlpha=1;
      const displayedPeak=perspective?Math.min(maxHeight,barPlusPeaks[i]*1.15):barPlusPeaks[i],capY=Math.max(h-maxHeight,h-displayedPeak-4);ctx.globalAlpha=perspective?Math.max(.06,1-(h-capY)/maxHeight):1;ctx.beginPath();appendBarRect(x,capY,bw,3);ctx.fillStyle='rgba(207,243,255,.52)';ctx.fill();ctx.beginPath();appendBarRect(x,capY+3,bw,2);ctx.fillStyle='rgba(122,207,255,.28)';ctx.fill();ctx.globalAlpha=1;
    }
  }else{
    ctx.beginPath();for(let x=0;x<w;x++){const i=Math.floor(x/Math.max(1,w-1)*(wave.length-1));const sample=(wave[i]-128)/128;const idle=audio.paused?Math.sin(x*.025+Date.now()/450)*.035:0;const y=h*.52-(sample+idle)*h*.42;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle='#53dfff';ctx.lineWidth=2.5;ctx.shadowBlur=15;ctx.stroke();
    ctx.beginPath();for(let x=0;x<w;x++){const i=Math.floor(x/Math.max(1,w-1)*(wave.length-1));const sample=(wave[i]-128)/128;const idle=audio.paused?Math.sin(x*.025+Date.now()/450)*.035:0;const y=h*.52+(sample+idle)*h*.42;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle='#a445ff';ctx.lineWidth=1.5;ctx.shadowColor='#a445ff';ctx.stroke();
  }
  ctx.shadowBlur=0;
}
$('#chooseFolder').onclick=()=>loadFolder('');$('#emptyChoose').onclick=()=>loadFolder('');$('#rescan').onclick=()=>loadFolder(folder);$('#search').oninput=displaySongs;$('#sort').onchange=displaySongs;$('#removeSidebarPlaylist').onclick=()=>{if(!activePlaylist){toast('Choose a playlist first');return;}removePlaylist(activePlaylist);};$('#maximizeVisualizer').onclick=()=>setPanelMode('visualizer');$('#maximizeLibrary').onclick=()=>setPanelMode('library');
$('#speakerToggle').onclick=()=>{const off=document.body.classList.toggle('speakers-off'),button=$('#speakerToggle'),label=off?'Turn speakers on':'Turn speakers off';button.setAttribute('aria-pressed',String(!off));button.setAttribute('aria-label',label);button.title=label;};
$('#newPlaylist').onclick=()=>newPlaylist();$('#importPlaylists').onclick=importMediaPlayerPlaylists;$('#selectSongs').onclick=()=>{selectionMode=!selectionMode;if(!selectionMode)selectedSongIds.clear();displaySongs();};
document.querySelectorAll('.top-tabs button').forEach(b=>b.onclick=()=>{const playingId=currentSong()?.id;libraryView=b.dataset.view;document.querySelectorAll('.top-tabs button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.side-item[data-view]').forEach(x=>x.classList.toggle('selected',x.dataset.view===libraryView));activePlaylist='';queue=[];current=playingId?library.findIndex(s=>s.id===playingId):-1;shuffleScope='';selectionMode=false;selectedSongIds.clear();$('#libraryTitle').textContent=libraryView;displaySongs();});
document.querySelectorAll('.side-item[data-view]').forEach(b=>b.onclick=()=>{const playingId=currentSong()?.id;activePlaylist='';queue=[];libraryView=b.dataset.view;current=playingId?library.findIndex(s=>s.id===playingId):-1;shuffleScope='';selectionMode=false;selectedSongIds.clear();document.querySelectorAll('.top-tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===libraryView||((libraryView==='Albums'||libraryView==='Artists')&&x.dataset.view==='Songs')));document.querySelectorAll('.side-item[data-view]').forEach(x=>x.classList.toggle('selected',x===b));render();});
$('#play').onclick=()=>{if(!audio.src){current=0;playCurrent();}else if(audio.paused){audio.play();$('#play').textContent='Ⅱ';startViz();}else{audio.pause();$('#play').textContent='▶';}};$('#next').onclick=next;$('#previous').onclick=previous;$('#shuffle').onclick=()=>{shuffle=!shuffle;shuffleOrder=[];shuffleScope='';if(shuffle)syncShuffleOrder();$('#shuffle').classList.toggle('is-on',shuffle);renderQueue();};$('#repeat').onclick=()=>{repeat=!repeat;$('#repeat').classList.toggle('is-on',repeat);renderQueue();};$('#vizToggle').onclick=()=>{mode=(mode+1)%3;resetSpeakerRise();const labels=['BAR','BAR +','ANALOG WAVE'];$('#vizMode').textContent=labels[mode];$('#vizToggle').textContent='Viz Change';};$('#vizToggle').textContent='Viz Change';$('#vizMode').textContent='BAR';$('#clearQueue').onclick=()=>{const playing=currentSong();queue=[];const list=getList();current=playing?list.findIndex(s=>s.id===playing.id):-1;if(playing&&current<0){queue=[playing];current=0;}shuffleScope='';renderQueue();};
$('#seek').oninput=()=>{if(audio.duration)audio.currentTime=audio.duration*$('#seek').value/1000;};audio.ontimeupdate=()=>{const duration=audio.duration||0,elapsed=audio.currentTime||0;$('#elapsedTime').textContent=fmt(elapsed);$('#totalTime').textContent=fmt(duration);$('#seek').value=duration?Math.round(elapsed/duration*1000):0;};audio.onplay=()=>{$('#play').textContent='Ⅱ';syncRecordSpin();};audio.onpause=()=>{$('#play').textContent='▶';syncRecordSpin();resetSpeakerRise();};audio.onseeked=()=>{resetSpeakerRise();};audio.onended=()=>{syncRecordSpin();next();};
document.addEventListener('click',e=>{if(!e.target.closest('.row-menu,.popup-menu'))document.querySelector('.popup-menu')?.remove();});window.addEventListener('resize',()=>{const c=$('#visualizer');c.width=0;});
const bootScreen=$('#bootScreen');window.setTimeout(()=>bootScreen?.classList.add('boot-exit'),2000);window.setTimeout(()=>bootScreen?.remove(),2240);render();if(folder)loadFolder(folder);
