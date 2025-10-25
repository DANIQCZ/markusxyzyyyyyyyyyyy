// script.js — High-fidelity camera UI (inspired by S25)
// Behavior:
// - enumerate devices
// - start best back camera by default
// - slider controls zoom (1..10)
// - when slider >= 4.5 (threshold) attempt to switch to a 'tele' device (5x optical) if present
// - if tele device not available, fallback to digital zoom (CSS transform)
// - show status toasts and zoom indicator

const preview = document.getElementById('preview');
const zoomSlider = document.getElementById('zoom-slider');
const zoomIndicator = document.getElementById('zoom-indicator');
const toast = document.getElementById('status-toast');
const shutter = document.getElementById('shutter');
const quicks = document.querySelectorAll('.zoom-quick .quick');
const toggleCam = document.getElementById('toggle-camera');

let currentStream = null;
let devices = [];
let usingFacing = 'environment'; // 'user' | 'environment'
let preferredTeleDeviceId = null;
let currentDeviceId = null;
const TELE_THRESHOLD = 4.5; // when slider >= this we attempt tele
const OPTICAL_TAGS = ['tele','zoom','peris','5x','5×','telephoto'];

function showToast(text, ms=1400){
  toast.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(()=> toast.classList.add('hidden'), ms);
}

async function getDevices(){
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    devices = list.filter(d => d.kind === 'videoinput');
    // detect potential tele cameras by label (requires permission to show labels)
    preferredTeleDeviceId = null;
    for(const d of devices){
      const lab = (d.label || '').toLowerCase();
      if(OPTICAL_TAGS.some(t => lab.includes(t))){
        preferredTeleDeviceId = d.deviceId;
        break;
      }
    }
    return devices;
  } catch(e){
    console.error('enumerateDevices failed', e);
    return [];
  }
}

async function startStreamWithConstraints(constraints){
  stopCurrentStream();
  try{
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = s;
    preview.srcObject = s;
    // set currentDeviceId if track has label/deviceId (may require enumerateDevices)
    const videoTrack = s.getVideoTracks()[0];
    currentDeviceId = videoTrack.getSettings().deviceId || null;
    await getDevices(); // refresh labels after permission
    return s;
  }catch(e){
    console.error('getUserMedia failed', e);
    showToast('Nepodařilo se spustit kameru');
    throw e;
  }
}

function stopCurrentStream(){
  if(currentStream){
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    preview.srcObject = null;
  }
}

// choose best back camera: prefer device labels containing 'back' or not 'front'
function chooseInitialDevice(){
  if(!devices || devices.length === 0) return null;
  // prefer environment/back
  for(const d of devices){
    const l=(d.label||'').toLowerCase();
    if(l.includes('back') || l.includes('rear') || l.includes('environment')) return d.deviceId;
  }
  // fallback to first
  return devices[0].deviceId;
}

async function init(){
  // request minimal permission to reveal labels
  try{
    await startStreamWithConstraints({video:true});
  }catch(e){
    console.warn('Permission denied or error');
  }
  await getDevices();
  const initialId = chooseInitialDevice();
  const constraints = {
    video: initialId ? {deviceId: {exact: initialId}, width:{ideal:1280}, height:{ideal:720}} : {facingMode: {ideal: 'environment'}, width:{ideal:1280}, height:{ideal:720}}
  };
  try{
    await startStreamWithConstraints(constraints);
    showToast('Kamera připravena', 900);
  }catch(e){
    console.error(e);
  }
  attachUI();
  updateZoomUI(1);
}

function updateZoomUI(zoom){
  zoomIndicator.textContent = `${(Math.round(zoom*10)/10).toFixed( (zoom%1===0)?0:1 )}×`;
  // apply digital zoom if we can't apply camera constraints
  applyDigitalZoom(zoom);
}

function applyDigitalZoom(zoom){
  // we scale video element visually (not true optical)
  // keep centered
  const scale = Math.max(1, zoom);
  preview.style.transform = `scale(${scale})`;
}

