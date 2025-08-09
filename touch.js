// Touch controls for v6
(function(){
  const dpad = document.getElementById('dpad');
  const actions = document.getElementById('actions');
  const fireOverlay = document.getElementById('fire-overlay');

  function sendMove(dx,dy){
    // Simulate key handling by calling tryPlayerMove directly if available
    if(typeof tryPlayerMove==='function'){
      tryPlayerMove(dx,dy);
    }
  }
  function sendAct(act){
    if(typeof pickUp!=='function') return;
    switch(act){
      case 'pickup': pickUp(); render(); break;
      case 'use': handleUse(); break;
      case 'toggle': toggleWeapon(); break;
      case 'wait': waitTurn(); break;
      case 'fire':
        // show overlay for direction
        fireOverlay.classList.remove('hidden');
        break;
      case 'elevator': if(typeof useElevator==='function') useElevator(); break;
      case 'saberColor': if(typeof cycleSaberColor==='function') cycleSaberColor(); break;
      case 'saberForm': if(typeof cycleSaberForm==='function') cycleSaberForm(); break;
      case 'save': if(typeof saveGame==='function') saveGame(); break;
      case 'load': if(typeof loadGame==='function') loadGame(); break;
    }
  }

  dpad.addEventListener('click', (e)=>{
    const b = e.target.closest('button');
    if(!b) return;
    const act = b.dataset.act;
    if(act==='wait'){ sendAct('wait'); return; }
    const dx = parseInt(b.dataset.dx||'0',10);
    const dy = parseInt(b.dataset.dy||'0',10);
    sendMove(dx,dy);
  });
  actions.addEventListener('click', (e)=>{
    const b = e.target.closest('button');
    if(!b) return;
    sendAct(b.dataset.act);
  });
  fireOverlay.addEventListener('click', (e)=>{
    const b = e.target.closest('button');
    if(!b) { fireOverlay.classList.add('hidden'); return; }
    if(b.dataset.act==='cancel'){
      fireOverlay.classList.add('hidden');
      return;
    }
    const dx = parseInt(b.dataset.fdx||'0',10);
    const dy = parseInt(b.dataset.fdy||'0',10);
    if(typeof tryFire==='function'){
      tryFire(dx,dy);
    }
    fireOverlay.classList.add('hidden');
  });
})();