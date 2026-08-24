(function () {
  const JourneyState = Object.freeze({
    WALKING_TO_STOP:'WALKING_TO_STOP', WAITING_FOR_BUS:'WAITING_FOR_BUS',
    BUS_APPROACHING:'BUS_APPROACHING', BOARDING:'BOARDING', ON_BUS:'ON_BUS',
    APPROACHING_DESTINATION:'APPROACHING_DESTINATION', GET_OFF_NOW:'GET_OFF_NOW',
    WALKING_TO_DESTINATION:'WALKING_TO_DESTINATION', ARRIVED:'ARRIVED',
  });

  function adviseLeaveNow({ walkingSeconds, busMinutes, nextBusMinutes, source='scheduled', isStale=false, safetyBufferSeconds=120 }) {
    const walkMinutes=Math.max(1,Math.ceil(Number(walkingSeconds||0)/60));
    if(!Number.isFinite(Number(busMinutes))||isStale)return{tone:'unknown',title:'Check before leaving',detail:`Walking takes approximately ${walkMinutes} min. Reliable live arrival information is not currently available.`,meta:'Use the published departure time as a guide.'};
    const arrivalMinutes=Math.max(0,Math.ceil(Number(busMinutes))),marginSeconds=arrivalMinutes*60-Number(walkingSeconds||0)-safetyBufferSeconds,sourceText=source==='live'?'Live vehicle estimate':'Scheduled departure';
    if(marginSeconds>=300)return{tone:'plenty',title:'Plenty of time',detail:`The bus is expected in ~${arrivalMinutes} min and the walk takes about ${walkMinutes} min.`,meta:`${sourceText} · includes a ${Math.ceil(safetyBufferSeconds/60)} min safety buffer`};
    if(marginSeconds>=0)return{tone:'likely',title:'Leave now · likely to catch',detail:`The bus is expected in ~${arrivalMinutes} min. Walking takes approximately ${walkMinutes} min.`,meta:`${sourceText} · this is an estimate, not a guarantee`};
    if(Number.isFinite(Number(nextBusMinutes))&&Number(nextBusMinutes)*60-Number(walkingSeconds||0)>=safetyBufferSeconds)return{tone:'miss',title:'You may miss this bus',detail:`The nearest bus is expected in ~${arrivalMinutes} min. The next is estimated in ~${Math.ceil(nextBusMinutes)} min.`,meta:`Walk: ${walkMinutes} min · no need to rush unsafely`};
    return{tone:'miss',title:'You may miss this bus',detail:`The bus is expected in ~${arrivalMinutes} min while the walk takes about ${walkMinutes} min.`,meta:`${sourceText} · allow time to reach the correct boarding point`};
  }

  function occupancy(status) {
    return ({
      EMPTY:{label:'Seats available',tone:'available'},MANY_SEATS_AVAILABLE:{label:'Seats available',tone:'available'},
      FEW_SEATS_AVAILABLE:{label:'Moderate occupancy',tone:'moderate'},STANDING_ROOM_ONLY:{label:'Standing room only',tone:'crowded'},
      CRUSHED_STANDING_ROOM_ONLY:{label:'Crowded',tone:'crowded'},FULL:{label:'Full',tone:'full'},
      NOT_ACCEPTING_PASSENGERS:{label:'Not accepting passengers',tone:'full'},
    })[String(status||'').toUpperCase()]||null;
  }

  class StaticApiCache {
    constructor({prefix='maribus-static-api:',maximumEntries=30}={}){this.prefix=prefix;this.maximumEntries=maximumEntries;}
    async get(url,{ttlMs=86400000}={}){
      try{
        const response=await fetch(url),result=await response.json();
        if(!response.ok||!result.success)throw new Error(result.error||'Request unavailable');
        this.store(url,result);return result;
      }catch(networkError){
        try{const cached=JSON.parse(localStorage.getItem(`${this.prefix}${url}`)||'null');if(!cached?.result||Date.now()-Number(cached.savedAt)>ttlMs)throw networkError;return{...cached.result,cache_info:{savedAt:Number(cached.savedAt),ageMs:Date.now()-Number(cached.savedAt)}};}catch(_){throw networkError;}
      }
    }
    store(url,result){
      try{localStorage.setItem(`${this.prefix}${url}`,JSON.stringify({savedAt:Date.now(),result}));const keys=Object.keys(localStorage).filter(key=>key.startsWith(this.prefix));if(keys.length>this.maximumEntries)keys.map(key=>({key,savedAt:JSON.parse(localStorage.getItem(key)||'{}').savedAt||0})).sort((a,b)=>a.savedAt-b.savedAt).slice(0,keys.length-this.maximumEntries).forEach(item=>localStorage.removeItem(item.key));}catch(_){}
    }
    rebaseArrivals(result){
      if(!result?.cache_info||!Array.isArray(result.data))return result;
      const now=new Date(),currentSeconds=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
      result.data=result.data.map(item=>{const parts=String(item.arrival_time||item.departure_time||'').split(':').map(Number);if(parts.length!==3||parts.some(value=>!Number.isFinite(value)))return item;const waitSeconds=parts[0]*3600+parts[1]*60+parts[2]-currentSeconds;return waitSeconds< -60?null:{...item,minutes:Math.max(0,Math.ceil(waitSeconds/60))};}).filter(Boolean);return result;
    }
  }

  window.MariBusTransitServices=Object.freeze({JourneyState,adviseLeaveNow,occupancy,StaticApiCache});
})();