async function attemptSwitchToTele(){
  if(!preferredTeleDeviceId){
    showToast('Optický 5× není dostupný (fallback na digitální zoom)', 1400);
    return false;
  }
  if(currentDeviceId === preferredTeleDeviceId){
    // already on tele
    showToast('Používá se optický telefoto 5×', 900);
    return true;
  }
  try{
    await startStreamWithConstraints({video: { deviceId: { exact: preferredTeleDeviceId }, width:{ideal:2560}, height:{ideal:1440} }});
    showToast('Přepnuto na optický 5×', 900);
    return true;
  }catch(e){
    console.warn('Switch to tele failed', e);
    showToast('Nepodařilo se přepnout na optický tele', 1200);
    return false;
  }
}

// event handlers
function attachUI(){
  zoomSlider.addEventListener('input', async (e)=>{
    const z = parseFloat(e.target.value);
    zoomIndicator.textContent = `${z.toFixed(z%1===0?0:1)}×`;
    // when slider reaches threshold, attempt tele switch
    if(z >= TELE_THRESHOLD){
      // optimistic: try to switch to tele if available
      if(preferredTeleDeviceId && currentDeviceId !== preferredTeleDeviceId){
        const ok = await attemptSwitchToTele();
        if(!ok){
          updateZoomUI(z);
        } else {
          // tele likely has its own crop; still show indicator
          zoomIndicator.textContent = `5× (optical)`;
        }
      } else {
        updateZoomUI(Math.max(5, z));
      }
    } else {
      // if we are on tele but zoom dropped below threshold, go back to main if possible
      updateZoomUI(z);
    }
  });

  quicks.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const z = Number(btn.dataset.z);
      zoomSlider.value = z;
      zoomSlider.dispatchEvent(new Event('input'));
    });
  });

  shutter.addEventListener('click', takePhoto);

  toggleCam.addEventListener('click', async ()=>{
    // switch between front/back by facingMode when possible
    usingFacing = usingFacing === 'environment' ? 'user' : 'environment';
    try{
      await startStreamWithConstraints({video: { facingMode: { exact: usingFacing }, width:{ideal:1280}, height:{ideal:720} }});
      showToast(usingFacing === 'environment' ? 'Zadní kamera' : 'Přední kamera', 900);
    }catch(e){
      // fallback: try deviceId selection
      const candidate = devices.find(d => {
        const l=(d.label||'').toLowerCase();
        if(usingFacing==='user') return l.includes('front') || l.includes('selfie') || l.includes('user');
        return !l.includes('front') && !l.includes('selfie');
      });
      if(candidate){
        try{
          await startStreamWithConstraints({video:{ deviceId:{exact:candidate.deviceId}, width:{ideal:1280}, height:{ideal:720}}});
          showToast('Kamera přepnuta',900);
        }catch(err){
          showToast('Přepnutí selhalo',900);
        }
      }else{
        showToast('Druhá kamera nenalezena',900);
      }
    }
  });
}

// capture snapshot to canvas and download-like effect
async function takePhoto(){
  const canvas = document.getElementById('snap-canvas');
  const v = preview;
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  const ctx = canvas.getContext('2d');
  // if video is scaled for digital zoom, apply crop to capture same frame
  // compute effective scale and crop coordinates
  const style = getComputedStyle(v);
  const transform = style.transform || '';
  let scale = 1;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if(m){
    const vals = m[1].split(',').map(s=>parseFloat(s));
    if(vals.length >= 1) scale = vals[0];
  }
  if(scale <= 1.01){
    ctx.drawImage(v,0,0,canvas.width,canvas.height);
  } else {
    // crop center region corresponding to scale
    const sw = canvas.width / scale;
    const sh = canvas.height / scale;
    const sx = (canvas.width - sw)/2;
    const sy = (canvas.height - sh)/2;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }

  // visual flash
  flash();

  // create blob and trigger download
  canvas.toBlob(blob=>{
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `photo_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Foceno');
  }, 'image/jpeg', 0.92);
}

function flash(){
  const f = document.createElement('div');
  f.style.position='absolute';
  f.style.left=0; f.style.top=0; f.style.right=0; f.style.bottom=0;
  f.style.background='white';
  f.style.opacity='0.9';
  f.style.zIndex=50;
  document.body.appendChild(f);
  setTimeout(()=>{ f.style.transition='opacity 300ms'; f.style.opacity='0'; setTimeout(()=>f.remove(),350) },80);
}

// initialize
init();
