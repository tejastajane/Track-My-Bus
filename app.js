/**
 * Where's My Bus? - MSRTC Live Bus Tracking System
 * Core Web Application Logic & Telemetry Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Application State
  const state = {
    currentScreen: 'splash-view',
    navigationStack: ['home-view'],
    currentLanguage: (() => {
      try {
        const saved = localStorage.getItem('wmb_language');
        if (saved && (saved === 'en' || saved === 'mr' || saved === 'hi')) return saved;
      } catch(e) {}
      return 'en';
    })(),
    activeModalId: null,
    modalTriggerElement: null,
    activeStop: null,
    hasUserSelectedStop: false,
    userSelectedStopId: (() => {
      try { return localStorage.getItem('wmb_user_selected_stop') || null; } catch(e) { return null; }
    })(),
    selectedBus: null,
    userCoords: null,
    isGpsActive: false,
    isAccurateGps: false,
    isCoarseNetwork: false,
    coarseNetworkCoords: null,
    gpsRequestVersion: 0,
    userLocationUpdatedAt: 0,
    gpsLocationError: null,
    currentUser: (() => {
      try { return JSON.parse(localStorage.getItem('wmb_currentUser')) || null; } catch(e) { return null; }
    })(),
    favorites: (() => {
      try { return JSON.parse(localStorage.getItem('wmb_favorites')) || ['NSK-CBS', 'NSK-RD', 'NSK-TRB']; } catch(e) { return ['NSK-CBS', 'NSK-RD', 'NSK-TRB']; }
    })(),
    lastViewedStopId: localStorage.getItem('wmb_last_viewed_stop') || 'NSK-CBS',
    feedbackList: (() => {
      try { return JSON.parse(localStorage.getItem('wmb_feedbacks')) || []; } catch(e) { return []; }
    })(),
    mapInstance: null,
    activeTileLayer: null,
    activeLayerIndex: 0,
    busMarker: null,
    stopMarker: null,
    userLocationMarker: null,
    userAccuracyCircle: null,
    routePolylineCasing: null,
    routePolylineCore: null,
    intermediateMarkers: [],
    followBus: true,
    simulationInterval: null,
    busRoadPath: [],
    busRouteIndex: 0,
    busTargetStopIndex: 0,
    isCameraScanning: false,
    qrScanTimer: null,
    isQrProcessing: false,
    cameraStream: null,
    videoTrack: null,
    isTorchOn: false,
    barcodeDetector: (typeof window !== 'undefined' && 'BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null,
    lastScrollTime: 0,
    notifications: {
      km10: true,
      km5: true,
      km2: true,
      arriving: true,
      delayed: true,
      cancelled: true
    },
    communityReportsList: [...SMART_ST_DATA.communityReports],
    isVoicePlaying: false,
    currentAudio: null
  };

  // Helpers to retrieve display strings based on selected language (English by default)
  function getStopDisplayName(st) {
    if (!st) return '';
    if (state.currentLanguage === 'mr') return st.nameMr || st.name;
    if (state.currentLanguage === 'hi') return st.nameHi || st.nameMr || st.name;
    return st.name; // English by default
  }

  function getBusDestination(bus) {
    if (!bus) return '';
    if (state.currentLanguage === 'mr') return bus.destinationMr || bus.destination;
    if (state.currentLanguage === 'hi') return bus.destinationHi || bus.destinationMr || bus.destination;
    return bus.destination; // English by default
  }

  function getBusRouteName(bus) {
    if (!bus) return '';
    if (state.currentLanguage === 'mr') return bus.routeNameMr || bus.routeName;
    if (state.currentLanguage === 'hi') return bus.routeNameHi || bus.routeNameMr || bus.routeName;
    return bus.routeName; // English by default
  }

  function getTimelineStatusLabel(status) {
    const lang = state.currentLanguage;
    if (status === 'covered') {
      return lang === 'mr' ? 'कव्हर झाले' : (lang === 'hi' ? 'कवर हुआ' : 'Covered');
    }
    if (status === 'current') {
      return lang === 'mr' ? 'पुढील थांबा • जवळ येत आहे' : (lang === 'hi' ? 'अगला स्टॉप • आ रहा है' : 'Next Stop • Approaching');
    }
    return lang === 'mr' ? 'कवर होणार' : (lang === 'hi' ? 'आने वाला' : 'To be Covered');
  }

  // Data Freshness Engine (Truthful Telemetry Contract)
  function formatDataFreshness(timestamp = new Date(), isSimulated = true) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
    
    let ageStr = 'just now';
    if (diffSec < 60) {
      ageStr = `${diffSec}s ago`;
    } else if (diffSec < 3600) {
      ageStr = `${Math.floor(diffSec / 60)}m ago`;
    } else {
      ageStr = `${Math.floor(diffSec / 3600)}h ago`;
    }

    const lang = state.currentLanguage;
    if (isSimulated) {
      const label = lang === 'mr' ? `अपडेट ${ageStr} · थेट GPS` : 
                    (lang === 'hi' ? `अपडेट ${ageStr} · लाइव GPS` : `Updated ${ageStr} · Live GPS`);
      return {
        type: 'live',
        ageStr,
        label,
        html: `<span class="freshness-tag live"><span class="freshness-dot"></span><span>${label}</span></span>`
      };
    } else {
      const label = lang === 'mr' ? 'वेळापत्रक · थेट फीड नाही' : 
                    (lang === 'hi' ? 'समय-सारणी · कोई लाइव फीड नहीं' : 'Scheduled · No live feed');
      return {
        type: 'scheduled',
        ageStr,
        label,
        html: `<span class="freshness-tag scheduled"><span class="freshness-dot"></span><span>${label}</span></span>`
      };
    }
  }

  // --------------------------------------------------------------------------
  // Navigation & Screen Switcher
  // --------------------------------------------------------------------------

  function goBack() {
    if (state.navigationStack.length > 1) {
      state.navigationStack.pop(); // Pop current screen
      const prevScreen = state.navigationStack[state.navigationStack.length - 1];
      navigateTo(prevScreen, { isBack: true });
    } else {
      navigateTo('home-view', { isBack: true });
    }
  }

  function navigateTo(screenId, params = {}) {
    console.log(`[WMB] Navigating to screen: ${screenId}`);
    
    // Update navigation history stack
    if (!params.isBack) {
      if (screenId === 'home-view' || screenId === 'splash-view') {
        state.navigationStack = [screenId];
      } else {
        if (state.navigationStack[state.navigationStack.length - 1] !== screenId) {
          state.navigationStack.push(screenId);
        }
      }
    }

    // Stop camera if leaving scanner
    if (state.currentScreen === 'scanner-view' && screenId !== 'scanner-view') {
      stopCameraScan();
    }

    // Stop live tracking simulation if leaving tracking view
    if (state.currentScreen === 'tracking-view' && screenId !== 'tracking-view') {
      stopLiveBusSimulation();
    }

    // Hide all screen views
    document.querySelectorAll('.screen-view').forEach(view => {
      view.classList.remove('active');
    });

    // Show target screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
      targetScreen.classList.add('active');
      state.currentScreen = screenId;
      window.scrollTo(0, 0);
    }

    // Contextual Header Management: 5 Main Navigation screens vs Child screens
    const brandSection = document.getElementById('header-brand-section');
    const childNav = document.getElementById('header-child-nav');
    const contextTitle = document.getElementById('header-context-title');

    // The 5 main navigation pages (Home, Live Map, Scan QR, Planner, Account) show the main brand title bar
    const mainNavScreens = ['home-view', 'tracking-view', 'scanner-view', 'planner-view', 'account-view', 'splash-view'];

    if (brandSection && childNav && contextTitle) {
      if (mainNavScreens.includes(screenId)) {
        brandSection.style.display = 'flex';
        childNav.style.display = 'none';
      } else {
        brandSection.style.display = 'none';
        childNav.style.display = 'flex';

        const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;
        const titles = {
          'routes-view': dict.navRoutes ? `${dict.navRoutes} & Timetable` : 'Bus Routes & Timetable',
          'stop-view': dict.navRoutes ? `${dict.navRoutes} & Stops` : 'Bus Routes & Stops',
          'stop-info-view': (state.activeStop ? getStopDisplayName(state.activeStop) : 'Bus Stop Details'),
          'nearby-stops-view': dict.navNearby ? `${dict.navNearby} Bus Stops` : 'Nearby Bus Stops',
          'bus-details-view': 'Bus Route Details',
          'schedule-view': dict.btnTimeTable || 'Timetable & Schedule',
          'community-view': dict.navReports || 'Community Reports',
          'admin-view': 'Admin Portal (Prototype)',
          'accessibility-view': 'Accessibility & Display'
        };
        contextTitle.textContent = titles[screenId] || 'Track My Bus';
      }
    }

    // Update bottom nav active state with screen-to-tab mapping
    const navMapping = {
      'home-view': 'home-view',
      'tracking-view': 'tracking-view',
      'scanner-view': 'scanner-view',
      'planner-view': 'planner-view',
      'account-view': 'account-view',
      'accessibility-view': 'account-view',
      'notifications-view': 'account-view'
    };
    const activeNavTarget = navMapping[screenId] || screenId;

    document.querySelectorAll('.nav-item').forEach(nav => {
      if (nav.dataset.screenTarget === activeNavTarget) {
        nav.classList.add('active');
        nav.setAttribute('aria-current', 'page');
      } else {
        nav.classList.remove('active');
        nav.removeAttribute('aria-current');
      }
    });

    // Trigger Screen-Specific Hooks
    if (screenId === 'home-view') {
      renderHomeDashboard();
    } else if (screenId === 'routes-view' || screenId === 'stop-view') {
      renderRoutesScreen();
    } else if (screenId === 'account-view') {
      renderAccountScreen();
    } else if (screenId === 'tracking-view') {
      if (params.busId) {
        const found = SMART_ST_DATA.buses.find(b => b.id === params.busId);
        if (found) state.selectedBus = found;
      }
      if (!state.selectedBus) {
        state.selectedBus = SMART_ST_DATA.buses[0];
      }
      if (!state.activeStop) {
        const b = state.selectedBus;
        state.activeStop = (SMART_ST_DATA.busStops && SMART_ST_DATA.busStops.find(s => s.id === b.targetStopId)) ||
          (b.intermediateStops && SMART_ST_DATA.busStops && SMART_ST_DATA.busStops.find(s => s.name === b.intermediateStops[0]?.name)) ||
          (SMART_ST_DATA.busStops && SMART_ST_DATA.busStops[0]);
      }
      renderTrackingScreen();
    } else if (screenId === 'bus-details-view') {
      if (params.busId) {
        const found = SMART_ST_DATA.buses.find(b => b.id === params.busId);
        if (found) state.selectedBus = found;
      }
      renderBusDetailsScreen();
    } else if (screenId === 'scanner-view') {
      startCameraScan();
      renderNearbyBusStops();
    } else if (screenId === 'stop-info-view') {
      renderStopInfoScreen();
    } else if (screenId === 'schedule-view') {
      renderScheduleScreen();
    } else if (screenId === 'community-view') {
      renderCommunityReportsScreen();
    } else if (screenId === 'admin-view') {
      renderAdminDashboardScreen();
    } else if (screenId === 'nearby-stops-view') {
      renderNearbyStopsScreen();
    }
  }

  // --------------------------------------------------------------------------
  // Multilingual & Translation Engine
  // --------------------------------------------------------------------------

  function updateAppLanguage(langCode, options = {}) {
    state.currentLanguage = langCode;
    try { localStorage.setItem('wmb_language', langCode); } catch(e) {}
    document.documentElement.lang = langCode;
    const dict = SMART_ST_DATA.i18n[langCode] || SMART_ST_DATA.i18n.en;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key === 'appName') {
        const brandMap = {
          en: 'Track My <span class="brand-accent">Bus</span>',
          mr: 'माझी बस <span class="brand-accent">ट्रॅक करा</span>',
          hi: 'मेरी बस <span class="brand-accent">ट्रैक करें</span>'
        };
        el.innerHTML = brandMap[langCode] || dict[key];
        return;
      }
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      if (dict[key]) {
        el.placeholder = dict[key];
      }
    });

    // Update active highlight on all language selector buttons
    document.querySelectorAll('.lang-selector-btn').forEach(btn => {
      if (btn.dataset.lang === langCode) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });

    const langLabels = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };
    const headerLangText = document.getElementById('header-current-lang-text');
    if (headerLangText) {
      headerLangText.textContent = langLabels[langCode] || langCode;
    }

    // Refresh contextual header title if currently on a child screen
    const contextTitle = document.getElementById('header-context-title');
    if (contextTitle && state.currentScreen && state.currentScreen !== 'home-view' && state.currentScreen !== 'splash-view') {
      const titles = {
        'tracking-view': (state.selectedBus ? `${state.selectedBus.id.replace('BUS-', 'Bus ')} · Live Tracking` : 'Live Bus Tracking'),
        'routes-view': dict.navRoutes ? `${dict.navRoutes} & Timetable` : 'Bus Routes & Timetable',
        'stop-view': dict.navRoutes ? `${dict.navRoutes} & Stops` : 'Bus Routes & Stops',
        'stop-info-view': (state.activeStop ? getStopDisplayName(state.activeStop) : 'Bus Stop Details'),
        'nearby-stops-view': dict.navNearby ? `${dict.navNearby} Bus Stops` : 'Nearby Bus Stops',
        'scanner-view': dict.navScanner || 'Scan Bus Stop QR',
        'account-view': dict.navAccount ? `${dict.navAccount} & Passes` : 'My Account & Passes',
        'bus-details-view': 'Bus Route Details',
        'schedule-view': dict.btnTimeTable || 'Timetable & Schedule',
        'community-view': dict.navReports || 'Community Reports',
        'admin-view': 'Admin Portal (Prototype)',
        'accessibility-view': 'Accessibility & Display'
      };
      if (titles[state.currentScreen]) {
        contextTitle.textContent = titles[state.currentScreen];
      }
    }

    if (!options.silent) {
      showToast(`Language set to ${langLabels[langCode] || langCode.toUpperCase()}`);
    }

    if (state.isVoicePlaying) {
      stopAllAudio();
    }
    
    // Re-render active view to refresh dynamic text
    if (state.currentScreen === 'tracking-view') {
      const bus = state.selectedBus;
      renderTripDetailsTimeline(bus);
      renderMapBusChips();

      const voiceBtnLabel = document.getElementById('tracking-voice-btn-label');
      if (voiceBtnLabel && !state.isVoicePlaying) {
        voiceBtnLabel.textContent = dict.voiceAlertBtn || 'Voice Alert';
      }

      const routeEl = document.getElementById('track-bus-route');
      if (routeEl) routeEl.textContent = getBusRouteName(bus);

      const targetStop = bus.intermediateStops && (bus.intermediateStops.find(s => s.isCurrentTarget) || bus.intermediateStops[0]);
      if (targetStop) {
        const bannerTitle = document.getElementById('map-banner-title');
        if (bannerTitle) {
          const prefix = langCode === 'mr' ? 'कडे मार्गस्थ: ' : (langCode === 'hi' ? 'की ओर अग्रसर: ' : 'En Route to ');
          bannerTitle.textContent = `${prefix}${getStopDisplayName(targetStop)}`;
        }
      }
      const prevStopObj = bus.intermediateStops && (bus.intermediateStops.find(s => s.name === bus.previousStop) || bus.intermediateStops[0]);
      const nextStopObj = bus.intermediateStops && (bus.intermediateStops.find(s => s.name === bus.nextStop) || bus.intermediateStops[1]);
      if (prevStopObj) {
        const pEl = document.getElementById('trip-prev-stop');
        if (pEl) pEl.textContent = getStopDisplayName(prevStopObj);
      }
      if (nextStopObj) {
        const nEl = document.getElementById('trip-next-stop');
        if (nEl) nEl.textContent = getStopDisplayName(nextStopObj);
      }
    } else {
      navigateTo(state.currentScreen);
    }
  }

  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // LIVE MAP VOICE ALERT ENGINE (GEMINI 3.1 FLASH TTS - SERVER MANAGED)
  // --------------------------------------------------------------------------

  function setLiveMapVoiceUIState(status) {
    state.isVoicePlaying = (status === 'playing' || status === 'generating');
    const headerBtn = document.getElementById('btn-tracking-voice-alert');
    const floatingBtn = document.getElementById('btn-map-floating-voice');
    const labelEl = document.getElementById('tracking-voice-btn-label');
    const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;

    if (headerBtn) {
      headerBtn.classList.toggle('generating', status === 'generating');
      headerBtn.classList.toggle('playing', status === 'playing');
      headerBtn.setAttribute('aria-pressed', status === 'playing' ? 'true' : 'false');
    }

    if (floatingBtn) {
      floatingBtn.classList.toggle('generating', status === 'generating');
      floatingBtn.classList.toggle('playing', status === 'playing');
      floatingBtn.setAttribute('aria-pressed', status === 'playing' ? 'true' : 'false');
    }

    if (labelEl) {
      if (status === 'playing') {
        labelEl.textContent = dict.voiceAlertPlaying || 'Announcing...';
      } else if (status === 'generating') {
        labelEl.textContent = dict.generatingTtsAnnouncement || 'Preparing Audio...';
      } else {
        labelEl.textContent = dict.voiceAlertBtn || 'Voice Alert';
      }
    }
  }

  function stopAllAudio() {
    if (state.currentAudio) {
      try {
        state.currentAudio.pause();
        state.currentAudio.currentTime = 0;
      } catch(e) {}
      state.currentAudio = null;
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch(e) {}
    }
    state.isVoicePlaying = false;
    setLiveMapVoiceUIState('idle');
  }

  function playNativeSpeechFallback(text, lang, dict) {
    if (!('speechSynthesis' in window)) {
      setLiveMapVoiceUIState('idle');
      state.isVoicePlaying = false;
      showToast(dict.voiceAlertError || 'Voice alert is currently unavailable.');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (lang === 'mr') utterance.lang = 'mr-IN';
      else if (lang === 'hi') utterance.lang = 'hi-IN';
      else utterance.lang = 'en-IN';
      utterance.rate = 0.95;

      setLiveMapVoiceUIState('playing');
      showToast(dict.voiceAlertPlaying || 'Announcing Bus Arrival...');

      utterance.onend = () => {
        setLiveMapVoiceUIState('idle');
        state.isVoicePlaying = false;
      };
      utterance.onerror = () => {
        setLiveMapVoiceUIState('idle');
        state.isVoicePlaying = false;
        showToast(dict.voiceAlertError || 'Voice alert error.');
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      setLiveMapVoiceUIState('idle');
      state.isVoicePlaying = false;
      showToast(dict.voiceAlertError || 'Voice alert error.');
    }
  }

  async function playLiveMapVoiceAlert() {
    const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;

    // If currently playing, clicking toggles off
    if (state.isVoicePlaying) {
      stopAllAudio();
      return;
    }

    // Determine current bus
    const bus = state.selectedBus || (SMART_ST_DATA.buses && SMART_ST_DATA.buses[0]);
    if (!bus) {
      showToast(dict.voiceAlertError || 'Voice alert is currently unavailable.');
      return;
    }

    const lang = state.currentLanguage || 'en';
    let text = bus.voiceScriptMr;
    if (lang === 'en') text = bus.voiceScriptEn;
    else if (lang === 'hi') text = bus.voiceScriptHi;

    if (!text) {
      const busNum = bus.number || bus.busNumber || bus.id;
      text = `Bus ${busNum} approaching station.`;
    }

    // Fast offline fallback to device synthesis
    if (!navigator.onLine) {
      playNativeSpeechFallback(text, lang, dict);
      return;
    }

    setLiveMapVoiceUIState('generating');

    try {
      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 18000);

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: text,
          lang: lang,
          busId: bus.id || bus.busNumber || 'default'
        })
      });
      clearTimeout(timeoutTimer);

      if (!res.ok) {
        console.warn('[Gemini TTS] Endpoint returned status', res.status, 'falling back to device speech');
        playNativeSpeechFallback(text, lang, dict);
        return;
      }

      const blob = await res.blob();
      if (!blob || blob.size < 50) {
        console.warn('[Gemini TTS] Empty or short audio received, falling back to device speech');
        playNativeSpeechFallback(text, lang, dict);
        return;
      }

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      state.currentAudio = audio;
      setLiveMapVoiceUIState('playing');
      showToast(dict.voiceAlertPlaying || 'Announcing Bus Arrival...');

      audio.onended = () => {
        setLiveMapVoiceUIState('idle');
        URL.revokeObjectURL(audioUrl);
        state.currentAudio = null;
        state.isVoicePlaying = false;
      };

      audio.onerror = (e) => {
        console.warn('[Gemini TTS Audio Error, falling back to device speech]', e);
        setLiveMapVoiceUIState('idle');
        URL.revokeObjectURL(audioUrl);
        state.currentAudio = null;
        playNativeSpeechFallback(text, lang, dict);
      };

      await audio.play();
    } catch (err) {
      console.warn('[Live Map Voice Alert Error, falling back]', err);
      playNativeSpeechFallback(text, lang, dict);
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 2: CAMERA & QR SCANNER SIMULATOR
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // SCREEN 2: FUNCTIONAL CAMERA & QR SCANNER ENGINE
  // --------------------------------------------------------------------------

  function playScanSuccessBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      if (navigator.vibrate) navigator.vibrate(90);
    } catch (e) {
      // audio feedback fallback
    }
  }

  function handleScannedQr(rawText) {
    if (state.isQrProcessing) return;
    const text = (rawText || '').trim();
    if (!text) return;

    state.isQrProcessing = true;
    playScanSuccessBeep();

    const scanFrame = document.getElementById('scan-target-frame');
    if (scanFrame) scanFrame.classList.add('scan-success');

    console.log('[WMB] QR Code detected:', text);

    // Extract potential stop code or URL param (e.g. ?stop=NPH-01 or MSRTC-MH15-NPH01)
    let queryCode = text;
    const urlMatch = text.match(/[?&]stop=([^&]+)/i);
    if (urlMatch) {
      queryCode = decodeURIComponent(urlMatch[1]);
    }

    // Try finding matching stop in SMART_ST_DATA.busStops
    let matchedStop = SMART_ST_DATA.busStops.find(s => {
      if (s.qrCode && s.qrCode.toLowerCase() === queryCode.toLowerCase()) return true;
      if (s.id && s.id.toLowerCase() === queryCode.toLowerCase()) return true;
      if (s.name && s.name.toLowerCase().includes(queryCode.toLowerCase())) return true;
      if (s.nameMr && s.nameMr.includes(queryCode)) return true;
      return false;
    });

    // If still not matched, check intermediate stops across routes
    if (!matchedStop && SMART_ST_DATA.buses) {
      for (const b of SMART_ST_DATA.buses) {
        if (b.intermediateStops) {
          const st = b.intermediateStops.find(s => 
            (s.name && s.name.toLowerCase().includes(queryCode.toLowerCase())) ||
            (s.nameMr && s.nameMr.includes(queryCode))
          );
          if (st) {
            matchedStop = SMART_ST_DATA.busStops.find(bs => bs.name.toLowerCase() === st.name.toLowerCase()) || {
              id: `ST-${st.roadIndex || 1}`,
              qrCode: queryCode,
              name: st.name,
              nameMr: st.nameMr,
              village: st.name.split(' ')[0],
              taluka: 'Nashik District',
              district: 'Nashik',
              pincode: '422001',
              latitude: st.lat,
              longitude: st.lng,
              landmark: `Near ${st.name} Highway Corridor`,
              photo: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800&q=80',
              facilities: [
                { name: 'Passenger Bench', nameMr: 'बैठक बाकडा', icon: 'bench', status: 'Available' },
                { name: 'Rain Shade', nameMr: 'पक्का शेड', icon: 'shade', status: 'Available' }
              ],
              emergencyContacts: [
                { role: 'MSRTC Control Room', number: '1800-22-1250', icon: 'phone' }
              ]
            };
            break;
          }
        }
      }
    }

    // Default to Niphad if generic or unknown QR code
    if (!matchedStop) {
      matchedStop = SMART_ST_DATA.busStops[0];
    }

    setTimeout(() => {
      if (scanFrame) scanFrame.classList.remove('scan-success');
      state.isQrProcessing = false;
      showToast(`QR Code Scanned: ${getStopDisplayName(matchedStop)}`);
      openLiveMapForStop(matchedStop);
    }, 400);
  }

  function startCameraScan() {
    state.isCameraScanning = true;
    state.isQrProcessing = false;
    const video = document.getElementById('camera-video-element');
    const canvas = document.getElementById('qr-scan-canvas');
    const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: { ideal: "environment" },
          width: { ideal: 640 },
          height: { ideal: 480 }
        } 
      })
      .then(stream => {
        state.cameraStream = stream;
        state.videoTrack = stream.getVideoTracks()[0] || null;
        state.isTorchOn = false;
        updateTorchUI();

        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.play().catch(() => {});
        }

        // Start scanning frames in real-time
        if (state.qrScanTimer) clearInterval(state.qrScanTimer);
        state.qrScanTimer = setInterval(() => {
          if (!state.isCameraScanning || state.isQrProcessing || !video || !canvas || !ctx) return;
          if (video.readyState < video.HAVE_CURRENT_DATA) return;

          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 320;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Fast native BarcodeDetector scan if available
          if (state.barcodeDetector) {
            state.barcodeDetector.detect(canvas)
              .then(barcodes => {
                if (barcodes && barcodes.length > 0) {
                  const val = barcodes[0].rawValue;
                  if (val) handleScannedQr(val);
                } else {
                  scanWithJsQR(canvas, ctx);
                }
              })
              .catch(() => {
                scanWithJsQR(canvas, ctx);
              });
          } else {
            scanWithJsQR(canvas, ctx);
          }
        }, 180);
      })
      .catch(err => {
        console.warn("[WMB] Camera access restricted or unavailable:", err);
      });
    }
  }

  function scanWithJsQR(canvas, ctx) {
    if (typeof jsQR === 'undefined' || !canvas || !ctx) return;
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: "dontInvert"
      });
      if (code && code.data) {
        handleScannedQr(code.data);
      }
    } catch (e) {
      // frame processing skipped
    }
  }

  function stopCameraScan() {
    state.isCameraScanning = false;
    if (state.qrScanTimer) {
      clearInterval(state.qrScanTimer);
      state.qrScanTimer = null;
    }
    if (state.videoTrack) {
      try {
        if (state.isTorchOn) {
          state.videoTrack.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
      } catch (e) {}
      state.videoTrack = null;
    }
    state.isTorchOn = false;
    updateTorchUI();

    const video = document.getElementById('camera-video-element');
    if (video && video.srcObject) {
      const tracks = video.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      video.srcObject = null;
    }
    state.cameraStream = null;
    const scanFrame = document.getElementById('scan-target-frame');
    if (scanFrame) scanFrame.classList.remove('scan-success');
  }

  async function toggleTorch() {
    if (!state.videoTrack) {
      showToast('Camera is not active. Please start camera scanner first.');
      return;
    }

    try {
      const capabilities = typeof state.videoTrack.getCapabilities === 'function' 
        ? state.videoTrack.getCapabilities() 
        : {};

      if (!capabilities.torch) {
        showToast('Flashlight/Torch is not supported on this camera/device.');
        return;
      }

      state.isTorchOn = !state.isTorchOn;
      await state.videoTrack.applyConstraints({
        advanced: [{ torch: state.isTorchOn }]
      });

      updateTorchUI();
      showToast(state.isTorchOn ? 'Torch turned ON' : 'Torch turned OFF');
    } catch (err) {
      console.warn('[WMB] Torch toggle failed:', err);
      state.isTorchOn = false;
      updateTorchUI();
      showToast('Flashlight/Torch is not available on this device.');
    }
  }

  function updateTorchUI() {
    const btn = document.getElementById('btn-toggle-torch');
    const label = document.getElementById('torch-label');
    if (!btn) return;
    if (state.isTorchOn) {
      btn.classList.add('btn-torch-active');
      if (label) label.textContent = 'Torch On';
    } else {
      btn.classList.remove('btn-torch-active');
      if (label) label.textContent = 'Torch';
    }
  }

  // --------------------------------------------------------------------------
  // UPCOMING BUS SELECTOR & LIVE MAP CONNECTOR
  // --------------------------------------------------------------------------

  function findBestUpcomingBusForStop(stop) {
    if (!stop) return null;
    const stopName = (stop.name || '').toLowerCase();
    const stopMr = (stop.nameMr || '').trim();

    const candidates = [];

    SMART_ST_DATA.buses.forEach(b => {
      if (!b.intermediateStops) return;

      let stopIdx = b.intermediateStops.findIndex(s => {
        if (s.name && s.name.toLowerCase() === stopName) return true;
        if (s.nameMr && stopMr && s.nameMr.trim() === stopMr) return true;
        if (s.lat && s.lng && stop.latitude && stop.longitude) {
          return calculateDistanceKm(s.lat, s.lng, stop.latitude, stop.longitude) < 0.8;
        }
        return false;
      });

      if (stopIdx === -1) return;

      let targetIdx = b.intermediateStops.findIndex(s => s.isCurrentTarget);
      if (targetIdx === -1) {
        targetIdx = b.intermediateStops.findIndex(s => s.status !== 'Departed');
      }

      const isPassed = (targetIdx === -1) || (targetIdx > stopIdx);

      // Realistic ETA in minutes to this stop
      let etaMins = 0;
      let distKm = 0;
      if (stop.latitude && stop.longitude && b.currentLat && b.currentLng) {
        distKm = calculateDistanceKm(b.currentLat, b.currentLng, stop.latitude, stop.longitude);
        const stopsBetween = Math.max(0, stopIdx - Math.max(0, targetIdx));
        etaMins = Math.max(2, Math.round((distKm / 38) * 60 + stopsBetween * 2 + (b.delayMinutes || 0)));
      } else {
        etaMins = b.etaMinutes || 15;
      }

      candidates.push({
        bus: b,
        stopIdx,
        targetIdx,
        isPassed,
        isUpcoming: !isPassed,
        etaMins,
        distKm
      });
    });

    if (candidates.length === 0) {
      // Connecting corridor fallback for suburban/neighborhood local stops
      // Connect to nearest major Nashik transit hub (CBS, Nimani, Dwarka, Nashik Road)
      const hubs = [
        { id: 'NSK-CBS', name: 'Nashik CBS', lat: 19.9984, lng: 73.7865 },
        { id: 'NSK-NMN', name: 'Nimani Bus Stand', lat: 20.0105, lng: 73.7952 },
        { id: 'NSK-DWK', name: 'Dwarka Circle', lat: 19.9882, lng: 73.8025 },
        { id: 'NSK-RD', name: 'Nashik Road', lat: 19.9535, lng: 73.8445 }
      ];

      let nearestHub = hubs[0];
      let minHubDist = Infinity;
      if (stop.latitude && stop.longitude) {
        hubs.forEach(h => {
          const d = calculateDistanceKm(stop.latitude, stop.longitude, h.lat, h.lng);
          if (d < minHubDist) {
            minHubDist = d;
            nearestHub = h;
          }
        });
      }

      if (SMART_ST_DATA.buses && SMART_ST_DATA.buses.length > 0) {
        const hubBus = SMART_ST_DATA.buses.find(b => b.origin && b.origin.toLowerCase().includes(nearestHub.name.toLowerCase().split(' ')[0])) || SMART_ST_DATA.buses[0];
        const transferMins = Math.max(5, Math.round(minHubDist * 4));
        return {
          bus: hubBus,
          etaMinutes: (hubBus.etaMinutes || 12) + transferMins,
          distanceKm: minHubDist,
          isPassed: false,
          connectingHubName: nearestHub.name,
          upcomingCandidates: [hubBus]
        };
      }
      return null;
    }

    const upcoming = candidates.filter(c => c.isUpcoming);

    if (upcoming.length > 0) {
      upcoming.sort((a, b) => a.etaMins - b.etaMins);
      return {
        bus: upcoming[0].bus,
        etaMinutes: upcoming[0].etaMins,
        distanceKm: upcoming[0].distKm,
        isPassed: false,
        connectingHubName: null,
        upcomingCandidates: upcoming.map(u => u.bus)
      };
    }

    candidates.sort((a, b) => a.targetIdx - b.targetIdx);
    return {
      bus: candidates[0].bus,
      etaMinutes: candidates[0].etaMins,
      distanceKm: candidates[0].distKm,
      isPassed: true,
      connectingHubName: null,
      upcomingCandidates: []
    };
  }

  function openLiveMapForStop(stop) {
    const targetStop = resolveStopObject(stop.id || stop.name) || stop;
    state.activeStop = targetStop;
    state.hasUserSelectedStop = true;
    state.userSelectedStopId = targetStop.id;
    state.lastViewedStopId = targetStop.id;
    try {
      localStorage.setItem('wmb_last_viewed_stop', targetStop.id);
      localStorage.setItem('wmb_user_selected_stop', targetStop.id);
    } catch(e) {}

    // Automatically select the next UPCOMING bus for this stop
    const upcomingResult = findBestUpcomingBusForStop(targetStop);
    if (upcomingResult && upcomingResult.bus) {
      state.selectedBus = upcomingResult.bus;
      if (!upcomingResult.isPassed) {
        showToast(`${getStopDisplayName(targetStop)}: Next bus arriving in ${upcomingResult.etaMinutes}m`);
      } else {
        showToast(`Connected to ${getStopDisplayName(targetStop)}`);
      }
    } else {
      state.selectedBus = SMART_ST_DATA.buses[0];
      showToast(`Connected to ${getStopDisplayName(targetStop)}`);
    }

    navigateTo('tracking-view', { busId: state.selectedBus.id });
  }

  const HIGH_ACCURACY_THRESHOLD_METERS = 1500;

  function requestUserGpsLocation(onSuccess, onError) {
    if (!navigator.geolocation) {
      if (onError) onError(new Error('Geolocation not supported'));
      return;
    }

    // Geolocation is asynchronous. A stale result from an earlier request must
    // not replace the position requested most recently by the commuter.
    const requestVersion = ++state.gpsRequestVersion;
    let watchId = null;
    let hasPosition = false;
    let hasReportedError = false;
    const GPS_ACQUIRE_TIMEOUT_MS = 30000;

    const clearLocationWatch = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const applyPosition = (pos, isWatchUpdate = false) => {
      if (requestVersion !== state.gpsRequestVersion) {
        clearLocationWatch();
        return;
      }

      const latitude = Number(pos.coords.latitude);
      const longitude = Number(pos.coords.longitude);
      const accuracy = Number(pos.coords.accuracy);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      // Discard invalid / dummy coordinates (e.g. 0,0)
      if (Math.abs(latitude) < 0.001 && Math.abs(longitude) < 0.001) return;

      const normalizedAccuracy = Number.isFinite(accuracy) ? accuracy : Infinity;
      const isAccurate = normalizedAccuracy <= HIGH_ACCURACY_THRESHOLD_METERS;

      if (isAccurate) {
        state.userCoords = {
          lat: latitude,
          lng: longitude,
          accuracy: normalizedAccuracy
        };
        state.isGpsActive = true;
        state.isAccurateGps = true;
        state.isCoarseNetwork = false;
        state.gpsLocationError = null;
      } else {
        // Coarse network IP estimate (e.g. 100km uncertainty from desktop ISP)
        state.isAccurateGps = false;
        state.isCoarseNetwork = true;
        state.coarseNetworkCoords = {
          lat: latitude,
          lng: longitude,
          accuracy: normalizedAccuracy
        };
        state.isGpsActive = false;
        state.gpsLocationError = new Error('Coarse network IP location only (accuracy > 1.5km)');
      }

      if (hasPosition && !isWatchUpdate) return;

      hasPosition = true;
      state.userLocationUpdatedAt = Date.now();
      if (onSuccess) onSuccess(pos, state.userCoords || state.coarseNetworkCoords);
    };

    const handleError = (err) => {
      if (requestVersion !== state.gpsRequestVersion || hasPosition || hasReportedError) return;
      hasReportedError = true;
      state.isGpsActive = false;
      state.isAccurateGps = false;
      state.gpsLocationError = err;
      if (onError) onError(err);
    };

    // Return the first available browser position immediately so Home does not
    // get stuck, then keep watching briefly for a more accurate device GPS fix.
    navigator.geolocation.getCurrentPosition(
      pos => applyPosition(pos, false),
      handleError,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    watchId = navigator.geolocation.watchPosition(
      pos => applyPosition(pos, true),
      handleError,
      { enableHighAccuracy: true, timeout: GPS_ACQUIRE_TIMEOUT_MS, maximumAge: 0 }
    );

    setTimeout(() => {
      if (requestVersion !== state.gpsRequestVersion) return;
      clearLocationWatch();
      if (!hasPosition) {
        handleError(new Error('Timed out while acquiring location'));
      }
    }, GPS_ACQUIRE_TIMEOUT_MS);
  }

  function getSortedNearbyStops(limit = 6) {
    let userLat = (state.isAccurateGps && state.userCoords) ? Number(state.userCoords.lat) : null;
    let userLng = (state.isAccurateGps && state.userCoords) ? Number(state.userCoords.lng) : null;

    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      const activeOrSelected = (state.userSelectedStopId && resolveStopObject(state.userSelectedStopId)) || state.activeStop;
      if (activeOrSelected && Number.isFinite(Number(activeOrSelected.latitude)) && Number.isFinite(Number(activeOrSelected.longitude))) {
        userLat = Number(activeOrSelected.latitude);
        userLng = Number(activeOrSelected.longitude);
      } else {
        userLat = 19.9975; // Nashik CBS fallback for ranking
        userLng = 73.7898;
      }
    }

    const candidatesMap = new Map();
    SMART_ST_DATA.busStops.forEach(s => candidatesMap.set(s.name, s));

    if (SMART_ST_DATA.buses) {
      SMART_ST_DATA.buses.forEach(b => {
        if (b.intermediateStops) {
          b.intermediateStops.forEach(st => {
            if (Number.isFinite(Number(st.lat)) && Number.isFinite(Number(st.lng)) && !candidatesMap.has(st.name)) {
              candidatesMap.set(st.name, {
                id: `ST-${st.roadIndex || 1}`,
                name: st.name,
                nameMr: st.nameMr || st.name,
                latitude: st.lat,
                longitude: st.lng,
                landmark: b.routeName
              });
            }
          });
        }
      });
    }

    const stopList = Array.from(candidatesMap.values())
      .filter(st => Number.isFinite(Number(st.latitude)) && Number.isFinite(Number(st.longitude)))
      .map(st => {
      const d = calculateDistanceKm(userLat, userLng, st.latitude, st.longitude);
      const upcomingResult = findBestUpcomingBusForStop(st);
      return {
        stop: st,
        distKm: d,
        upcomingBus: upcomingResult ? upcomingResult.bus : null,
        etaMinutes: upcomingResult ? upcomingResult.etaMinutes : null,
        isUpcoming: upcomingResult ? !upcomingResult.isPassed : false
      };
    });

    stopList.sort((a, b) => a.distKm - b.distKm);
    return stopList.slice(0, limit);
  }

  function simulateQRScan(stopId) {
    const targetStop = resolveStopObject(stopId) || SMART_ST_DATA.busStops.find(s => s.id === stopId) || SMART_ST_DATA.busStops[0];
    playScanSuccessBeep();
    openLiveMapForStop(targetStop);
  }

  // --------------------------------------------------------------------------
  // NEARBY BUS STOPS & MANUAL STOP SELECTION FEATURES
  // --------------------------------------------------------------------------

  function resolveStopObject(stopIdOrName) {
    if (!stopIdOrName) return null;
    const term = stopIdOrName.trim().toLowerCase();

    // 1. Match in SMART_ST_DATA.busStops by id, qrCode, name, or nameMr
    let found = SMART_ST_DATA.busStops.find(s => 
      s.id.toLowerCase() === term ||
      s.name.toLowerCase() === term ||
      (s.nameMr && s.nameMr.trim() === stopIdOrName.trim()) ||
      (s.qrCode && s.qrCode.toLowerCase() === term)
    );
    if (found) return found;

    // 2. Search in all bus intermediate stops
    if (SMART_ST_DATA.buses) {
      for (const b of SMART_ST_DATA.buses) {
        if (b.intermediateStops) {
          const st = b.intermediateStops.find(s => 
            s.name.toLowerCase() === term ||
            (s.nameMr && s.nameMr.trim() === stopIdOrName.trim())
          );
          if (st) {
            const synthesizedStop = {
              id: `ST-${st.roadIndex || Math.floor(Math.random() * 1000)}`,
              qrCode: `MSRTC-MH15-${st.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase()}`,
              name: st.name,
              nameMr: st.nameMr || st.name,
              village: st.name.split(' ')[0],
              taluka: b.routeName.split(' to ')[0] || 'Nashik Division',
              district: 'Nashik',
              pincode: '422001',
              latitude: st.lat,
              longitude: st.lng,
              landmark: `Along ${b.routeName} Corridor (NH Highway)`,
              photo: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800&q=80',
              facilities: [
                { name: 'Passenger Bench', nameMr: 'बैठक बाकडा', icon: 'bench', status: 'Available' },
                { name: 'Rain Shade', nameMr: 'पक्का शेड', icon: 'shade', status: 'Available' },
                { name: 'Solar Lighting', nameMr: 'सौर पथदिवे', icon: 'light', status: 'Functional' }
              ],
              emergencyContacts: [
                { role: 'MSRTC Control Room', number: '1800-22-1250', icon: 'phone' },
                { role: 'Police Station', number: '112', icon: 'police' }
              ]
            };
            SMART_ST_DATA.busStops.push(synthesizedStop);
            return synthesizedStop;
          }
        }
      }
    }

    return null;
  }

  function renderNearbyBusStops(customLat, customLng) {
    const container = document.getElementById('nearby-stops-container');
    if (!container) return;

    if (customLat && customLng) {
      state.userCoords = { lat: customLat, lng: customLng, accuracy: 15 };
      state.isGpsActive = true;
      state.isAccurateGps = true;
      state.isCoarseNetwork = false;
    }

    const nearby = getSortedNearbyStops(6);

    container.innerHTML = '';
    nearby.forEach(item => {
      const st = item.stop;
      const dKm = item.distKm;
      const distStr = dKm < 1 ? `${Math.round(dKm * 1000)} m` : `${dKm.toFixed(1)} km`;
      const walkMins = Math.max(1, Math.round(dKm * 12));
      const upBus = item.upcomingBus;

      let upBusBadge = '';
      if (upBus && item.isUpcoming) {
        upBusBadge = `<div class="text-xs text-green font-bold mt-1" style="display:inline-flex; align-items:center; gap:4px;"><span class="pulse-dot"></span> Next: ${upBus.number} (${item.etaMinutes}m)</div>`;
      }

      const card = document.createElement('div');
      card.className = 'nearby-stop-card';
      card.setAttribute('data-stop-id', st.id || st.name);

      card.innerHTML = `
        <div class="nearby-stop-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        </div>
        <div class="nearby-stop-info" style="flex: 1;">
          <div class="nearby-stop-name">${getStopDisplayName(st)}</div>
          <div class="nearby-stop-meta">
            <span class="nearby-dist-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg> ${distStr} away</span>
            <span class="nearby-walk-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ~${walkMins} min walk</span>
          </div>
          ${upBusBadge}
        </div>
        <button class="btn btn-sm btn-primary btn-select-nearby-stop" type="button" style="padding: 6px 12px; font-size: 12px; font-weight: 700;">
          Live Map <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      `;

      card.addEventListener('click', () => {
        openLiveMapForStop(st);
      });

      container.appendChild(card);
    });
  }

  function setupNearbyStopsFeature() {
    // Locate Me GPS Button in Scanner
    const btnLocate = document.getElementById('btn-detect-gps-stops');
    const statusEl = document.getElementById('nearby-gps-status');

    if (btnLocate) {
      btnLocate.addEventListener('click', () => {
        if (statusEl) statusEl.textContent = '● Locating with GPS...';
        showToast('Acquiring live GPS coordinates...');

        requestUserGpsLocation(
          pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (state.isAccurateGps) {
              if (statusEl) statusEl.textContent = `● GPS Located (±${Math.round(pos.coords.accuracy)}m)`;
              renderNearbyBusStops(lat, lng);
              renderHomeNearbyStopCard();
              renderPortalNearbyStopsList();
              showToast('Updated nearby stops based on your location!');
            } else {
              if (statusEl) statusEl.textContent = '● Regional Transit Network';
              renderNearbyBusStops();
              renderHomeNearbyStopCard();
              renderPortalNearbyStopsList();
              showToast('Device GPS unavailable (network IP). Showing regional stops.');
            }
          },
          err => {
            console.warn('[WMB] Geolocation error:', err);
            if (statusEl) statusEl.textContent = '● Regional Transit Network';
            renderNearbyBusStops();
            renderHomeNearbyStopCard();
            showToast('Location permission denied or unavailable. Showing regional stops.');
          }
        );
      });
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 1: HOME TRANSPORTATION DASHBOARD
  // --------------------------------------------------------------------------

  function renderHomeDashboard() {
    const lang = state.currentLanguage;
    const dict = SMART_ST_DATA.i18n[lang] || SMART_ST_DATA.i18n.en;

    // 1. Language Dropdown Indicator
    const langNames = { en: 'English', mr: 'मराठी', hi: 'हिंदी' };
    const langTextEl = document.getElementById('header-current-lang-text');
    if (langTextEl) {
      langTextEl.textContent = langNames[lang] || 'English';
    }

    // 2. Favorites List in Favorites Modal
    renderPortalFavoritesList();

    // 3. Fallback compatibility for any legacy cards
    renderHomeFavoritesList();
    renderHomeServiceStatus();
    renderHomeReportsPreview();

    // 4. Dynamic Live Nearby Bus Stop Card
    renderHomeNearbyStopCard();

    // Ask for location when the commuter reaches Home, not during the splash
    // screen. This ensures the card is populated from their current GPS fix.
    const GPS_LOCATION_MAX_AGE_MS = 60 * 1000;
    const locationIsStale = Date.now() - state.userLocationUpdatedAt > GPS_LOCATION_MAX_AGE_MS;
    if (!state.isGpsActive || !state.userCoords || locationIsStale) {
      requestUserGpsLocation(
        () => renderHomeNearbyStopCard(),
        () => renderHomeNearbyStopCard()
      );
    }
  }

  function renderHomeNearbyStopCard() {
    const card = document.getElementById('home-nearby-card');
    if (!card) return;

    const nameEl = document.getElementById('home-nearby-stop-name');
    const distEl = document.getElementById('home-nearby-stop-dist');
    const busTypeEl = document.getElementById('home-nearby-bus-type');
    const busDestEl = document.getElementById('home-nearby-bus-dest');
    const etaEl = document.getElementById('home-nearby-eta');
    const busBox = document.getElementById('home-nearby-bus-box');

    // 1. Check if user explicitly selected a stop
    const selectedStop = state.userSelectedStopId ? resolveStopObject(state.userSelectedStopId) : null;

    // 2. Check if we have a real high-accuracy GPS fix (accuracy <= 1500m)
    const hasAccurateGps = state.isAccurateGps && state.userCoords &&
      Number.isFinite(Number(state.userCoords.lat)) &&
      Number.isFinite(Number(state.userCoords.lng));

    // If neither high-accuracy GPS nor a user-selected stop is available,
    // keep that location unavailable as it is now.
    if (!hasAccurateGps && !selectedStop) {
      const locationUnavailable = Boolean(state.gpsLocationError || state.isCoarseNetwork);
      if (nameEl) nameEl.textContent = locationUnavailable ? 'Location unavailable' : 'Finding nearest stop…';
      if (distEl) distEl.textContent = locationUnavailable ? 'Open Nearby Bus Stops to retry' : 'Using your location';
      if (busTypeEl) busTypeEl.textContent = locationUnavailable ? 'Could not get your device location' : 'Live arrivals will appear here';
      if (busDestEl) busDestEl.textContent = '';
      if (etaEl) etaEl.textContent = '…';

      card.onclick = (e) => {
        if (e.target.closest('#btn-home-nearby-view-all')) return;
        navigateTo('nearby-stops-view');
      };

      const viewAllBtn = document.getElementById('btn-home-nearby-view-all');
      if (viewAllBtn) {
        viewAllBtn.onclick = (e) => {
          e.stopPropagation();
          navigateTo('nearby-stops-view');
        };
      }
      return;
    }

    let st = null;
    let distStr = '';
    let upcomingBus = null;
    let etaMins = null;

    if (hasAccurateGps) {
      const sortedStops = getSortedNearbyStops(1);
      if (sortedStops.length > 0) {
        const closest = sortedStops[0];
        st = closest.stop;
        const distKm = closest.distKm;
        distStr = distKm < 1 ? `${Math.round(distKm * 1000)} m away` : `${distKm.toFixed(1)} km away`;
        upcomingBus = closest.upcomingBus;
        etaMins = closest.etaMinutes;
      }
    } else if (selectedStop) {
      st = selectedStop;
      distStr = 'Selected Stop';
      const upcomingResult = findBestUpcomingBusForStop(st);
      if (upcomingResult) {
        upcomingBus = upcomingResult.bus;
        etaMins = upcomingResult.etaMinutes;
      }
    }

    if (!st) return;

    if (nameEl) nameEl.textContent = getStopDisplayName(st);
    if (distEl) distEl.textContent = distStr;

    if (upcomingBus) {
      if (busTypeEl) busTypeEl.textContent = upcomingBus.type ? upcomingBus.type.split('(')[0].trim() : 'MSRTC Bus';
      if (busDestEl) busDestEl.textContent = `Towards ${getBusDestination(upcomingBus)}`;
      if (etaEl) etaEl.textContent = `${etaMins != null ? etaMins : '…'} min`;
    } else {
      if (busTypeEl) busTypeEl.textContent = 'MSRTC Bus';
      if (busDestEl) busDestEl.textContent = 'Towards Next Station';
      if (etaEl) etaEl.textContent = 'Soon';
    }

    // Clicking card or bus box opens live map for this stop
    card.onclick = (e) => {
      if (e.target.closest('#btn-home-nearby-view-all')) return;
      openLiveMapForStop(st);
    };

    if (busBox) {
      busBox.onclick = (e) => {
        e.stopPropagation();
        openLiveMapForStop(st);
      };
    }

    const viewAllBtn = document.getElementById('btn-home-nearby-view-all');
    if (viewAllBtn) {
      viewAllBtn.onclick = (e) => {
        e.stopPropagation();
        navigateTo('nearby-stops-view');
      };
    }
  }

  function renderPortalNearbyStopsList() {
    const container = document.getElementById('portal-nearby-stops-list');
    if (!container) return;

    const statusEl = document.getElementById('portal-nearby-gps-status');
    if (statusEl) {
      if (state.isAccurateGps && state.userCoords) {
        statusEl.textContent = `● Live GPS (±${Math.round(state.userCoords.accuracy || 10)}m)`;
        statusEl.style.color = 'var(--status-green)';
      } else if (state.isCoarseNetwork) {
        statusEl.textContent = '● Regional Network (IP)';
        statusEl.style.color = 'var(--text-secondary)';
      } else {
        statusEl.textContent = '● Regional Transit Network';
        statusEl.style.color = 'var(--text-secondary)';
      }
    }

    const sortedStops = getSortedNearbyStops(6);
    container.innerHTML = '';

    if (sortedStops.length === 0) {
      container.innerHTML = '<div class="text-sm text-center p-3 text-secondary">No nearby bus stops found.</div>';
      return;
    }

    sortedStops.forEach(item => {
      const st = item.stop;
      const dKm = item.distKm;
      const distStr = dKm < 1 ? `${Math.round(dKm * 1000)} m away` : `${dKm.toFixed(1)} km away`;
      const walkMins = Math.max(1, Math.round(dKm * 12));
      const upBus = item.upcomingBus;

      const card = document.createElement('div');
      card.className = 'nearby-stop-card';
      card.setAttribute('data-stop-id', st.id || st.name);

      let nextBusHtml = '';
      if (upBus && item.isUpcoming) {
        nextBusHtml = `<div class="text-xs text-green font-bold mt-1" style="display:inline-flex; align-items:center; gap:4px;"><span class="pulse-dot"></span> Next: ${upBus.number} to ${getBusDestination(upBus)} in ${item.etaMinutes}m</div>`;
      } else if (upBus) {
        nextBusHtml = `<div class="text-xs text-secondary mt-1">Bus ${upBus.number} (Scheduled)</div>`;
      }

      card.innerHTML = `
        <div class="nearby-stop-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        </div>
        <div class="nearby-stop-info" style="flex: 1;">
          <div class="nearby-stop-name">${getStopDisplayName(st)}</div>
          <div class="nearby-stop-meta">
            <span class="nearby-dist-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg> ${distStr}</span>
            <span class="nearby-walk-pill"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ~${walkMins} min walk</span>
          </div>
          ${nextBusHtml}
        </div>
        <button class="btn btn-sm btn-primary btn-select-nearby-stop" type="button" style="padding: 6px 12px; font-size: 12px; font-weight: 700; white-space: nowrap;">
          Live Map <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      `;

      card.onclick = () => {
        closeModal('nearby-stops-modal');
        openLiveMapForStop(st);
      };

      container.appendChild(card);
    });
  }

  // --------------------------------------------------------------------------
  // Dedicated Nearby Bus Stops Screen (Apple HIG Minimal Transit Design)
  // --------------------------------------------------------------------------

  const nearbyPageState = {
    searchQuery: '',
    isInitialized: false
  };

  function escapeNearbyHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setupNearbyStopsScreen() {
    if (nearbyPageState.isInitialized) return;
    nearbyPageState.isInitialized = true;

    const searchInput = document.getElementById('nearby-page-search-input');
    const clearBtn = document.getElementById('btn-clear-nearby-search');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        nearbyPageState.searchQuery = (e.target.value || '').trim().toLowerCase();
        if (clearBtn) {
          clearBtn.style.display = nearbyPageState.searchQuery ? 'flex' : 'none';
        }
        renderNearbyStopsCards();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        nearbyPageState.searchQuery = '';
        clearBtn.style.display = 'none';
        renderNearbyStopsCards();
      });
    }
  }

  function renderNearbyStopsScreen() {
    setupNearbyStopsScreen();
    renderNearbyStopsCards();
  }

  function renderNearbyStopsCards() {
    const container = document.getElementById('nearby-page-cards-container');
    if (!container) return;

    // Fetch candidate stops sorted by distance
    const sortedStops = getSortedNearbyStops(50);
    const q = nearbyPageState.searchQuery;

    // Filter by search query
    const filteredStops = sortedStops.filter(item => {
      const st = item.stop;
      if (!st) return false;
      if (!q) return true;

      const nameMatch = (st.name || '').toLowerCase().includes(q);
      const nameMrMatch = (st.nameMr || '').toLowerCase().includes(q);
      const idMatch = (st.id || '').toLowerCase().includes(q);
      const busMatch = item.upcomingBus && (
        (item.upcomingBus.to || '').toLowerCase().includes(q) ||
        (item.upcomingBus.number || '').toLowerCase().includes(q)
      );
      return nameMatch || nameMrMatch || idMatch || busMatch;
    });

    // Display nearest stops (up to 10 for clean scannable Apple list)
    const displayStops = filteredStops.slice(0, 10);

    container.innerHTML = '';

    if (displayStops.length === 0) {
      container.innerHTML = `
        <div class="nearby-empty-state">
          <div class="nearby-empty-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h3 class="nearby-empty-title">No stops found</h3>
          <p class="nearby-empty-subtitle">${q ? `No stops matching &ldquo;${escapeNearbyHtml(q)}&rdquo;` : 'No bus stops available in this area.'}</p>
          ${q ? `<button type="button" class="nearby-empty-reset-btn" id="btn-nearby-reset-search">Clear Search</button>` : ''}
        </div>
      `;
      const resetBtn = document.getElementById('btn-nearby-reset-search');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          const searchInput = document.getElementById('nearby-page-search-input');
          const clearBtn = document.getElementById('btn-clear-nearby-search');
          if (searchInput) searchInput.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          nearbyPageState.searchQuery = '';
          renderNearbyStopsCards();
        });
      }
      return;
    }

    displayStops.forEach(item => {
      const st = item.stop;
      const dKm = item.distKm;
      const distStr = dKm < 1 ? `${Math.round(dKm * 1000)} m` : `${dKm.toFixed(1)} km`;
      const walkMins = Math.max(1, Math.round(dKm * 12));

      const row = document.createElement('div');
      row.className = 'nearby-stop-row';
      row.setAttribute('role', 'listitem');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `${getStopDisplayName(st)}, ${distStr} away`);

      row.innerHTML = `
        <div class="nearby-stop-icon-wrap" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="14" rx="2"/>
            <path d="M7 18v2M17 18v2M3 10h18"/>
            <circle cx="7.5" cy="14.5" r="1"/>
            <circle cx="16.5" cy="14.5" r="1"/>
          </svg>
        </div>
        <div class="nearby-stop-content">
          <div class="nearby-stop-name">${escapeNearbyHtml(getStopDisplayName(st))}</div>
          <div class="nearby-stop-sub">
            <span>${distStr}</span>
            <span class="nearby-stop-meta-dot" aria-hidden="true">·</span>
            <span>~${walkMins} min walk</span>
          </div>
        </div>
        <div class="nearby-stop-trailing">
          <span class="nearby-disclosure-chevron" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </span>
        </div>
      `;

      // Row click or keyboard Enter: open live map for stop
      row.addEventListener('click', () => {
        openLiveMapForStop(st);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLiveMapForStop(st);
        }
      });

      container.appendChild(row);
    });
  }

  function renderPortalFavoritesList() {
    const container = document.getElementById('portal-favorites-list');
    if (!container) return;

    container.innerHTML = '';
    if (!state.favorites || state.favorites.length === 0) {
      container.innerHTML = `
        <div class="text-center p-3" style="color: var(--text-secondary); font-size: 13px;">
          No favorite stops added yet. Tap <strong>+ Add Favorite Bus Stop</strong> to save your daily route!
        </div>
      `;
      return;
    }

    state.favorites.forEach(stopId => {
      const stop = resolveStopObject(stopId);
      if (!stop) return;

      const stopNameLower = (stop.name || '').toLowerCase();
      const bus = SMART_ST_DATA.buses.find(b => 
        b.intermediateStops && b.intermediateStops.some(s => (s.name || '').toLowerCase() === stopNameLower)
      ) || SMART_ST_DATA.buses[0];

      const item = document.createElement('div');
      item.className = 'favorite-search-item';
      item.innerHTML = `
        <div>
          <div style="font-weight: 700; font-size: 14px;">${getStopDisplayName(stop)}</div>
          <div class="text-xs" style="color: var(--text-secondary);">${stop.taluka || 'Nashik'} • Next: ${bus ? bus.etaMinutes + ' min (' + (bus.delayMinutes > 0 ? bus.delayMinutes + 'm delay' : 'On Time') + ')' : 'Scheduled'}</div>
        </div>
        <div class="flex-align gap-2">
          <button class="btn btn-sm btn-primary btn-fav-go" title="View Live Arrivals">
            Arrivals <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </button>
          <button class="icon-btn btn-fav-del" title="Remove" style="font-size: 14px; padding: 4px 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;

      item.querySelector('.btn-fav-go').onclick = () => {
        closeModal('home-favorites-modal');
        openLiveMapForStop(stop);
      };

      item.querySelector('.btn-fav-del').onclick = () => {
        removeFavoriteStop(stop.id);
        renderPortalFavoritesList();
      };

      container.appendChild(item);
    });
  }

  function renderHomeFavoritesList() {
    const container = document.getElementById('home-favorites-list');
    if (!container) return;

    container.innerHTML = '';

    if (!state.favorites || state.favorites.length === 0) {
      container.innerHTML = `
        <div class="text-center p-3" style="color: var(--text-secondary); font-size: 13px;">
          No favorite stops added yet. Tap <strong>+ Add Favorite Stop</strong> to save your daily commute station!
        </div>
      `;
      return;
    }

    state.favorites.forEach(stopId => {
      const stop = resolveStopObject(stopId);
      if (!stop) return;

      // Find an ETA if available for this stop
      const stopNameLower = (stop.name || '').toLowerCase();
      const bus = SMART_ST_DATA.buses.find(b => 
        b.intermediateStops && b.intermediateStops.some(s => (s.name || '').toLowerCase() === stopNameLower)
      ) || SMART_ST_DATA.buses[Math.floor(Math.random() * Math.min(3, SMART_ST_DATA.buses.length))];

      const etaText = bus ? `Next bus · ${bus.etaMinutes} min` : 'No live bus';

      const item = document.createElement('div');
      item.className = 'home-favorite-item';
      item.innerHTML = `
        <div class="home-fav-left">
          <span class="home-fav-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#F59E0B" stroke="#F59E0B" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </span>
          <div>
            <div class="home-fav-name">${getStopDisplayName(stop)}</div>
            <div class="home-fav-sub">${stop.taluka || 'Nashik'} • ${stop.qrCode || 'MSRTC'}</div>
          </div>
        </div>
        <div class="home-fav-right">
          <span class="home-fav-eta">${etaText}</span>
          <button class="btn-remove-fav" title="Remove Favorite" data-stop-id="${stop.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>
      `;

      // Click on row to open stop
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-fav')) return;
        state.activeStop = stop;
        state.hasUserSelectedStop = true;
        state.lastViewedStopId = stop.id;
        try { localStorage.setItem('wmb_last_viewed_stop', stop.id); } catch(e) {}
        if (!state.selectedBus) state.selectedBus = SMART_ST_DATA.buses[0];
        navigateTo('tracking-view');
      });

      // Remove button handler
      const removeBtn = item.querySelector('.btn-remove-fav');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFavoriteStop(stop.id);
        });
      }

      container.appendChild(item);
    });
  }

  function addFavoriteStop(stopId) {
    if (!state.favorites.includes(stopId)) {
      state.favorites.push(stopId);
      try { localStorage.setItem('wmb_favorites', JSON.stringify(state.favorites)); } catch(e) {}
      if (state.currentUser) {
        state.currentUser.favorites = [...state.favorites];
        try { localStorage.setItem('wmb_currentUser', JSON.stringify(state.currentUser)); } catch(e) {}
      }
      showToast('Added to Favorite Stops');
      renderHomeFavoritesList();
      closeModal('add-favorite-modal');
    } else {
      showToast('Stop is already in your favorites.');
    }
  }

  function removeFavoriteStop(stopId) {
    state.favorites = state.favorites.filter(id => id !== stopId);
    try { localStorage.setItem('wmb_favorites', JSON.stringify(state.favorites)); } catch(e) {}
    if (state.currentUser) {
      state.currentUser.favorites = [...state.favorites];
      try { localStorage.setItem('wmb_currentUser', JSON.stringify(state.currentUser)); } catch(e) {}
    }
    showToast('Removed from favorites');
    renderHomeFavoritesList();
    if (state.currentScreen === 'account-view') renderAccountScreen();
  }

  function renderHomeServiceStatus() {
    const card = document.getElementById('home-service-status-card');
    const iconEl = document.getElementById('home-status-icon');
    const badgeEl = document.getElementById('home-status-badge');
    const detailEl = document.getElementById('home-status-detail');
    const routesListEl = document.getElementById('home-status-routes-list');

    if (!card) return;

    // Calculate actual delays across the fleet
    const delayedBuses = SMART_ST_DATA.buses.filter(b => b.delayMinutes > 5);
    const affectedRoutes = [...new Set(delayedBuses.map(b => b.routeName))];

    if (delayedBuses.length === 0) {
      card.classList.remove('has-delay');
      if (iconEl) iconEl.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--apple-green);"></span>';
      if (badgeEl) {
        badgeEl.className = 'badge badge-green';
        badgeEl.textContent = 'Normal';
      }
      if (detailEl) detailEl.textContent = 'All tracked corridors operating on schedule.';
      if (routesListEl) routesListEl.style.display = 'none';
    } else if (delayedBuses.length <= 4) {
      card.classList.add('has-delay');
      if (iconEl) iconEl.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--apple-orange);"></span>';
      if (badgeEl) {
        badgeEl.className = 'badge badge-orange';
        badgeEl.textContent = 'Minor Delays';
      }
      const avgDelay = Math.round(delayedBuses.reduce((a, b) => a + b.delayMinutes, 0) / delayedBuses.length);
      if (detailEl) detailEl.textContent = `${affectedRoutes.length} corridor(s) experiencing traffic delays (Avg delay ~${avgDelay} min).`;
      if (routesListEl) {
        routesListEl.style.display = 'flex';
        routesListEl.innerHTML = affectedRoutes.map(r => `<span style="color:var(--status-orange); font-size:11px; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${r}</span>`).join('');
      }
    } else {
      card.classList.add('has-delay');
      if (iconEl) iconEl.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--apple-red);"></span>';
      if (badgeEl) {
        badgeEl.className = 'badge badge-orange';
        badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
        badgeEl.style.color = '#EF4444';
        badgeEl.textContent = 'Disruption';
      }
      if (detailEl) detailEl.textContent = 'Multiple corridors experiencing weather & highway delays. Check trip timelines.';
      if (routesListEl) {
        routesListEl.style.display = 'flex';
        routesListEl.innerHTML = affectedRoutes.slice(0, 3).map(r => `<span style="color:#EF4444; font-size:11px; display:inline-flex; align-items:center; gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${r}</span>`).join('');
      }
    }
  }

  function renderHomeReportsPreview() {
    const container = document.getElementById('home-reports-preview-list');
    if (!container) return;

    container.innerHTML = '';
    const recentReports = state.communityReportsList.slice(0, 2);

    if (recentReports.length === 0) {
      container.innerHTML = `<div class="text-sm" style="color:var(--text-secondary);">No passenger reports submitted recently.</div>`;
      return;
    }

    recentReports.forEach(rep => {
      const item = document.createElement('div');
      item.className = 'home-report-mini-item';
      item.innerHTML = `
        <div class="home-report-mini-top">
          <span class="home-report-mini-title">${rep.title}</span>
          <span class="badge badge-orange" style="font-size:10px;">${rep.timestamp}</span>
        </div>
        <div class="home-report-mini-meta">
          <span>By ${rep.reporter}</span>
          <span style="color:var(--apple-green); font-weight:600; display:inline-flex; align-items:center; gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            ${rep.votes} verified
          </span>
        </div>
      `;
      container.appendChild(item);
    });

    // Also update contextual reports banner in stop-view
    const stopReportsText = document.getElementById('stop-contextual-reports-text');
    if (stopReportsText) {
      stopReportsText.innerHTML = `<strong>Recent Reports:</strong> ${state.communityReportsList.length} passenger updates active across corridor`;
    }

    // Also update contextual reports count in bus-details-view
    const busReportsCount = document.getElementById('bus-detail-reports-count');
    if (busReportsCount) {
      busReportsCount.textContent = `${state.communityReportsList.length} verified updates from commuters on this route`;
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 14: ACCOUNT
  // --------------------------------------------------------------------------

  function renderAccountScreen() {
    const loggedOutView = document.getElementById('account-logged-out');
    const loggedInView = document.getElementById('account-logged-in');

    if (state.currentUser) {
      if (loggedOutView) loggedOutView.style.display = 'none';
      if (loggedInView) loggedInView.style.display = 'flex';

      const nameEl = document.getElementById('account-user-name');
      if (nameEl) nameEl.textContent = state.currentUser.name || 'Commuter';

      const phoneEl = document.getElementById('account-user-phone');
      if (phoneEl) phoneEl.textContent = state.currentUser.contact || '+91 98XXX XXXXX';

      const avatarEl = document.getElementById('account-user-avatar');
      if (avatarEl) {
        const parts = (state.currentUser.name || 'C P').trim().split(' ');
        const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
        avatarEl.textContent = initials;
      }

      const favCountEl = document.getElementById('account-stat-favorites');
      if (favCountEl) favCountEl.textContent = (state.favorites || []).length;

      const repCountEl = document.getElementById('account-stat-reports');
      if (repCountEl) {
        const userReports = state.communityReportsList.filter(r => r.reporter === state.currentUser.name || r.reporter === 'Commuter Passenger');
        repCountEl.textContent = userReports.length || 1;
      }
    } else {
      if (loggedOutView) loggedOutView.style.display = 'flex';
      if (loggedInView) loggedInView.style.display = 'none';
    }
  }

// --------------------------------------------------------------------------
  // SCREEN 3: BUS ROUTES NETWORK (CORRIDORS & FLEET)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Dedicated Bus Routes & Timetable Screen (Apple HIG Minimal Transit Design)
  // --------------------------------------------------------------------------

  const routesScreenState = {
    searchQuery: '',
    expandedRouteId: null,
    initialized: false
  };

  function setupRoutesScreen() {
    if (routesScreenState.initialized) return;
    routesScreenState.initialized = true;

    const searchInput = document.getElementById('routes-search-input');
    const clearBtn = document.getElementById('btn-clear-routes-search');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        routesScreenState.searchQuery = (e.target.value || '').trim().toLowerCase();
        if (clearBtn) {
          clearBtn.style.display = routesScreenState.searchQuery ? 'flex' : 'none';
        }
        renderRoutesCards();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        routesScreenState.searchQuery = '';
        clearBtn.style.display = 'none';
        renderRoutesCards();
      });
    }
  }

  function renderRoutesScreen() {
    setupRoutesScreen();
    renderRoutesCards();
  }

  function renderRoutesCards() {
    const container = document.getElementById('routes-cards-container');
    if (!container) return;

    const allRoutes = SMART_ST_DATA.routes || [];
    const allBuses = SMART_ST_DATA.buses || [];
    const query = routesScreenState.searchQuery;
    const lang = state.currentLanguage;

    // Filter routes by search query
    const filteredRoutes = allRoutes.filter(route => {
      if (!query) return true;
      const q = query.toLowerCase();

      const firstStop = (route.origin || (route.stops && route.stops[0] && route.stops[0].name) || '').replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      const lastStop = (route.destination || (route.stops && route.stops[route.stops.length - 1] && route.stops[route.stops.length - 1].name) || '').replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();

      const matchEndpoints = firstStop.includes(q) || lastStop.includes(q) ||
                             (route.origin && route.origin.toLowerCase().includes(q)) ||
                             (route.destination && route.destination.toLowerCase().includes(q)) ||
                             (route.originMr && route.originMr.includes(query)) ||
                             (route.destinationMr && route.destinationMr.includes(query));

      const matchName = (route.name && route.name.toLowerCase().includes(q));
      const matchCode = (route.id && route.id.toLowerCase().includes(q)) ||
                        (route.routeNumber && route.routeNumber.toLowerCase().includes(q));

      const matchStop = route.stops && route.stops.some(s => 
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.nameMr && s.nameMr.includes(query))
      );

      return matchEndpoints || matchName || matchCode || matchStop;
    });

    if (filteredRoutes.length === 0) {
      container.innerHTML = `
        <div class="nearby-empty-state">
          <div class="nearby-empty-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h3 class="nearby-empty-title">No routes found</h3>
          <p class="nearby-empty-subtitle">No bus routes match &ldquo;${escapeNearbyHtml(query)}&rdquo;. Try searching for Nashik, Shirdi, Pune, or Yeola.</p>
          <button type="button" class="nearby-empty-reset-btn" id="btn-routes-reset-search">Clear Search</button>
        </div>
      `;
      const resetBtn = document.getElementById('btn-routes-reset-search');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          const searchInput = document.getElementById('routes-search-input');
          const clearBtn = document.getElementById('btn-clear-routes-search');
          if (searchInput) searchInput.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          routesScreenState.searchQuery = '';
          renderRoutesCards();
        });
      }
      return;
    }

    container.innerHTML = '';

    filteredRoutes.forEach(route => {
      const runningBuses = allBuses.filter(b => b.routeId === route.id);
      const stops = route.stops || [];
      const isExpanded = routesScreenState.expandedRouteId === route.id;

      // Strictly first stop and last stop
      const firstStop = (route.origin || (stops[0] && stops[0].name) || 'Origin').replace(/\s*\([^)]*\)/g, '').trim();
      const lastStop = (route.destination || (stops[stops.length - 1] && stops[stops.length - 1].name) || 'Destination').replace(/\s*\([^)]*\)/g, '').trim();
      const routeTitle = `${firstStop} to ${lastStop}`;

      // Clean stops sequence in the drawer
      const stopsHtml = stops.map((st, idx) => {
        const displayName = (st.name || '').replace(/\s*\([^)]*\)/g, '').trim();
        return `
          <div class="route-stop-line">
            <span class="route-stop-num">${idx + 1}</span>
            <span class="route-stop-title">${escapeNearbyHtml(displayName)}</span>
          </div>
        `;
      }).join('');

      const itemEl = document.createElement('div');
      itemEl.className = 'route-item-wrap';
      itemEl.setAttribute('role', 'listitem');

      itemEl.innerHTML = `
        <div class="route-row" tabindex="0" role="button" aria-expanded="${isExpanded}" aria-label="${escapeNearbyHtml(routeTitle)}">
          <div class="route-transit-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 6v6"/>
              <path d="M16 6v6"/>
              <path d="M4 12h16"/>
              <rect x="4" y="3" width="16" height="15" rx="2"/>
              <circle cx="8" cy="15" r="1" fill="currentColor"/>
              <circle cx="16" cy="15" r="1" fill="currentColor"/>
              <path d="M6 18v2"/>
              <path d="M18 18v2"/>
            </svg>
          </div>
          <div class="route-content">
            <div class="route-endpoints">
              <span class="route-name-text">${escapeNearbyHtml(firstStop)}</span>
              <span class="route-arrow-icon" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </span>
              <span class="route-name-text">${escapeNearbyHtml(lastStop)}</span>
            </div>
          </div>
          <div class="route-trailing">
            <span class="route-chevron ${isExpanded ? 'open' : ''}" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </div>
        </div>

        <div class="route-drawer ${isExpanded ? 'open' : ''}">
          <div class="route-drawer-inner">
            <div class="route-drawer-heading">
              <span>Route Stops (${stops.length})</span>
              ${runningBuses.length > 0 ? `<span class="route-live-tag">● ${runningBuses.length} Active Bus${runningBuses.length > 1 ? 'es' : ''}</span>` : ''}
            </div>
            <div class="route-stops-sequence">
              ${stopsHtml}
            </div>
            <button type="button" class="route-track-map-btn" data-route-id="${route.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                <line x1="8" y1="2" x2="8" y2="18"/>
                <line x1="16" y1="6" x2="16" y2="22"/>
              </svg>
              <span>Track Route on Live Map</span>
            </button>
          </div>
        </div>
      `;

      // Click / keydown handler to toggle expansion
      const rowBtn = itemEl.querySelector('.route-row');
      rowBtn.addEventListener('click', () => {
        routesScreenState.expandedRouteId = isExpanded ? null : route.id;
        renderRoutesCards();
      });
      rowBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          routesScreenState.expandedRouteId = isExpanded ? null : route.id;
          renderRoutesCards();
        }
      });

      // Track on map button
      const trackBtn = itemEl.querySelector('.route-track-map-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const repBus = runningBuses[0] || SMART_ST_DATA.buses.find(b => b.routeId === route.id) || SMART_ST_DATA.buses[0];
          if (repBus) {
            state.selectedBus = repBus;
            navigateTo('tracking-view', { busId: repBus.id });
          }
        });
      }

      container.appendChild(itemEl);
    });
  }

  // Alias for backward-compatibility with any lingering stop-view calls
  function renderStopScreen() {
    renderRoutesScreen();
  }

  // --------------------------------------------------------------------------
  // STOP SEARCH FEATURE ON BUS STOP HOME VIEW
  // --------------------------------------------------------------------------

  function setupStopSearch() {
    const searchInput = document.getElementById('stop-search-input');
    const clearBtn = document.getElementById('btn-clear-stop-search');
    const dropdown = document.getElementById('stop-search-dropdown');

    if (!searchInput || !dropdown) return;

    let allStops = [];

    function buildStopsList() {
      const map = new Map();

      // 1. Primary Major Stops in SMART_ST_DATA.busStops
      SMART_ST_DATA.busStops.forEach(s => {
        map.set(s.id.toLowerCase(), {
          id: s.id,
          name: s.name,
          nameMr: s.nameMr || s.name,
          nameHi: s.nameHi || s.nameMr || s.name,
          village: s.village || '',
          taluka: s.taluka || '',
          district: s.district || 'Maharashtra',
          qrCode: s.qrCode,
          latitude: s.latitude,
          longitude: s.longitude,
          isMajor: true,
          route: 'Major Station QR Hub'
        });
      });

      // 2. Corridor Intermediate Stops from all buses
      if (SMART_ST_DATA.buses) {
        SMART_ST_DATA.buses.forEach(b => {
          if (b.intermediateStops) {
            b.intermediateStops.forEach(st => {
              const nameKey = st.name.toLowerCase();
              if (!map.has(nameKey) && !Array.from(map.values()).some(item => item.name.toLowerCase() === nameKey)) {
                map.set(nameKey, {
                  id: st.name,
                  name: st.name,
                  nameMr: st.nameMr || st.name,
                  nameHi: st.nameHi || st.nameMr || st.name,
                  village: st.name,
                  taluka: b.routeName ? b.routeName.split(' to ')[0] : 'Nashik',
                  district: 'Nashik Region',
                  latitude: st.lat,
                  longitude: st.lng,
                  isMajor: false,
                  route: b.routeName || 'Corridor Highway Route'
                });
              }
            });
          }
        });
      }

      return Array.from(map.values());
    }

    function getStops() {
      if (allStops.length === 0) {
        allStops = buildStopsList();
      }
      return allStops;
    }

    function renderDropdownResults(query) {
      const stops = getStops();
      const cleanQ = (query || '').trim().toLowerCase();

      let matched = [];
      if (!cleanQ) {
        // Show top major hubs / stations when focused with empty query
        matched = stops.filter(s => s.isMajor).slice(0, 6);
      } else {
        matched = stops.filter(s => {
          const matchEn = s.name && s.name.toLowerCase().includes(cleanQ);
          const matchMr = s.nameMr && s.nameMr.toLowerCase().includes(cleanQ);
          const matchHi = s.nameHi && s.nameHi.toLowerCase().includes(cleanQ);
          const matchVil = s.village && s.village.toLowerCase().includes(cleanQ);
          const matchTal = s.taluka && s.taluka.toLowerCase().includes(cleanQ);
          const matchRoute = s.route && s.route.toLowerCase().includes(cleanQ);
          return matchEn || matchMr || matchHi || matchVil || matchTal || matchRoute;
        });

        matched.sort((a, b) => {
          const aStarts = (a.name.toLowerCase().startsWith(cleanQ) || (a.nameMr && a.nameMr.startsWith(cleanQ))) ? 1 : 0;
          const bStarts = (b.name.toLowerCase().startsWith(cleanQ) || (b.nameMr && b.nameMr.startsWith(cleanQ))) ? 1 : 0;
          if (aStarts !== bStarts) return bStarts - aStarts;
          if (a.isMajor !== b.isMajor) return (b.isMajor ? 1 : 0) - (a.isMajor ? 1 : 0);
          return a.name.localeCompare(b.name);
        });

        matched = matched.slice(0, 8);
      }

      if (matched.length === 0) {
        const safeQ = cleanQ.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        dropdown.innerHTML = `
          <div class="stop-search-empty">
            <div>No bus stops found matching "<strong>${safeQ}</strong>"</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
              Try searching by town or village name (e.g. Niphad, Yeola, Chandori, Saikheda, Sinnar)
            </div>
          </div>
        `;
        dropdown.style.display = 'flex';
        return;
      }

      const activeLat = state.activeStop ? (state.activeStop.latitude || state.activeStop.lat) : null;
      const activeLng = state.activeStop ? (state.activeStop.longitude || state.activeStop.lng) : null;

      let html = '';
      if (!cleanQ) {
        html += `<div class="stop-search-header-label">Popular Bus Stations & Hubs</div>`;
      }

      matched.forEach(st => {
        const isCurrentActive = state.activeStop && (
          (state.activeStop.id && state.activeStop.id.toLowerCase() === st.id.toLowerCase()) ||
          (state.activeStop.name && state.activeStop.name.toLowerCase() === st.name.toLowerCase())
        );

        let distText = '';
        if (activeLat && activeLng && st.latitude && st.longitude) {
          const distKm = calculateDistanceKm(activeLat, activeLng, st.latitude, st.longitude);
          if (distKm < 0.1) {
            distText = 'Current stop';
          } else if (distKm < 1) {
            distText = `${Math.round(distKm * 1000)} m away`;
          } else {
            distText = `${distKm.toFixed(1)} km away`;
          }
        }

        const dispName = (state.currentLanguage === 'mr' && st.nameMr) ? st.nameMr :
                         (state.currentLanguage === 'hi' && (st.nameHi || st.nameMr)) ? (st.nameHi || st.nameMr) :
                         st.name;
        const altName = (state.currentLanguage === 'mr') ? st.name : (st.nameMr || '');
        const metaSub = st.isMajor
          ? (st.taluka ? `${st.taluka}, ${st.district || 'MSRTC'}` : 'Major MSRTC Station')
          : (st.route || 'Highway Corridor Stop');

        const stopIconSvg = st.isMajor
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h4"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/></svg>';

        html += `
          <div class="stop-search-item ${isCurrentActive ? 'is-active-stop' : ''}" data-stop-id="${st.id}">
            <div class="stop-search-item-left">
              <span class="stop-search-item-icon">${stopIconSvg}</span>
              <div class="stop-search-item-text">
                <div class="stop-search-item-title">
                  <span>${dispName}</span>
                  ${altName && altName !== dispName ? `<span class="stop-search-item-alt">(${altName})</span>` : ''}
                  ${isCurrentActive ? '<span class="badge badge-green" style="font-size: 10px; padding: 1px 6px;">Current</span>' : ''}
                </div>
                <div class="stop-search-item-meta">${metaSub}</div>
              </div>
            </div>
            <div class="stop-search-item-right">
              ${distText ? `<span class="stop-search-item-dist">${distText}</span>` : ''}
              <span class="stop-search-select-badge">Switch</span>
            </div>
          </div>
        `;
      });

      dropdown.innerHTML = html;
      dropdown.style.display = 'flex';

      // Attach click listeners
      dropdown.querySelectorAll('.stop-search-item').forEach(item => {
        item.addEventListener('click', () => {
          const stopId = item.dataset.stopId;
          selectSearchedStop(stopId);
        });
      });
    }

    function selectSearchedStop(stopIdOrName) {
      const resolved = resolveStopObject(stopIdOrName);
      if (resolved) {
        state.activeStop = resolved;
        state.hasUserSelectedStop = true;
        state.lastViewedStopId = resolved.id;
        try { localStorage.setItem('wmb_last_viewed_stop', resolved.id); } catch(e) {}
        renderStopScreen();
        showToast(`Connected to ${getStopDisplayName(resolved)}`);
        searchInput.value = getStopDisplayName(resolved);
        if (clearBtn) clearBtn.style.display = 'flex';
      } else {
        searchInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
      }
      dropdown.style.display = 'none';
    }

    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
      renderDropdownResults(val);
    });

    searchInput.addEventListener('focus', () => {
      renderDropdownResults(searchInput.value);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.hasUserSelectedStop = false;
        searchInput.value = '';
        clearBtn.style.display = 'none';
        renderDropdownResults('');
        searchInput.focus();
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.stop-search-box')) {
        dropdown.style.display = 'none';
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.style.display = 'none';
      }
    });
  }

  // --------------------------------------------------------------------------
  // SCREEN 4: INTERACTIVE LIVE TRACKING MAP (GOOGLE MAPS PLATFORM)
  // --------------------------------------------------------------------------

  // Distance calculation helpers (Haversine formula)
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function calculateRoadDistanceBetween(pts, startIdx, endIdx) {
    if (!pts || pts.length === 0) return 0;
    const start = Math.min(startIdx, endIdx);
    const end = Math.max(startIdx, endIdx);
    let total = 0;
    for (let i = start; i < end && i < pts.length - 1; i++) {
      total += calculateDistanceKm(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
    return total;
  }

  // Google Maps Platform Map Types (Roadmap, Satellite Aerial, Hybrid, Terrain)
  const GOOGLE_MAP_TYPES = [
    { id: 'roadmap', name: 'Roadmap View' },
    { id: 'satellite', name: 'Satellite Aerial View' },
    { id: 'hybrid', name: 'Hybrid Aerial & Roads' },
    { id: 'terrain', name: 'Terrain Topographic View' }
  ];

  function switchMapTileLayer(index = null) {
    if (!state.mapInstance) return;
    if (index === null) {
      state.activeLayerIndex = (state.activeLayerIndex + 1) % GOOGLE_MAP_TYPES.length;
    } else {
      state.activeLayerIndex = index;
    }
    const layerDef = GOOGLE_MAP_TYPES[state.activeLayerIndex];
    if (typeof state.mapInstance.setMapTypeId === 'function') {
      state.mapInstance.setMapTypeId(layerDef.id);
    }
    showToast(`Map Type: ${layerDef.name}`);
  }

  // Helper to extract clean, uncluttered route endpoint names (e.g. "Nashik CBS (Thakkar Bazar)" -> "Nashik")
  function getShortRouteEndpoint(name) {
    if (!name) return '';
    return name
      .replace(/\s*\([^)]*\)/g, '') // remove parenthetical suffixes
      .replace(/\bCBS\b/gi, '')
      .replace(/\s+(Central Bus Stand|Bus Stand|Central|Stand|Asiad Stand|Temple Stand|Industrial Stand|Railway Phata|Bus Stop|थांबा|स्थानक)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Check if a route serves a given bus stop
  function routeServesStop(route, stop) {
    if (!route || !route.stops || !Array.isArray(route.stops) || !stop) return false;
    const stopId = stop.id;
    const stopName = (stop.name || '').trim().toLowerCase();
    const stopNameMr = (stop.nameMr || '').trim();

    return route.stops.some(s => {
      if (stopId && s.id === stopId) return true;
      if (s.name && s.name.trim().toLowerCase() === stopName) return true;
      if (stopNameMr && s.nameMr && s.nameMr.trim() === stopNameMr) return true;
      if (s.lat && s.lng && stop.latitude && stop.longitude) {
        return calculateDistanceKm(s.lat, s.lng, stop.latitude, stop.longitude) < 0.6;
      }
      return false;
    });
  }

  // Render the Dynamic Route & Bus Selector Accordion (Matches Reference Design)
  function renderLiveTrackingSelector() {
    const container = document.getElementById('tracking-routes-accordion');
    if (!container) return;

    const stop = state.activeStop || (SMART_ST_DATA.busStops && SMART_ST_DATA.busStops[0]);
    const currentBus = state.selectedBus;
    const allRoutes = SMART_ST_DATA.routes || [];
    const allBuses = SMART_ST_DATA.buses || [];
    const lang = state.currentLanguage || 'en';

    // 1. Find all routes serving this stop
    let stopRoutes = allRoutes.filter(r => routeServesStop(r, stop));

    // Ensure the route of the currently selected bus is present
    if (currentBus && currentBus.routeId) {
      const currentRoute = allRoutes.find(r => r.id === currentBus.routeId);
      if (currentRoute && !stopRoutes.some(r => r.id === currentRoute.id)) {
        stopRoutes.unshift(currentRoute);
      }
    }

    // Fallback if stop has no matching routes: show routes with active buses
    if (stopRoutes.length === 0) {
      stopRoutes = allRoutes.filter(r => allBuses.some(b => b.routeId === r.id));
    }

    // Sort routes: selected bus route first, then routes with the most live buses
    stopRoutes.sort((a, b) => {
      if (currentBus) {
        if (a.id === currentBus.routeId) return -1;
        if (b.id === currentBus.routeId) return 1;
      }
      const countA = allBuses.filter(bus => bus.routeId === a.id).length;
      const countB = allBuses.filter(bus => bus.routeId === b.id).length;
      return countB - countA;
    });

    // By default, expand the route of the currently selected bus
    if (!state.expandedRouteId && currentBus) {
      state.expandedRouteId = currentBus.routeId;
    }
    if (!state.expandedRouteId && stopRoutes.length > 0) {
      state.expandedRouteId = stopRoutes[0].id;
    }

    container.innerHTML = '';

    stopRoutes.forEach(route => {
      // Find all buses assigned to this route
      const routeBuses = allBuses.filter(b => b.routeId === route.id);
      const isExpanded = (state.expandedRouteId === route.id);

      // Clean, uncluttered route title
      const origName = (lang === 'mr' && route.originMr) ? getShortRouteEndpoint(route.originMr) : getShortRouteEndpoint(route.origin);
      const destName = (lang === 'mr' && route.destinationMr) ? getShortRouteEndpoint(route.destinationMr) : getShortRouteEndpoint(route.destination);
      const routeTitle = `${origName} → ${destName}`;

      // Dynamic bus count label
      const busCount = routeBuses.length;
      let busCountLabel = '';
      if (lang === 'mr') {
        busCountLabel = `${busCount} ${busCount === 1 ? 'बस उपलब्ध' : 'बसेस उपलब्ध'}`;
      } else if (lang === 'hi') {
        busCountLabel = `${busCount} ${busCount === 1 ? 'बस उपलब्ध' : 'बसें उपलब्ध'}`;
      } else {
        busCountLabel = `${busCount} ${busCount === 1 ? 'bus on this route' : 'buses on this route'}`;
      }

      // Create Accordion Item
      const itemEl = document.createElement('div');
      itemEl.className = `route-accordion-item ${isExpanded ? 'active' : ''}`;
      itemEl.dataset.routeId = route.id;

      // Accordion Header
      const headerEl = document.createElement('div');
      headerEl.className = 'route-accordion-header';
      headerEl.setAttribute('role', 'button');
      headerEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      headerEl.setAttribute('tabindex', '0');

      headerEl.innerHTML = `
        <div class="route-header-main">
          <div class="route-icon-indicator" aria-hidden="true">
            <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
              <circle cx="9" cy="4.5" r="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
              <line x1="9" y1="8" x2="9" y2="18" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"/>
              <circle cx="9" cy="21.5" r="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
            </svg>
          </div>
          <div class="route-header-text">
            <div class="route-title">${routeTitle}</div>
            <div class="route-subtitle">${busCountLabel}</div>
          </div>
        </div>
        <div class="route-chevron-btn" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      `;

      // Accordion Body
      const bodyEl = document.createElement('div');
      bodyEl.className = 'route-accordion-body';

      const busListEl = document.createElement('div');
      busListEl.className = 'bus-tiles-list';

      if (routeBuses.length === 0) {
        busListEl.innerHTML = `
          <div class="route-empty-msg">
            ${lang === 'mr' ? 'या मार्गावर सध्या थेट बस उपलब्ध नाही' : (lang === 'hi' ? 'इस रूट पर वर्तमान में कोई लाइव बस नहीं है' : 'No live buses currently tracked on this route')}
          </div>
        `;
      } else {
        routeBuses.forEach(b => {
          const isSelected = currentBus && (b.id === currentBus.id);

          const tileEl = document.createElement('div');
          tileEl.className = `bus-tile ${isSelected ? 'selected' : ''}`;
          tileEl.dataset.busId = b.id;
          tileEl.setAttribute('role', 'button');
          tileEl.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
          tileEl.setAttribute('tabindex', '0');

          // Status label & styling
          let statusText = b.status || 'En Route';
          let statusClass = 'status-en-route';
          if (b.status === 'At Stop' || b.status === 'At Station') {
            statusText = 'At Stop';
            statusClass = 'status-at-stop';
          } else if (b.status === 'Delayed' || b.delayMinutes > 5) {
            statusText = 'Delayed';
            statusClass = 'status-delayed';
          } else {
            statusText = 'En Route';
            statusClass = 'status-en-route';
          }

          // Localize status
          let localizedStatus = statusText;
          if (lang === 'mr') {
            localizedStatus = statusText === 'At Stop' ? 'स्थानकावर' : (statusText === 'Delayed' ? 'उशीर' : 'मार्गस्थ');
          } else if (lang === 'hi') {
            localizedStatus = statusText === 'At Stop' ? 'स्टॉप पर' : (statusText === 'Delayed' ? 'देरी' : 'मार्गस्थ');
          }

          // ETA text
          let etaText = `${b.etaMinutes || 8} mins away`;
          if (b.status === 'At Stop' || b.etaMinutes === 0) {
            etaText = lang === 'mr' ? 'स्थानकावर' : (lang === 'hi' ? 'स्टॉप पर' : 'At Stop');
          } else if (lang === 'mr') {
            etaText = `${b.etaMinutes} मि. दूर`;
          } else if (lang === 'hi') {
            etaText = `${b.etaMinutes} मिनट दूर`;
          }

          const distKm = b.distanceFromStop || 6.3;
          const speedKmH = b.speed || 48;
          const metricsText = `${distKm} km • ${speedKmH} km/h`;

          tileEl.innerHTML = `
            <div class="bus-tile-left">
              <div class="bus-tile-icon-box" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 17h2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10h2"/>
                  <circle cx="7" cy="17" r="2"/>
                  <path d="M9 17h6"/>
                  <circle cx="17" cy="17" r="2"/>
                  <path d="M4 11h16"/>
                  <path d="M4 7h16"/>
                </svg>
              </div>
              <div class="bus-tile-info">
                <div class="bus-tile-top-row">
                  <span class="bus-tile-number">${b.number}</span>
                  <span class="bus-tile-status-pill ${statusClass}">
                    <span class="pill-dot"></span>
                    <span>${localizedStatus}</span>
                  </span>
                </div>
                <div class="bus-tile-route-name">${routeTitle}</div>
              </div>
            </div>
            <div class="bus-tile-right">
              <div class="bus-tile-eta">${etaText}</div>
              <div class="bus-tile-metrics">${metricsText}</div>
            </div>
          `;

          // TAP BUS INTERACTION - Instant in-place selection (NO page navigation)
          tileEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectLiveTrackingBus(b);
          });

          tileEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectLiveTrackingBus(b);
            }
          });

          busListEl.appendChild(tileEl);
        });
      }

      bodyEl.appendChild(busListEl);
      itemEl.appendChild(headerEl);
      itemEl.appendChild(bodyEl);

      // TAP ROUTE INTERACTION (Toggle accordion with smooth slide animation)
      headerEl.addEventListener('click', () => {
        const currentlyOpen = (state.expandedRouteId === route.id);
        if (currentlyOpen) {
          // Collapse
          state.expandedRouteId = null;
          itemEl.classList.remove('active');
          headerEl.setAttribute('aria-expanded', 'false');
        } else {
          // Expand this route and collapse others
          state.expandedRouteId = route.id;
          container.querySelectorAll('.route-accordion-item').forEach(other => {
            other.classList.remove('active');
            const otherHeader = other.querySelector('.route-accordion-header');
            if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
          });
          itemEl.classList.add('active');
          headerEl.setAttribute('aria-expanded', 'true');
        }
      });

      headerEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          headerEl.click();
        }
      });

      container.appendChild(itemEl);
    });
  }

  // Select a bus directly from the accordion: update outline, map, and telemetry
  function selectLiveTrackingBus(bus) {
    if (!bus) return;
    state.selectedBus = bus;

    // 1. Update selection outline across bus tiles (only selected bus gets blue outline)
    const allBusTiles = document.querySelectorAll('.bus-tile');
    allBusTiles.forEach(tile => {
      if (tile.dataset.busId === bus.id) {
        tile.classList.add('selected');
        tile.setAttribute('aria-pressed', 'true');
      } else {
        tile.classList.remove('selected');
        tile.setAttribute('aria-pressed', 'false');
      }
    });

    // 2. Ensure parent route accordion is expanded
    const parentItem = document.querySelector(`.route-accordion-item[data-route-id="${bus.routeId}"]`);
    if (parentItem && !parentItem.classList.contains('active')) {
      state.expandedRouteId = bus.routeId;
      document.querySelectorAll('.route-accordion-item').forEach(item => {
        item.classList.remove('active');
        const h = item.querySelector('.route-accordion-header');
        if (h) h.setAttribute('aria-expanded', 'false');
      });
      parentItem.classList.add('active');
      const h = parentItem.querySelector('.route-accordion-header');
      if (h) h.setAttribute('aria-expanded', 'true');
    }

    // 3. Immediately update telemetry strip
    const speedEl = document.getElementById('track-speed');
    const distEl = document.getElementById('track-dist');
    const etaEl = document.getElementById('track-eta');
    const confEl = document.getElementById('track-confidence');
    const bannerTitle = document.getElementById('map-banner-title');
    const bannerSub = document.getElementById('map-banner-sub');

    if (speedEl) speedEl.textContent = `${bus.speed || 48} km/h`;
    if (distEl) distEl.textContent = `${bus.distanceFromStop || 6.3} km`;
    if (etaEl) etaEl.textContent = `${bus.etaMinutes || 8} mins`;
    if (confEl) confEl.textContent = `${bus.confidenceScore || 98}%`;

    const nextStopName = bus.nextStop || (bus.intermediateStops && bus.intermediateStops[1] ? bus.intermediateStops[1].name : 'Next Stop');
    if (bannerTitle) {
      const prefix = state.currentLanguage === 'mr' ? 'कडे मार्गस्थ: ' : (state.currentLanguage === 'hi' ? 'की ओर अग्रसर: ' : 'En Route to ');
      bannerTitle.textContent = `${prefix}${getShortRouteEndpoint(nextStopName)}`;
    }
    if (bannerSub) {
      const awayStr = state.currentLanguage === 'mr' ? 'अंतर' : (state.currentLanguage === 'hi' ? 'दूरी' : 'away');
      const minsStr = state.currentLanguage === 'mr' ? 'मि.' : (state.currentLanguage === 'hi' ? 'मिनट' : 'mins');
      bannerSub.textContent = `${bus.distanceFromStop || 6.3} km ${awayStr} • ~${bus.etaMinutes || 8} ${minsStr} (${bus.speed || 48} km/h)`;
    }

    // 4. Update Trip Details Timeline
    renderTripDetailsTimeline(bus);

    // 5. Update Google Map with new bus position, route polyline, and camera bounds
    initGoogleTrackingMap(bus, state.activeStop);
  }

  // Kept for backward compatibility
  function renderMapBusChips() {}

  // Generate rich, clean on-click popup content for the circular bus icon
  function createBusPopupHtml(bus) {
    return `
      <div class="bus-map-popup-card">
        <div class="popup-bus-header">
          <div class="flex-between gap-2" style="margin-bottom: 4px;">
            <span class="badge" style="background:${bus.badgeColor}; color:#FFFFFF; font-size:11px; padding: 4px 8px;">${bus.number}</span>
            <span class="badge badge-green" style="font-size:10px;">● ${bus.status}</span>
          </div>
          <div style="font-weight: 800; font-size: 13px; color: var(--text-main); margin-top: 2px;">${bus.type}</div>
          <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.2;">${bus.routeName}</div>
        </div>
        <div class="popup-metrics-grid">
          <div class="popup-metric">
            <span class="m-val" id="popup-bus-speed">${bus.speed} km/h</span>
            <span class="m-lbl">Speed</span>
          </div>
          <div class="popup-metric">
            <span class="m-val" id="popup-bus-dist">${bus.distanceFromStop} km</span>
            <span class="m-lbl">Distance</span>
          </div>
          <div class="popup-metric">
            <span class="m-val" id="popup-bus-eta">${bus.etaMinutes} mins</span>
            <span class="m-lbl">Live ETA</span>
          </div>
        </div>
        <div class="popup-bus-footer">
          <div>Seats: <strong>${bus.occupancy}</strong></div>
          <div>Driver: <strong>${bus.driverName.split(' ')[0]}</strong></div>
        </div>
      </div>
    `;
  }

  // Format trip timestamp as DD-MM-YYYY HH:mm:ss (like in image 3)
  function formatTripTimestamp(d = new Date()) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
  }

  // Render Trip Overview & Vertical Timeline (CITILINC / MSRTC style from uploaded images)
  function renderTripDetailsTimeline(bus) {
    // 1. Live Trip Overview Card (Image 3)
    const prevStopEl = document.getElementById('trip-prev-stop');
    const currLocEl = document.getElementById('trip-curr-loc');
    const nextStopEl = document.getElementById('trip-next-stop');
    const refreshTimeEl = document.getElementById('trip-refresh-time');

    // Find index of current target stop
    let currentIdx = bus.intermediateStops ? bus.intermediateStops.findIndex(s => s.isCurrentTarget || s.name === bus.nextStop) : -1;
    if (currentIdx === -1) currentIdx = 2;

    const prevStopObj = bus.intermediateStops ? (bus.intermediateStops[Math.max(0, currentIdx - 1)] || bus.intermediateStops[0]) : null;
    const nextStopObj = bus.intermediateStops ? (bus.intermediateStops[currentIdx] || bus.intermediateStops[bus.intermediateStops.length - 1]) : null;

    if (prevStopEl && prevStopObj) prevStopEl.textContent = getStopDisplayName(prevStopObj);
    if (nextStopEl && nextStopObj) nextStopEl.textContent = getStopDisplayName(nextStopObj);
    if (currLocEl && prevStopObj) {
      const cleanPrevName = getStopDisplayName(prevStopObj).replace(' Bus Stop', '').replace(' Stand', '').replace(' बस स्थानक', '').replace(' थांबा', '');
      currLocEl.textContent = state.currentLanguage === 'mr' ? `महामार्ग कॉरिडॉर (${cleanPrevName} जवळ)` : (state.currentLanguage === 'hi' ? `हाईवे कॉरिडोर (${cleanPrevName} के पास)` : `Highway Corridor (Near ${cleanPrevName})`);
    }
    if (refreshTimeEl) refreshTimeEl.textContent = formatTripTimestamp();

    // 2. Trip Details Header Row (Image 1 & 2)
    const routeNoEl = document.getElementById('trip-route-no');
    const passCountEl = document.getElementById('trip-passengers-count');

    if (routeNoEl) routeNoEl.textContent = `Route No : ${bus.id.replace('BUS-', '')} (${bus.routeId || '101'})`;
    if (passCountEl) {
      const seats = bus.occupancy ? bus.occupancy.split(' ')[0] : '28';
      passCountEl.textContent = `Passengers Count : ${seats}`;
    }

    // 3. Vertical Timeline List (Image 1 & 2)
    const container = document.getElementById('trip-vertical-timeline-container');
    if (!container || !bus.intermediateStops) return;

    container.innerHTML = '';

    bus.intermediateStops.forEach((st, idx) => {
      const isCovered = idx < currentIdx;
      const isCurrent = idx === currentIdx;
      const isUpcoming = idx > currentIdx;

      let statusClass = 'upcoming';
      let statusLabel = getTimelineStatusLabel('upcoming');
      let timeText = st.time || '-';

      if (isCovered) {
        statusClass = 'covered';
        statusLabel = getTimelineStatusLabel('covered');
      } else if (isCurrent) {
        statusClass = 'current';
        statusLabel = getTimelineStatusLabel('current');
        timeText = `${st.time} (${bus.etaMinutes}m)`;
      }

      const displayName = getStopDisplayName(st);

      const row = document.createElement('div');
      row.className = `trip-stop-row ${statusClass}`;
      row.dataset.stopIdx = idx;

      row.innerHTML = `
        <div class="trip-node-col">
          <div class="trip-dot ${statusClass}"></div>
        </div>
        <div class="trip-content-col">
          <div class="trip-stop-title">${displayName}</div>
          <div class="trip-stop-status ${statusClass}">${statusLabel}</div>
        </div>
        <div class="trip-time-col">
          <span class="trip-time-text">${timeText}</span>
          ${(isCurrent || isUpcoming) ? `<button class="btn-stop-alert-bell" data-stop="${st.name}" title="Set reminder for ${displayName}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>` : ''}
        </div>
      `;

      container.appendChild(row);
    });

    // Position live bus badge on the active segment (between previous covered stop and next approaching stop)
    const prevRowIdx = Math.max(0, currentIdx - 1);
    const rows = container.querySelectorAll('.trip-stop-row');
    rows.forEach((r, rIdx) => {
      if (rIdx === prevRowIdx) {
        r.classList.add('active-segment');
        r.style.setProperty('--segment-fill', '0%');
      } else {
        r.classList.remove('active-segment');
        r.style.removeProperty('--segment-fill');
      }
    });

    const hostRow = rows[prevRowIdx] || rows[0];
    if (hostRow) {
      const nodeCol = hostRow.querySelector('.trip-node-col');
      if (nodeCol) {
        const badge = document.createElement('div');
        badge.className = 'trip-bus-inline-badge';
        badge.id = 'trip-live-bus-badge';
        badge.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 18v2M17 18v2M3 10h18"/><circle cx="7.5" cy="14.5" r="1"/><circle cx="16.5" cy="14.5" r="1"/></svg>`;
        badge.style.top = '9px';
        nodeCol.appendChild(badge);
      }
    }

    // Auto-scroll timeline internally to the current approaching stop (without scrolling window)
    setTimeout(() => {
      const currentStopEl = container.querySelector('.trip-stop-row.current');
      if (currentStopEl && container.scrollHeight > container.clientHeight) {
        const topPos = currentStopEl.offsetTop - (container.clientHeight / 2);
        container.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
      }
    }, 150);

    // Wire up reminder bells
    container.querySelectorAll('.btn-stop-alert-bell').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stopName = e.currentTarget.dataset.stop;
        const isActive = e.currentTarget.classList.toggle('active');
        if (isActive) {
          showToast(`Reminder alert set for ${stopName}!`);
        } else {
          showToast(`Reminder removed for ${stopName}`);
        }
      });
    });
  }

  const DEFAULT_MAPS_KEY = "AIzaSyAEgSHk6U59rWysap_fyf3E1fhyEDPmfWY";

  async function getGoogleMapsApiKey() {
    if (window.GOOGLE_MAPS_API_KEY) return window.GOOGLE_MAPS_API_KEY;
    const sessionKey = sessionStorage.getItem('GOOGLE_MAPS_API_KEY');
    if (sessionKey) return sessionKey;
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.googleMapsKey) return data.googleMapsKey;
      }
    } catch (e) {
      // server-less or offline
    }
    return DEFAULT_MAPS_KEY;
  }

  // Pre-load Google Maps SDK in background so live map is instantaneous
  getGoogleMapsApiKey().then((key) => {
    if (key && typeof window.loadGoogleMapsSdk === 'function') {
      window.loadGoogleMapsSdk(key).catch((e) => console.warn('Background Google Maps preload:', e));
    }
  });

  function renderGoogleMapsKeyPrompt(mapContainer, onKeySubmit) {
    mapContainer.innerHTML = `
      <div class="gmp-key-prompt-overlay">
        <div class="gmp-key-card">
          <div class="gmp-key-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <span>Google Maps Platform Setup</span>
          </div>
          <p class="gmp-key-desc">
            To view live bus tracking, Maharashtra transit corridors, and real-time GPS simulation on Google Maps, provide a Google Maps Platform API key or a free Maps Demo Key.
          </p>
          <div class="gmp-key-input-group">
            <input type="password" id="gmp-key-input" class="gmp-key-input" placeholder="Paste API Key or Maps Demo Key" autocomplete="off" />
            <button type="button" id="gmp-key-submit-btn" class="gmp-key-btn">Load Map</button>
          </div>
          <div class="gmp-key-links">
            <div>• Free for prototyping: <a href="https://mapsplatform.google.com/maps-demo-key?utm_campaign=gmp_git_agentskills_v1" target="_blank" rel="noopener">Get a free Maps Demo Key</a> (no billing required)</div>
            <div>• Or create a key in <a href="https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_git_agentskills_v1" target="_blank" rel="noopener">Google Cloud Console</a></div>
            <div>• Or add <code>GOOGLE_MAPS_API_KEY=your_key</code> in <code>.env</code></div>
          </div>
        </div>
      </div>
    `;

    const submitBtn = mapContainer.querySelector('#gmp-key-submit-btn');
    const inputEl = mapContainer.querySelector('#gmp-key-input');
    const submitHandler = () => {
      const key = inputEl ? inputEl.value.trim() : '';
      if (key) {
        sessionStorage.setItem('GOOGLE_MAPS_API_KEY', key);
        onKeySubmit(key);
      } else {
        showToast('Please enter a valid API key or Demo Key');
      }
    };

    if (submitBtn) submitBtn.addEventListener('click', submitHandler);
    if (inputEl) {
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitHandler();
      });
      setTimeout(() => inputEl.focus(), 100);
    }
  }

  function openBusInfoWindow(bus) {
    if (!state.mapInfoWindow || !state.mapInstance || !state.busMarker) return;
    state.mapInfoWindow.setContent(createBusPopupHtml(bus));
    state.mapInfoWindow.open({
      anchor: state.busMarker,
      map: state.mapInstance
    });
  }

  function showMapInfoPopup(contentHtml, anchorMarker) {
    if (!state.mapInfoWindow || !state.mapInstance || !anchorMarker) return;
    state.mapInfoWindow.setContent(`<div class="bus-map-popup-card">${contentHtml}</div>`);
    state.mapInfoWindow.open({
      anchor: anchorMarker,
      map: state.mapInstance
    });
  }

  async function initGoogleTrackingMap(bus, stop) {
    const mapContainer = document.getElementById('google-map') || document.getElementById('leaflet-map');
    if (!mapContainer) return;

    // Load Google Maps SDK if not yet loaded
    if (!window.google || !window.google.maps || !window.google.maps.importLibrary) {
      const apiKey = await getGoogleMapsApiKey();
      if (!apiKey) {
        renderGoogleMapsKeyPrompt(mapContainer, async (enteredKey) => {
          mapContainer.innerHTML = '';
          if (typeof window.loadGoogleMapsSdk === 'function') {
            try {
              await window.loadGoogleMapsSdk(enteredKey);
              initGoogleTrackingMap(bus, stop);
            } catch (err) {
              console.error('Failed to load Google Maps SDK:', err);
              showToast('Invalid API Key or Failed to load Google Maps');
              initGoogleTrackingMap(bus, stop);
            }
          }
        });
        return;
      }

      if (typeof window.loadGoogleMapsSdk === 'function') {
        try {
          await window.loadGoogleMapsSdk(apiKey);
        } catch (err) {
          console.error('Failed to load Google Maps SDK:', err);
          renderGoogleMapsKeyPrompt(mapContainer, async (enteredKey) => {
            mapContainer.innerHTML = '';
            await window.loadGoogleMapsSdk(enteredKey);
            initGoogleTrackingMap(bus, stop);
          });
          return;
        }
      }
    }

    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

    // Initialize map if not yet created
    if (!state.mapInstance) {
      mapContainer.innerHTML = '';
      state.mapInstance = new Map(mapContainer, {
        center: { lat: bus.currentLat, lng: bus.currentLng },
        zoom: 12,
        mapId: 'DEMO_MAP_ID',
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        internalUsageAttributionIds: ['gmp_git_agentskills_v1']
      });

      state.mapInfoWindow = new google.maps.InfoWindow();
    } else {
      state.mapInstance.setCenter({ lat: bus.currentLat, lng: bus.currentLng });
    }

    setTimeout(() => {
      if (window.google && window.google.maps && state.mapInstance) {
        google.maps.event.trigger(state.mapInstance, 'resize');
      }
    }, 200);

    // Retrieve verified real road geometry (OSRM driving highway path)
    let roadPath = (SMART_ST_DATA.routesGeometry && (SMART_ST_DATA.routesGeometry[bus.routeId] || SMART_ST_DATA.routesGeometry[bus.id]))
      ? [...(SMART_ST_DATA.routesGeometry[bus.routeId] || SMART_ST_DATA.routesGeometry[bus.id])]
      : null;

    if (!roadPath || roadPath.length < 2) {
      roadPath = bus.intermediateStops.map(st => [st.lat || stop.latitude, st.lng || stop.longitude]);
    }

    state.busRoadPath = roadPath;

    // Find closest index for bus & stop along the road route
    let minBusD = Infinity, closestBusIdx = 0;
    let minStopD = Infinity, closestStopIdx = 0;
    for (let i = 0; i < roadPath.length; i++) {
      const dBus = calculateDistanceKm(roadPath[i][0], roadPath[i][1], bus.currentLat, bus.currentLng);
      if (dBus < minBusD) { minBusD = dBus; closestBusIdx = i; }

      const dStop = calculateDistanceKm(roadPath[i][0], roadPath[i][1], stop.latitude, stop.longitude);
      if (dStop < minStopD) { minStopD = dStop; closestStopIdx = i; }
    }

    state.busRouteIndex = closestBusIdx;

    // Check if commuter's active stop is on this bus route (<= 8km)
    const isStopOnRoute = minStopD <= 8;
    let targetStopName = getStopDisplayName(stop);
    let targetStopPt = [stop.latitude, stop.longitude];
    let targetStopIdx = closestStopIdx;

    if (!isStopOnRoute) {
      const busTarget = (bus.intermediateStops && (bus.intermediateStops.find(s => s.isCurrentTarget) || bus.intermediateStops[bus.intermediateStops.length - 1])) || null;
      if (busTarget && busTarget.lat && busTarget.lng) {
        targetStopName = getStopDisplayName(busTarget);
        targetStopPt = [busTarget.lat, busTarget.lng];
        let minTgtD = Infinity, bestTgtIdx = 0;
        for (let i = 0; i < roadPath.length; i++) {
          const d = calculateDistanceKm(roadPath[i][0], roadPath[i][1], busTarget.lat, busTarget.lng);
          if (d < minTgtD) { minTgtD = d; bestTgtIdx = i; }
        }
        targetStopIdx = bestTgtIdx;
      }
    }

    state.busTargetStopIndex = targetStopIdx;
    state.currentTargetStopName = targetStopName;
    state.targetStopPt = targetStopPt;
    state.isStopOnRoute = isStopOnRoute;

    // Clear previous map layers
    if (state.busMarker) {
      state.busMarker.map = null;
      state.busMarker = null;
    }
    if (state.stopMarker) {
      state.stopMarker.map = null;
      state.stopMarker = null;
    }
    if (state.routePolylineCasing) {
      state.routePolylineCasing.setMap(null);
      state.routePolylineCasing = null;
    }
    if (state.routePolylineCore) {
      state.routePolylineCore.setMap(null);
      state.routePolylineCore = null;
    }
    if (state.intermediateMarkers && state.intermediateMarkers.length) {
      state.intermediateMarkers.forEach(m => { if (m) m.map = null; });
      state.intermediateMarkers = [];
    }

    // 1. Draw Real Road Route Polylines (Google Maps Navigation Style: Casing + Inner Glow Core)
    const gPath = roadPath.map(pt => ({ lat: pt[0], lng: pt[1] }));

    state.routePolylineCasing = new google.maps.Polyline({
      path: gPath,
      geodesic: true,
      strokeColor: '#0284c7',
      strokeOpacity: 0.45,
      strokeWeight: 8,
      map: state.mapInstance
    });

    state.routePolylineCore = new google.maps.Polyline({
      path: gPath,
      geodesic: true,
      strokeColor: '#3B82F6',
      strokeOpacity: 0.95,
      strokeWeight: 5,
      map: state.mapInstance
    });

    // Update total route distance
    const totalRouteKm = calculateRoadDistanceBetween(roadPath, 0, roadPath.length - 1);
    const totalDistEl = document.getElementById('track-route-total-dist');
    if (totalDistEl) totalDistEl.textContent = `Route: ${totalRouteKm.toFixed(0)} km`;

    // 2. Add Destination Terminal Marker (AdvancedMarkerElement)
    const endPt = roadPath[roadPath.length - 1];
    const flagPin = document.createElement('div');
    flagPin.className = 'terminal-flag-pin';
    flagPin.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;

    const destMarker = new AdvancedMarkerElement({
      map: state.mapInstance,
      position: { lat: endPt[0], lng: endPt[1] },
      content: flagPin,
      title: `Destination: ${getBusDestination(bus)}`
    });
    destMarker.addListener('click', () => {
      showMapInfoPopup(`<b>Destination: ${getBusDestination(bus)}</b><br>Final Terminal Stop`, destMarker);
    });
    state.intermediateMarkers.push(destMarker);

    // 3. Add Intermediate Stop Badges along the road
    if (bus.intermediateStops) {
      bus.intermediateStops.forEach(st => {
        if (st.lat && st.lng) {
          const isDeparted = st.status === 'Departed';
          const isTarget = st.isCurrentTarget;
          const wpColor = isDeparted ? '#94A3B8' : (isTarget ? '#10B981' : '#3B82F6');
          const wpBorder = isDeparted ? '#64748B' : '#FFFFFF';
          const wpSize = isTarget ? 18 : 14;

          const wpDot = document.createElement('div');
          wpDot.className = 'waypoint-dot-pin';
          wpDot.style.width = `${wpSize}px`;
          wpDot.style.height = `${wpSize}px`;
          wpDot.style.background = wpColor;
          wpDot.style.borderColor = wpBorder;
          wpDot.style.boxShadow = `0 2px 8px ${isTarget ? 'rgba(16,185,129,0.5)' : 'rgba(0,0,0,0.25)'}`;

          const m = new AdvancedMarkerElement({
            map: state.mapInstance,
            position: { lat: st.lat, lng: st.lng },
            content: wpDot,
            title: getStopDisplayName(st),
            zIndex: isTarget ? 400 : 100
          });
          m.addListener('click', () => {
            showMapInfoPopup(`<b>${getStopDisplayName(st)}</b><br>Scheduled: <strong>${st.time || '-'}</strong><br>Status: <strong>${st.status || 'Scheduled'}</strong>`, m);
          });
          state.intermediateMarkers.push(m);
          st.markerElement = wpDot;
        }
      });
    }

    // 4. Live Bus Pin (AdvancedMarkerElement with radar ping)
    const busPt = roadPath[state.busRouteIndex] || [bus.currentLat, bus.currentLng];
    const busPin = document.createElement('div');
    busPin.className = 'live-bus-pin-wrap';
    busPin.title = `Bus ${bus.number} - Click for details`;
    busPin.innerHTML = `
      <div class="live-bus-pulse-ring" style="background: ${bus.badgeColor}40;"></div>
      <div class="live-bus-circle" style="background: ${bus.badgeColor};">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 17h2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10h2"/>
          <circle cx="7" cy="17" r="2"/>
          <path d="M9 17h6"/>
          <circle cx="17" cy="17" r="2"/>
          <path d="M4 11h16"/>
          <path d="M4 7h16"/>
        </svg>
      </div>
    `;

    state.busMarker = new AdvancedMarkerElement({
      map: state.mapInstance,
      position: { lat: busPt[0], lng: busPt[1] },
      content: busPin,
      title: `Bus ${bus.number}`,
      zIndex: 1000
    });

    state.busMarker.addListener('click', () => {
      openBusInfoWindow(bus);
    });

    // Fit View to show both bus and approaching stop
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: busPt[0], lng: busPt[1] });
    bounds.extend({ lat: targetStopPt[0], lng: targetStopPt[1] });
    state.mapInstance.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });

    // Start Live Simulation Loop
    startLiveBusSimulation();
  }

  function renderTrackingScreen() {
    if (!state.selectedBus) {
      state.selectedBus = SMART_ST_DATA.buses[0];
    }
    const bus = state.selectedBus;
    if (!state.activeStop) {
      state.activeStop = (SMART_ST_DATA.busStops && SMART_ST_DATA.busStops.find(s => s.id === bus.targetStopId)) ||
        (bus.intermediateStops && SMART_ST_DATA.busStops && SMART_ST_DATA.busStops.find(s => s.name === bus.intermediateStops[0]?.name)) ||
        (SMART_ST_DATA.busStops && SMART_ST_DATA.busStops[0]);
    }
    const stop = state.activeStop;
    if (!bus || !stop) return;

    // Render Dynamic Route & Bus Selector Accordion (Matches Reference Design)
    renderLiveTrackingSelector();

    const speedEl = document.getElementById('track-speed');
    if (speedEl) speedEl.textContent = `${bus.speed || 48} km/h`;

    const distEl = document.getElementById('track-dist');
    if (distEl) distEl.textContent = `${bus.distanceFromStop || 6.3} km`;

    const etaEl = document.getElementById('track-eta');
    if (etaEl) etaEl.textContent = `${bus.etaMinutes || 8} mins`;

    const confEl = document.getElementById('track-confidence');
    if (confEl) confEl.textContent = `${bus.confidenceScore || 98}%`;

    const voiceBtnLabel = document.getElementById('tracking-voice-btn-label');
    if (voiceBtnLabel && !state.isVoicePlaying) {
      const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;
      voiceBtnLabel.textContent = dict.voiceAlertBtn || 'Voice Alert';
    }

    // Render CITILINC/MSRTC Style Trip Overview & Vertical Timeline
    renderTripDetailsTimeline(bus);

    // Initialize Google Maps Platform Live Tracking
    initGoogleTrackingMap(bus, stop);
  }

  // Real-time continuous synchronization of Trip Details Vertical Timeline (Progress Bar)
  function updateTimelineProgress(bus, currentTargetIdx, liveFraction = 0.0) {
    const container = document.getElementById('trip-vertical-timeline-container');
    if (!container || !bus.intermediateStops) return;

    const rows = container.querySelectorAll('.trip-stop-row');
    if (!rows || rows.length === 0) return;

    // 1. Update row statuses and labels
    rows.forEach((row, idx) => {
      const isCovered = idx < currentTargetIdx;
      const isCurrent = idx === currentTargetIdx;
      const isUpcoming = idx > currentTargetIdx;

      let statusClass = 'upcoming';
      let statusLabel = getTimelineStatusLabel('upcoming');

      if (isCovered) {
        statusClass = 'covered';
        statusLabel = getTimelineStatusLabel('covered');
      } else if (isCurrent) {
        statusClass = 'current';
        statusLabel = getTimelineStatusLabel('current');
      }

      // Update row class
      if (!row.classList.contains(statusClass)) {
        row.className = `trip-stop-row ${statusClass}`;
      }

      // Update dot class
      const dot = row.querySelector('.trip-dot');
      if (dot && !dot.classList.contains(statusClass)) {
        dot.className = `trip-dot ${statusClass}`;
      }

      // Update status label
      const statusEl = row.querySelector('.trip-stop-status');
      if (statusEl && statusEl.textContent !== statusLabel) {
        statusEl.className = `trip-stop-status ${statusClass}`;
        statusEl.textContent = statusLabel;
      }

      // Update bell visibility
      const bell = row.querySelector('.btn-stop-alert-bell');
      if (bell) {
        bell.style.display = (isCurrent || isUpcoming) ? 'inline-block' : 'none';
      }

      // Update dynamic time text
      const timeEl = row.querySelector('.trip-time-text');
      if (timeEl && bus.intermediateStops[idx]) {
        const st = bus.intermediateStops[idx];
        if (isCurrent) {
          timeEl.textContent = `${st.time} (${bus.etaMinutes}m)`;
        } else {
          timeEl.textContent = st.time || '-';
        }
      }
    });

    // 2. Position the single live moving bus badge along the timeline
    // The bus badge travels along the segment between prevRowIdx and currentTargetIdx
    const prevRowIdx = Math.max(0, currentTargetIdx - 1);
    const hostRow = rows[prevRowIdx];
    const targetRow = rows[currentTargetIdx];

    const frac = Math.max(0, Math.min(1, liveFraction));
    const pct = Math.round(frac * 100);

    // Update active-segment class and gradient fill on the row connecting prevStop to nextStop
    rows.forEach((r, rIdx) => {
      if (rIdx === prevRowIdx) {
        r.classList.add('active-segment');
        r.style.setProperty('--segment-fill', `${pct}%`);
      } else {
        r.classList.remove('active-segment');
        r.style.removeProperty('--segment-fill');
      }
    });

    // Remove any orphaned badges in other rows
    rows.forEach((r, rIdx) => {
      if (rIdx !== prevRowIdx) {
        const b = r.querySelector('.trip-bus-inline-badge');
        if (b) b.remove();
      }
    });

    if (hostRow) {
      const nodeCol = hostRow.querySelector('.trip-node-col');
      if (nodeCol) {
        let badge = nodeCol.querySelector('.trip-bus-inline-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'trip-bus-inline-badge';
          badge.id = 'trip-live-bus-badge';
          badge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/><path d="M4 11h16"/><path d="M4 7h16"/></svg>`;
          nodeCol.appendChild(badge);
        }

        // Calculate step height between previous stop row and approaching stop row
        let stepHeight = 48;
        if (targetRow && targetRow !== hostRow) {
          stepHeight = targetRow.offsetTop - hostRow.offsetTop;
        } else {
          stepHeight = hostRow.offsetHeight || 48;
        }

        const topPx = 9 + (frac * stepHeight);
        badge.style.top = `${topPx}px`;
      }
    }

    // 3. Smooth auto-scroll internally only when target stop changes
    if (state.lastTimelineTargetIdx !== currentTargetIdx) {
      state.lastTimelineTargetIdx = currentTargetIdx;
      const currentStopEl = container.querySelector('.trip-stop-row.current');
      if (currentStopEl && container.scrollHeight > container.clientHeight) {
        const topPos = currentStopEl.offsetTop - (container.clientHeight / 2);
        container.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
      }
    }
  }

  // Live Bus Location Movement Engine (Real-Time Physics Animation along Roads)
  function startLiveBusSimulation() {
    stopLiveBusSimulation();

    const bus = state.selectedBus;
    const roadPath = state.busRoadPath;
    if (!roadPath || roadPath.length < 2) return;

    // 1. Map each intermediate stop to its exact geometry road index monotonically
    if (bus.intermediateStops) {
      let lastBest = 0;
      bus.intermediateStops.forEach((st) => {
        let minD = Infinity, bestIdx = lastBest;
        for (let j = lastBest; j < roadPath.length; j++) {
          const d = calculateDistanceKm(roadPath[j][0], roadPath[j][1], st.lat, st.lng);
          if (d < minD) { minD = d; bestIdx = j; }
        }
        st.roadIndex = bestIdx;
        lastBest = bestIdx;
      });
    }

    // 2. Determine initial active approaching stop
    let activeStopIdx = bus.intermediateStops.findIndex(s => s.isCurrentTarget);
    if (activeStopIdx === -1) {
      activeStopIdx = bus.intermediateStops.findIndex(s => s.roadIndex > state.busRouteIndex);
      if (activeStopIdx === -1) activeStopIdx = bus.intermediateStops.length - 1;
    }

    // Ensure stop statuses reflect the active approaching stop
    bus.intermediateStops.forEach((s, idx) => {
      if (idx < activeStopIdx) {
        s.status = 'Departed';
        s.isCurrentTarget = false;
      } else if (idx === activeStopIdx) {
        s.status = 'NEXT STOP';
        s.isCurrentTarget = true;
      } else {
        s.status = 'Scheduled';
        s.isCurrentTarget = false;
      }
    });

    const prevStopInit = bus.intermediateStops[Math.max(0, activeStopIdx - 1)] || bus.intermediateStops[0];
    const targetStopInit = bus.intermediateStops[activeStopIdx] || bus.intermediateStops[bus.intermediateStops.length - 1];

    bus.previousStop = prevStopInit.name;
    bus.nextStop = targetStopInit.name;

    // Initial Overview Card update
    const prevStopElInit = document.getElementById('trip-prev-stop');
    const nextStopElInit = document.getElementById('trip-next-stop');
    const currLocElInit = document.getElementById('trip-curr-loc');
    if (prevStopElInit) prevStopElInit.textContent = getStopDisplayName(prevStopInit);
    if (nextStopElInit) nextStopElInit.textContent = getStopDisplayName(targetStopInit);
    if (currLocElInit) {
      const cleanPrev = getStopDisplayName(prevStopInit).replace(' Bus Stop', '').replace(' Stand', '').replace(' बस स्थानक', '').replace(' थांबा', '');
      currLocElInit.textContent = state.currentLanguage === 'mr' ? `महामार्ग कॉरिडॉर (${cleanPrev} जवळ)` : (state.currentLanguage === 'hi' ? `हाईवे कॉरिडोर (${cleanPrev} के पास)` : `Highway Corridor (Near ${cleanPrev})`);
    }

    // 3. Continuous Simulation Clock: 200ms ticks with smooth sub-meter interpolation
    const TICK_MS = 200;
    const SPEED_SCALE = 3.5; // Realistic smooth visual pacing (~50 km/h)

    let simState = {
      segmentIdx: Math.min(state.busRouteIndex, roadPath.length - 2),
      progress: 0.0,
      speedKmH: 50,
      dwellRemainingMs: 0,
      activeStopIdx: activeStopIdx
    };

    state.simulationInterval = setInterval(() => {
      // A. Dwell at bus stop (passengers boarding, doors open)
      if (simState.dwellRemainingMs > 0) {
        simState.dwellRemainingMs -= TICK_MS;
        simState.speedKmH = 0;
        bus.speed = 0;

        const currentDwellStop = bus.intermediateStops[Math.max(0, simState.activeStopIdx - 1)] || bus.intermediateStops[simState.activeStopIdx];
        const stopDisplayName = getStopDisplayName(currentDwellStop);

        const speedEl = document.getElementById('track-speed');
        const distEl = document.getElementById('track-dist');
        const etaEl = document.getElementById('track-eta');
        const statusBadge = document.getElementById('track-bus-status-badge');
        const bannerTitle = document.getElementById('map-banner-title');
        const bannerSub = document.getElementById('map-banner-sub');

        if (speedEl) speedEl.textContent = '0 km/h';
        if (distEl) distEl.textContent = '0.0 km';
        if (etaEl) etaEl.textContent = '0 mins';
        if (statusBadge) {
          statusBadge.className = 'freshness-tag live';
          const arrivedText = state.currentLanguage === 'mr' ? 'स्थानकावर थांबली · थेट GPS' : (state.currentLanguage === 'hi' ? 'स्टॉप पर रुकी · लाइव GPS' : 'At Station · Live GPS');
          statusBadge.innerHTML = `<span class="freshness-dot"></span><span>${arrivedText}</span>`;
        }
        if (bannerTitle) bannerTitle.textContent = state.currentLanguage === 'mr' ? `${stopDisplayName} येथे पोहोचली` : (state.currentLanguage === 'hi' ? `${stopDisplayName} पर पहुँची` : `Arrived at ${stopDisplayName}`);
        if (bannerSub) bannerSub.textContent = state.currentLanguage === 'mr' ? 'प्रवासी चढत आहेत • दरवाजे उघडे' : (state.currentLanguage === 'hi' ? 'यात्री चढ़ रहे हैं • दरवाजे खुले' : 'Boarding Passengers • Doors Open');

        // During dwell, the bus badge stays firmly on the dwell stop
        updateTimelineProgress(bus, simState.activeStopIdx, 0.0);

        return; // Pause movement while dwelling
      }

      // B. Realistic Speed Modulation (Cruising at 48-54 km/h, decelerating near stop)
      const targetStop = bus.intermediateStops[simState.activeStopIdx];
      const targetRoadIdx = targetStop ? targetStop.roadIndex : (roadPath.length - 1);
      const remainingRoadKm = calculateRoadDistanceBetween(roadPath, simState.segmentIdx, targetRoadIdx);

      let targetSpeed = 50 + Math.sin(Date.now() / 4000) * 4;
      if (remainingRoadKm < 0.3) {
        targetSpeed = 24; // Decelerate smoothly on approach
      }
      simState.speedKmH = Math.round(targetSpeed);
      bus.speed = simState.speedKmH;

      // C. Sub-segment Distance Increment
      const p1 = roadPath[simState.segmentIdx];
      const p2 = roadPath[Math.min(simState.segmentIdx + 1, roadPath.length - 1)];
      const segDistKm = calculateDistanceKm(p1[0], p1[1], p2[0], p2[1]) || 0.05;

      const tickDistKm = (simState.speedKmH / 3600) * (TICK_MS / 1000) * SPEED_SCALE;
      simState.progress += (tickDistKm / segDistKm);

      if (simState.progress >= 1.0) {
        simState.progress = 0.0;
        if (simState.segmentIdx < roadPath.length - 2) {
          simState.segmentIdx += 1;
        } else {
          // Reached route terminus - loop back to start
          simState.segmentIdx = 0;
          simState.activeStopIdx = 1;
          bus.intermediateStops.forEach((s, idx) => {
            s.status = idx === 0 ? 'Departed' : (idx === 1 ? 'NEXT STOP' : 'Scheduled');
            s.isCurrentTarget = (idx === 1);
          });
          bus.previousStop = bus.intermediateStops[0].name;
          bus.nextStop = bus.intermediateStops[1].name;
          updateTimelineProgress(bus, 1, 0.0);
        }
      }

      state.busRouteIndex = simState.segmentIdx;

      // D. Compute Smooth Interpolated Lat/Lng
      const ptA = roadPath[simState.segmentIdx];
      const ptB = roadPath[Math.min(simState.segmentIdx + 1, roadPath.length - 1)];
      const curLat = ptA[0] + (ptB[0] - ptA[0]) * simState.progress;
      const curLng = ptA[1] + (ptB[1] - ptA[1]) * simState.progress;

      bus.currentLat = curLat;
      bus.currentLng = curLng;

      if (state.busMarker) {
        state.busMarker.position = { lat: curLat, lng: curLng };
      }

      // E. Check if Bus Reached or Passed the Approaching Stop
      if (targetStop) {
        const distToTargetStopKm = calculateDistanceKm(curLat, curLng, targetStop.lat, targetStop.lng);
        const hasPassedGeomIdx = simState.segmentIdx >= targetStop.roadIndex;

        if (hasPassedGeomIdx || distToTargetStopKm <= 0.05) {
          // Arrived at stop! Dwell for 3.5 seconds
          simState.dwellRemainingMs = 3500;

          // Mark current stop as departed / covered
          targetStop.status = 'Departed';
          targetStop.isCurrentTarget = false;
          bus.previousStop = targetStop.name;

          // Update waypoint pin on map
          if (targetStop && targetStop.markerElement) {
            targetStop.markerElement.style.background = '#94A3B8';
            targetStop.markerElement.style.borderColor = '#64748B';
            targetStop.markerElement.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
          }

          // Advance target stop to next in sequence
          if (simState.activeStopIdx < bus.intermediateStops.length - 1) {
            simState.activeStopIdx += 1;
            const newTargetStop = bus.intermediateStops[simState.activeStopIdx];
            newTargetStop.status = 'NEXT STOP';
            newTargetStop.isCurrentTarget = true;
            bus.nextStop = newTargetStop.name;
            if (newTargetStop && newTargetStop.markerElement) {
              newTargetStop.markerElement.style.background = '#10B981';
              newTargetStop.markerElement.style.borderColor = '#FFFFFF';
              newTargetStop.markerElement.style.boxShadow = '0 2px 8px rgba(16,185,129,0.5)';
            }
          }

          // SYNC WITH THE PROGRESS BAR IMMEDIATELY (at arrival point)
          updateTimelineProgress(bus, simState.activeStopIdx, 0.0);

          // SYNC TRIP OVERVIEW CARD
          const prevStopEl = document.getElementById('trip-prev-stop');
          const nextStopEl = document.getElementById('trip-next-stop');
          const currLocEl = document.getElementById('trip-curr-loc');
          const pStop = bus.intermediateStops[Math.max(0, simState.activeStopIdx - 1)] || targetStop;
          const nStop = bus.intermediateStops[simState.activeStopIdx] || targetStop;
          if (prevStopEl) prevStopEl.textContent = getStopDisplayName(pStop);
          if (nextStopEl) nextStopEl.textContent = getStopDisplayName(nStop);
          if (currLocEl) {
            const cleanTarget = getStopDisplayName(targetStop).replace(' Bus Stop', '').replace(' Stand', '').replace(' बस स्थानक', '').replace(' थांबा', '');
            currLocEl.textContent = state.currentLanguage === 'mr' ? `महामार्ग कॉरिडॉर (${cleanTarget} जवळ)` : (state.currentLanguage === 'hi' ? `हाईवे कॉरिडोर (${cleanTarget} के पास)` : `Highway Corridor (Near ${cleanTarget})`);
          }
        }
      }

      // F. Compute Continuous Live Fraction between previous stop and approaching stop for 1:1 timeline synchronization
      const prevStopObj = bus.intermediateStops[Math.max(0, simState.activeStopIdx - 1)] || bus.intermediateStops[0];
      const targetStopObj = bus.intermediateStops[simState.activeStopIdx];
      const prevGeomIdx = prevStopObj.roadIndex || 0;
      const targetGeomIdx = targetStopObj ? targetStopObj.roadIndex : (roadPath.length - 1);

      const totalSegmentKm = calculateRoadDistanceBetween(roadPath, prevGeomIdx, targetGeomIdx);
      const distFromPrevKm = calculateRoadDistanceBetween(roadPath, prevGeomIdx, simState.segmentIdx) + (simState.progress * segDistKm);

      let liveFraction = 0.0;
      if (totalSegmentKm > 0.001) {
        liveFraction = distFromPrevKm / totalSegmentKm;
      } else if (targetGeomIdx > prevGeomIdx) {
        const currentGeomPos = simState.segmentIdx + simState.progress;
        liveFraction = (currentGeomPos - prevGeomIdx) / (targetGeomIdx - prevGeomIdx);
      } else {
        liveFraction = simState.progress;
      }
      liveFraction = Math.max(0, Math.min(1, liveFraction));

      // Continuous 1:1 sync with the vertical timeline progress bar on every tick!
      updateTimelineProgress(bus, simState.activeStopIdx, liveFraction);

      // G. Real ETA and Distance Telemetry Calculations
      const currentApproachingStop = bus.intermediateStops[simState.activeStopIdx] || targetStop;
      const distToApproachingKm = Math.max(0.05, calculateRoadDistanceBetween(roadPath, simState.segmentIdx, currentApproachingStop.roadIndex) + (1 - simState.progress) * segDistKm);
      const etaMins = Math.max(1, Math.round(distToApproachingKm / (simState.speedKmH / 60)));

      bus.distanceFromStop = parseFloat(distToApproachingKm.toFixed(1));
      bus.etaMinutes = etaMins;

      // Telemetry DOM updates
      const speedEl = document.getElementById('track-speed');
      const distEl = document.getElementById('track-dist');
      const etaEl = document.getElementById('track-eta');
      const bannerTitle = document.getElementById('map-banner-title');
      const bannerSub = document.getElementById('map-banner-sub');
      const statusBadge = document.getElementById('track-bus-status-badge');

      if (speedEl) speedEl.textContent = `${simState.speedKmH} km/h`;
      if (distEl) distEl.textContent = `${distToApproachingKm.toFixed(1)} km`;
      if (etaEl) etaEl.textContent = `${etaMins} mins`;

      const targetDisplayName = getStopDisplayName(currentApproachingStop);

      if (statusBadge) {
        const secAgo = Math.floor((Date.now() / 1000) % 25) + 4;
        const fresh = formatDataFreshness(new Date(Date.now() - secAgo * 1000), true);
        statusBadge.className = 'freshness-tag live';
        statusBadge.innerHTML = fresh.html;
      }
      if (bannerTitle) {
        const prefix = state.currentLanguage === 'mr' ? 'कडे मार्गस्थ: ' : (state.currentLanguage === 'hi' ? 'की ओर अग्रसर: ' : 'En Route to ');
        bannerTitle.textContent = `${prefix}${targetDisplayName}`;
      }
      if (bannerSub) {
        const awayStr = state.currentLanguage === 'mr' ? 'अंतर' : (state.currentLanguage === 'hi' ? 'दूरी' : 'away');
        const minsStr = state.currentLanguage === 'mr' ? 'मि.' : (state.currentLanguage === 'hi' ? 'मिनट' : 'mins');
        bannerSub.textContent = `${distToApproachingKm.toFixed(1)} km ${awayStr} • ~${etaMins} ${minsStr} (${simState.speedKmH} km/h)`;
      }

      // Live sync the selected bus tile inside the route accordion
      const selectedTile = document.querySelector(`.bus-tile[data-bus-id="${bus.id}"]`);
      if (selectedTile) {
        const etaElTile = selectedTile.querySelector('.bus-tile-eta');
        const metricsElTile = selectedTile.querySelector('.bus-tile-metrics');
        if (etaElTile) {
          const awayStr = state.currentLanguage === 'mr' ? 'मि. दूर' : (state.currentLanguage === 'hi' ? 'मिनट दूर' : 'mins away');
          etaElTile.textContent = `${etaMins} ${awayStr}`;
        }
        if (metricsElTile) {
          metricsElTile.textContent = `${distToApproachingKm.toFixed(1)} km • ${simState.speedKmH} km/h`;
        }
      }

      // Auto-follow bus if enabled (Google Maps Turn-by-Turn Camera)
      if (state.followBus && state.mapInstance) {
        state.mapInstance.panTo({ lat: curLat, lng: curLng });
      }

      // Also update popup if open
      const pSpeed = document.getElementById('popup-bus-speed');
      const pDist = document.getElementById('popup-bus-dist');
      const pEta = document.getElementById('popup-bus-eta');
      if (pSpeed) pSpeed.textContent = `${simState.speedKmH} km/h`;
      if (pDist) pDist.textContent = `${distToApproachingKm.toFixed(1)} km`;
      if (pEta) pEta.textContent = `${etaMins} mins`;

      // Update trip overview live refresh timestamp
      const refreshEl = document.getElementById('trip-refresh-time');
      if (refreshEl) refreshEl.textContent = formatTripTimestamp();

    }, TICK_MS);
  }

  function stopLiveBusSimulation() {
    if (state.simulationInterval) {
      clearInterval(state.simulationInterval);
      state.simulationInterval = null;
    }
  }

  // Setup Google Maps Floating Interactive Controls
  function setupMapInteractiveControls() {
    // 1. Layer switcher (Google Maps Types: Roadmap / Satellite / Hybrid / Terrain)
    const layerBtn = document.getElementById('btn-toggle-map-layer');
    if (layerBtn) {
      layerBtn.addEventListener('click', () => switchMapTileLayer());
    }

    // 2. Follow bus toggle (Auto-center lock)
    const followBtn = document.getElementById('btn-toggle-follow-bus');
    if (followBtn) {
      followBtn.addEventListener('click', () => {
        state.followBus = !state.followBus;
        if (state.followBus) {
          followBtn.classList.add('active');
          if (state.busMarker && state.mapInstance && state.busMarker.position) {
            state.mapInstance.panTo(state.busMarker.position);
          }
          showToast('Auto-Follow Bus: ON');
        } else {
          followBtn.classList.remove('active');
          showToast('Auto-Follow Bus: OFF');
        }
      });
    }

    // 3. Locate My Stop / Browser Geolocation with GNSS Accuracy Circle
    const locateBtn = document.getElementById('btn-locate-user-stop');
    if (locateBtn) {
      locateBtn.addEventListener('click', () => {
        showToast('Acquiring high-accuracy GPS position...');
        requestUserGpsLocation(
          async (pos, fix) => {
            const uLat = fix.lat;
            const uLng = fix.lng;
            const uAcc = fix.accuracy || 20;

            if (state.mapInstance) {
              if (state.userLocationMarker) {
                state.userLocationMarker.map = null;
                state.userLocationMarker = null;
              }
              if (state.userAccuracyCircle) {
                state.userAccuracyCircle.setMap(null);
                state.userAccuracyCircle = null;
              }

              const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
              const userElement = document.createElement('div');
              userElement.className = 'user-location-pulse-wrap';
              userElement.innerHTML = `
                <div class="user-location-pulse-ring"></div>
                <div class="user-location-dot"></div>
              `;

              state.userLocationMarker = new AdvancedMarkerElement({
                map: state.mapInstance,
                position: { lat: uLat, lng: uLng },
                content: userElement,
                title: `Your Location (±${Math.round(uAcc)}m)`
              });

              // Add Google Maps Accuracy Circle
              const isHigh = uAcc <= 35;
              state.userAccuracyCircle = new google.maps.Circle({
                map: state.mapInstance,
                center: { lat: uLat, lng: uLng },
                radius: Math.max(15, Math.min(2500, uAcc)),
                fillColor: isHigh ? '#10B981' : (uAcc <= 100 ? '#3B82F6' : '#F59E0B'),
                fillOpacity: 0.16,
                strokeColor: isHigh ? '#059669' : (uAcc <= 100 ? '#2563EB' : '#D97706'),
                strokeOpacity: 0.55,
                strokeWeight: 1.5,
                clickable: false
              });

              state.userLocationMarker.addListener('click', () => {
                showMapInfoPopup(`
                  <div style="font-size:13px; font-weight:700;">Your Location</div>
                  <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Accuracy: <strong>±${Math.round(uAcc)} meters</strong></div>
                `, state.userLocationMarker);
              });

              state.mapInstance.panTo({ lat: uLat, lng: uLng });
              showToast(`Centered on your location (±${Math.round(uAcc)}m)`);
            }
          },
          () => {
            if (state.mapInstance && state.targetStopPt) {
              state.mapInstance.panTo({ lat: state.targetStopPt[0], lng: state.targetStopPt[1] });
              showToast(`Centered on ${state.currentTargetStopName || 'Stop'}`);
            }
          }
        );
      });
    }

    // 4. Fit Full Route
    const fitRouteBtn = document.getElementById('btn-fit-full-route');
    if (fitRouteBtn) {
      fitRouteBtn.addEventListener('click', () => {
        if (state.mapInstance && state.busRoadPath && state.busRoadPath.length) {
          state.followBus = false;
          const fb = document.getElementById('btn-toggle-follow-bus');
          if (fb) fb.classList.remove('active');
          const bounds = new google.maps.LatLngBounds();
          state.busRoadPath.forEach(pt => bounds.extend({ lat: pt[0], lng: pt[1] }));
          state.mapInstance.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
          showToast('Showing Full Route');
        }
      });
    }

    // 5. Live Map Voice Alert Triggers (Header Pill & Floating Dock)
    const voiceHeaderBtn = document.getElementById('btn-tracking-voice-alert');
    if (voiceHeaderBtn) {
      voiceHeaderBtn.addEventListener('click', () => playLiveMapVoiceAlert());
    }

    const floatingVoiceBtn = document.getElementById('btn-map-floating-voice');
    if (floatingVoiceBtn) {
      floatingVoiceBtn.addEventListener('click', () => playLiveMapVoiceAlert());
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 5: BUS DETAILS & INTERMEDIATE STOPS
  // --------------------------------------------------------------------------

  function renderBusDetailsScreen() {
    const bus = state.selectedBus;
    document.getElementById('detail-bus-number').textContent = bus.number;
    document.getElementById('detail-bus-type').textContent = bus.type;
    document.getElementById('detail-bus-dest').textContent = getBusDestination(bus);
    document.getElementById('detail-bus-driver').textContent = `${bus.driverName} | Conductor: ${bus.conductorName}`;
    document.getElementById('detail-bus-fuel').textContent = bus.fuel;
    document.getElementById('detail-bus-delay').textContent = bus.delayMinutes > 0 ? `${bus.delayMinutes} mins` : "None (On Time)";

    const container = document.getElementById('intermediate-stops-list');
    if (!container) return;

    container.innerHTML = '';
    bus.intermediateStops.forEach(st => {
      const isTarget = st.isCurrentTarget;
      const displayName = getStopDisplayName(st);
      const targetLabel = isTarget ? (state.currentLanguage === 'mr' ? '(लक्षित थांबा)' : (state.currentLanguage === 'hi' ? '(लक्षित स्टॉप)' : '(Target Stop)')) : '';
      const html = `
        <div class="stop-timeline-row ${isTarget ? 'active' : ''}">
          <div class="stop-dot"></div>
          <div class="stop-info">
            <div class="name">${displayName} ${targetLabel}</div>
            <div class="time">Time: <strong>${st.time}</strong> | Status: <span class="badge ${isTarget ? 'badge-green' : 'badge-grey'}">${st.status}</span></div>
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', html);
    });
  }

  // --------------------------------------------------------------------------
  // SCREEN 6: BUS STOP INFO & FACILITIES
  // --------------------------------------------------------------------------

  function getAmenitySvg(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('bench') || n.includes('seat') || n.includes('बाकडा')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18v3M20 18v3M2 11h20M4 18h16M4 11V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5"/></svg>`;
    }
    if (n.includes('shade') || n.includes('shelter') || n.includes('शेड')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
    }
    if (n.includes('light') || n.includes('solar') || n.includes('पथदिवे')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>`;
    }
    if (n.includes('water') || n.includes('पाणी')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
    }
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  function getEmergencyContactSvg(role) {
    const r = (role || '').toLowerCase();
    if (r.includes('police')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    }
    if (r.includes('ambulance') || r.includes('hospital')) {
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/></svg>`;
    }
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  }

  function renderStopInfoScreen() {
    const stop = state.activeStop;
    document.getElementById('stop-info-title').textContent = getStopDisplayName(stop);
    document.getElementById('stop-info-landmark').textContent = `Landmark: ${stop.landmark}`;

    // Facilities
    const facContainer = document.getElementById('stop-facilities-grid');
    if (facContainer) {
      facContainer.innerHTML = '';
      stop.facilities.forEach(fac => {
        const facName = (state.currentLanguage === 'mr' && fac.nameMr) ? fac.nameMr : fac.name;
        const html = `
          <div class="amenity-card">
            <div class="amenity-icon">${getAmenitySvg(fac.name)}</div>
            <div>
              <div style="font-weight:700; font-size:13px;">${facName}</div>
              <div style="font-size:11px; color:var(--text-secondary);">${fac.status}</div>
            </div>
          </div>
        `;
        facContainer.insertAdjacentHTML('beforeend', html);
      });
    }

    // Emergency Contacts
    const emgContainer = document.getElementById('stop-emergency-list');
    if (emgContainer) {
      emgContainer.innerHTML = '';
      stop.emergencyContacts.forEach(c => {
        const html = `
          <div class="emergency-row">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="color: var(--apple-tint);">${getEmergencyContactSvg(c.role)}</div>
              <div>
                <div style="font-weight:700; font-size:14px;">${c.role}</div>
                <div style="font-size:12px; color:var(--primary-blue); font-weight:700;">${c.number}</div>
              </div>
            </div>
            <a href="tel:${c.number}" class="btn btn-sm btn-primary">Call Now</a>
          </div>
        `;
        emgContainer.insertAdjacentHTML('beforeend', html);
      });
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 7: SCHEDULE & TIMETABLE
  // --------------------------------------------------------------------------

  function renderScheduleScreen(filterType = 'ALL') {
    const tbody = document.getElementById('schedule-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    const list = SMART_ST_DATA.schedules.filter(item => {
      if (filterType === 'ALL') return true;
      return item.type.toUpperCase() === filterType.toUpperCase();
    });

    list.forEach(sch => {
      const isLive = sch.isLive;
      const html = `
        <tr class="${isLive ? 'live-row' : ''}">
          <td><strong>${sch.time}</strong></td>
          <td>${sch.destination}</td>
          <td><span class="badge badge-grey">${sch.type}</span></td>
          <td>
            ${isLive ? '<span class="badge badge-green">● LIVE NOW</span>' : `<span class="badge badge-grey">${sch.status}</span>`}
          </td>
        </tr>
      `;
      tbody.insertAdjacentHTML('beforeend', html);
    });
  }

  // --------------------------------------------------------------------------
  // SCREEN 8: JOURNEY PLANNER
  // --------------------------------------------------------------------------

  function setupJourneyPlanner() {
    const originInput = document.getElementById('journey-origin-input');
    const destInput = document.getElementById('journey-dest-input');
    const originDropdown = document.getElementById('journey-origin-dropdown');
    const destDropdown = document.getElementById('journey-dest-dropdown');
    const searchBtn = document.getElementById('btn-search-journey');
    const resultsContainer = document.getElementById('journey-results-container');
    const chipBtns = document.querySelectorAll('.btn-planner-chip');

    if (!searchBtn || !destInput) return;

    // Autocomplete dropdown handler for From & To inputs
    function setupAutocomplete(input, dropdown, onSelect) {
      if (!input || !dropdown) return;

      let selectedIndex = -1;

      function renderList(query) {
        const allStops = SMART_ST_DATA.busStops || [];
        const cleanQ = (query || '').trim().toLowerCase();
        let matched = [];

        if (!cleanQ) {
          // Show popular hubs when empty or on focus
          const priorityNames = [
            'Nashik CBS', 'Yeola Bus Stand', 'Pune', 'Lasalgaon', 'Kopargaon', 
            'Shirdi', 'Dhule', 'Mumbai Dadar', 'Sinnar', 'Manmad', 'Malegaon', 'Sangamner'
          ];
          matched = priorityNames.map(pName => {
            return allStops.find(s => s.name && s.name.toLowerCase().includes(pName.toLowerCase()));
          }).filter(Boolean);

          if (matched.length < 6) {
            allStops.slice(0, 10).forEach(s => {
              if (!matched.some(m => m.id === s.id)) matched.push(s);
            });
          }
        } else {
          // Filter matching stops
          const startsWith = [];
          const contains = [];

          allStops.forEach(s => {
            const nameEn = (s.name || '').toLowerCase();
            const nameMr = s.nameMr || '';
            const nameHi = s.nameHi || '';
            const taluka = (s.taluka || '').toLowerCase();
            const district = (s.district || '').toLowerCase();
            const village = (s.village || '').toLowerCase();

            if (nameEn.startsWith(cleanQ) || nameMr.startsWith(cleanQ) || nameHi.startsWith(cleanQ)) {
              startsWith.push(s);
            } else if (
              nameEn.includes(cleanQ) ||
              nameMr.includes(cleanQ) ||
              nameHi.includes(cleanQ) ||
              taluka.includes(cleanQ) ||
              district.includes(cleanQ) ||
              village.includes(cleanQ)
            ) {
              contains.push(s);
            }
          });

          matched = [...startsWith, ...contains].slice(0, 10);
        }

        if (matched.length === 0) {
          dropdown.innerHTML = `
            <div class="planner-dropdown-empty">
              No bus stops found matching "<strong>${cleanQ.replace(/</g, '&lt;')}</strong>"
            </div>
          `;
          dropdown.style.display = 'flex';
          return;
        }

        let html = '';
        matched.forEach((stop, idx) => {
          const dispName = getStopDisplayName(stop);
          const division = stop.district || stop.taluka || 'Maharashtra';
          const altName = state.currentLanguage !== 'mr' && stop.nameMr ? stop.nameMr : (stop.village || stop.taluka || '');
          const subText = altName ? `${altName} • ${division}` : division;

          html += `
            <div class="planner-dropdown-item" data-stop-name="${dispName.replace(/"/g, '&quot;')}" data-stop-id="${stop.id}" data-index="${idx}">
              <span class="planner-dropdown-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
              </span>
              <div class="planner-dropdown-info">
                <div class="planner-dropdown-name">${dispName}</div>
                <div class="planner-dropdown-sub">${subText}</div>
              </div>
            </div>
          `;
        });

        dropdown.innerHTML = html;
        dropdown.style.display = 'flex';
        selectedIndex = -1;

        // Attach click listeners
        dropdown.querySelectorAll('.planner-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const stopName = item.dataset.stopName;
            input.value = stopName;
            dropdown.style.display = 'none';
            if (onSelect) onSelect(stopName, item.dataset.stopId);
          });
        });
      }

      input.addEventListener('input', () => {
        renderList(input.value);
      });

      input.addEventListener('focus', () => {
        renderList(input.value);
      });

      input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.planner-dropdown-item');
        if (dropdown.style.display === 'flex' && items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle('is-selected', i === selectedIndex));
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('is-selected', i === selectedIndex));
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
            return;
          }
          if (e.key === 'Enter') {
            if (selectedIndex >= 0 && selectedIndex < items.length) {
              e.preventDefault();
              items[selectedIndex].click();
              return;
            }
          }
          if (e.key === 'Escape') {
            dropdown.style.display = 'none';
            return;
          }
        }
        if (e.key === 'Enter') {
          dropdown.style.display = 'none';
          executeJourneySearch();
        }
      });
    }

    // Initialize autocomplete on both tabs
    setupAutocomplete(originInput, originDropdown, (stopName) => {
      if (destInput && !destInput.value) {
        destInput.focus();
      }
    });

    setupAutocomplete(destInput, destDropdown, (stopName) => {
      // Destination selected
    });

    // Close dropdowns on click outside
    document.addEventListener('click', (e) => {
      if (originDropdown && !e.target.closest('#journey-origin-input') && !e.target.closest('#journey-origin-dropdown')) {
        originDropdown.style.display = 'none';
      }
      if (destDropdown && !e.target.closest('#journey-dest-input') && !e.target.closest('#journey-dest-dropdown')) {
        destDropdown.style.display = 'none';
      }
    });

    // Chip click handlers
    chipBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const dest = btn.dataset.dest || btn.textContent.trim();
        destInput.value = dest;
        if (destDropdown) destDropdown.style.display = 'none';
        executeJourneySearch();
      });
    });

    searchBtn.addEventListener('click', () => {
      if (originDropdown) originDropdown.style.display = 'none';
      if (destDropdown) destDropdown.style.display = 'none';
      executeJourneySearch();
    });

    destInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeJourneySearch();
    });

    if (originInput) {
      originInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') executeJourneySearch();
      });
    }

    function resolveStopMatch(queryStr, fallbackStop) {
      if (!queryStr || !queryStr.trim()) return fallbackStop;
      const cleanQ = queryStr.trim().toLowerCase();
      const allStops = SMART_ST_DATA.busStops || [];
      
      // Exact ID or prefix match
      let found = allStops.find(s => s.id && s.id.toLowerCase() === cleanQ);
      if (found) return found;

      // Substring match on name, nameMr, nameHi, village, taluka, district
      found = allStops.find(s => 
        (s.name && s.name.toLowerCase().includes(cleanQ)) ||
        (s.nameMr && s.nameMr.includes(cleanQ)) ||
        (s.nameHi && s.nameHi.includes(cleanQ)) ||
        (s.village && s.village.toLowerCase().includes(cleanQ)) ||
        (s.taluka && s.taluka.toLowerCase().includes(cleanQ)) ||
        (s.district && s.district.toLowerCase().includes(cleanQ))
      );
      return found || null;
    }

    function executeJourneySearch() {
      const allStops = SMART_ST_DATA.busStops || [];
      const allRoutes = SMART_ST_DATA.routes || [];
      const allBuses = SMART_ST_DATA.buses || [];
      const lang = state.currentLanguage;

      const originStr = originInput ? originInput.value.trim() : '';
      const destStr = destInput.value.trim();

      if (!destStr) {
        showToast('Please enter a destination (e.g. Yeola, Lasalgaon, Pune, Mumbai)');
        destInput.focus();
        return;
      }

      const defaultOrigin = state.activeStop || allStops[0];
      const originStop = resolveStopMatch(originStr, defaultOrigin);
      const destStop = resolveStopMatch(destStr, null);

      if (!destStop) {
        resultsContainer.innerHTML = `
          <div class="card text-center p-4 mt-3">
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px;">Destination Not Found</div>
            <div class="text-sm text-secondary">
              Could not locate a station matching "<strong>${destStr.replace(/</g, '&lt;')}</strong>".<br>
              Try destinations such as <strong>Yeola, Lasalgaon, Kopargaon, Malegaon, Pune, Mumbai Dadar, Dhule, Shirdi, Sambhajinagar</strong>.
            </div>
          </div>
        `;
        return;
      }

      if (originStop.id === destStop.id) {
        showToast('Origin and destination cannot be the same bus stop');
        return;
      }

      const originName = getStopDisplayName(originStop);
      const destName = getStopDisplayName(destStop);

      // Find Direct Routes (where origin appears before dest)
      const directRoutes = [];
      allRoutes.forEach(r => {
        const stops = r.stops || [];
        const origIdx = stops.findIndex(s => s.id === originStop.id || (s.name && s.name.toLowerCase() === originStop.name.toLowerCase()));
        const destIdx = stops.findIndex(s => s.id === destStop.id || (s.name && s.name.toLowerCase() === destStop.name.toLowerCase()));
        if (origIdx !== -1 && destIdx !== -1 && origIdx < destIdx) {
          const legStops = stops.slice(origIdx, destIdx + 1);
          const liveBus = allBuses.find(b => b.routeId === r.id) || null;
          directRoutes.push({
            route: r,
            origIdx,
            destIdx,
            numStops: destIdx - origIdx,
            stops: legStops,
            liveBus
          });
        }
      });

      // Find Connecting Routes (1 Transfer Hub)
      const connectingRoutes = [];
      if (directRoutes.length === 0 || directRoutes.length <= 2) {
        allRoutes.forEach(r1 => {
          const r1Stops = r1.stops || [];
          const i1 = r1Stops.findIndex(s => s.id === originStop.id || (s.name && s.name.toLowerCase() === originStop.name.toLowerCase()));
          if (i1 === -1 || i1 >= r1Stops.length - 1) return;

          for (let j1 = i1 + 1; j1 < r1Stops.length; j1++) {
            const hubStopInfo = r1Stops[j1];
            const hubStopId = hubStopInfo.id;
            const hubStopName = hubStopInfo.name;

            allRoutes.forEach(r2 => {
              if (r2.id === r1.id) return;
              const r2Stops = r2.stops || [];
              const j2 = r2Stops.findIndex(s => (hubStopId && s.id === hubStopId) || (s.name && s.name.toLowerCase() === hubStopName.toLowerCase()));
              if (j2 === -1 || j2 >= r2Stops.length - 1) return;

              const k2 = r2Stops.findIndex(s => s.id === destStop.id || (s.name && s.name.toLowerCase() === destStop.name.toLowerCase()));
              if (k2 !== -1 && k2 > j2) {
                const exists = connectingRoutes.some(c => c.hub.name === hubStopName && c.r1.id === r1.id && c.r2.id === r2.id);
                if (!exists) {
                  const r1Bus = allBuses.find(b => b.routeId === r1.id);
                  const r2Bus = allBuses.find(b => b.routeId === r2.id);
                  connectingRoutes.push({
                    r1,
                    hub: hubStopInfo,
                    r2,
                    stopsLeg1: r1Stops.slice(i1, j1 + 1),
                    stopsLeg2: r2Stops.slice(j2, k2 + 1),
                    r1Bus,
                    r2Bus
                  });
                }
              }
            });
          }
        });
      }

      // Sort connecting options (fewest total stops first)
      connectingRoutes.sort((a, b) => (a.stopsLeg1.length + a.stopsLeg2.length) - (b.stopsLeg1.length + b.stopsLeg2.length));

      // Render Results
      if (directRoutes.length === 0 && connectingRoutes.length === 0) {
        resultsContainer.innerHTML = `
          <div class="card text-center p-4 mt-3">
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 6px;">No Direct or 1-Stop Route Found</div>
            <div class="text-sm text-secondary">
              No scheduled routes connect <strong>${originName}</strong> to <strong>${destName}</strong> directly.<br>
              Try traveling via major central hubs like <strong>Nashik CBS</strong>, <strong>Yeola Bus Stand</strong>, or <strong>Sangamner</strong>.
            </div>
          </div>
        `;
        return;
      }

      let html = `
        <div class="card mt-3">
          <div class="flex-between">
            <span class="badge badge-blue">Transit Plan</span>
            <span class="text-sm text-secondary">${directRoutes.length} Direct • ${connectingRoutes.length} Connecting</span>
          </div>
          <div style="font-size: 18px; font-weight: 800; margin-top: 6px; display: flex; align-items: center; gap: 8px;">
            <span>${originName}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            <span style="color: var(--primary, #EF4444);">${destName}</span>
          </div>
        </div>
      `;

      // 1. Direct Routes
      if (directRoutes.length > 0) {
        html += `<div style="font-size: 14px; font-weight: 700; margin: 14px 0 6px; color: var(--text-secondary);">Direct Bus Services</div>`;
        directRoutes.forEach(dr => {
          const r = dr.route;
          const liveBus = dr.liveBus;
          const busBtnHtml = liveBus
            ? `<button class="btn btn-sm btn-primary mt-2" onclick="window.WMB.navigateTo('tracking-view', {busId:'${liveBus.id}'})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                Track Live Bus ${liveBus.number} (${liveBus.speed} km/h • ETA ${liveBus.etaMinutes}m)
               </button>`
            : `<button class="btn btn-sm btn-secondary mt-2" onclick="window.WMB.navigateTo('routes-view')">View Timetable</button>`;

          html += `
            <div class="card mt-2">
              <div class="card-header-row">
                <span class="badge badge-green">Direct Service</span>
                <span class="badge badge-blue">${r.fareRange || '₹85 - ₹160'}</span>
              </div>
              <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">${r.name}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
                ${r.categoryLabel} • Total Journey: <strong>${r.duration}</strong> (~${r.totalDistanceKm} km)<br>
                Service Frequency: <strong>${r.frequency}</strong> • Passes through ${dr.numStops} intermediate stops
              </div>
              <div style="margin-top: 6px;">
                ${busBtnHtml}
              </div>
            </div>
          `;
        });
      }

      // 2. Connecting Routes
      if (connectingRoutes.length > 0) {
        html += `<div style="font-size: 14px; font-weight: 700; margin: 16px 0 6px; color: var(--text-secondary);">Connecting Journeys (1 Transfer Hub)</div>`;
        connectingRoutes.slice(0, 3).forEach((cr, cIdx) => {
          const hubName = cr.hub.name;
          const hubMr = cr.hub.nameMr || hubName;
          const dispHub = lang === 'mr' ? hubMr : hubName;

          const leg1Bus = cr.r1Bus;
          const leg2Bus = cr.r2Bus;

          html += `
            <div class="card mt-2" style="border-left: 4px solid #f59e0b;">
              <div class="card-header-row">
                <span class="badge badge-orange">Connecting Option #${cIdx + 1}</span>
                <span class="badge badge-blue">Transfer at ${dispHub}</span>
              </div>
              <div style="font-size: 15px; font-weight: 700; margin-top: 4px;">
                Via ${dispHub} Interchange Hub
              </div>

              <!-- Leg 1 -->
              <div class="connecting-leg-card">
                <div style="font-size: 12px; font-weight: 700; color: var(--primary-blue, #2563eb);">LEG 1: Board at ${originName}</div>
                <div style="font-size: 14px; font-weight: 600; margin-top: 2px;">${cr.r1.name}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Ride to ${dispHub} (${cr.stopsLeg1.length - 1} stops)</div>
                ${leg1Bus ? `<div style="margin-top:4px;"><button class="btn btn-xs btn-primary" onclick="window.WMB.navigateTo('tracking-view', {busId:'${leg1Bus.id}'})">Track Leg 1 Bus (${leg1Bus.number})</button></div>` : ''}
              </div>

              <!-- Transfer Box -->
              <div class="transfer-hub-divider">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                <span>Transfer at ${dispHub} • Est. layover 10-15 mins</span>
              </div>

              <!-- Leg 2 -->
              <div class="connecting-leg-card">
                <div style="font-size: 12px; font-weight: 700; color: #10b981;">LEG 2: Board at ${dispHub}</div>
                <div style="font-size: 14px; font-weight: 600; margin-top: 2px;">${cr.r2.name}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Ride to destination ${destName} (${cr.stopsLeg2.length - 1} stops)</div>
                ${leg2Bus ? `<div style="margin-top:4px;"><button class="btn btn-xs btn-primary" onclick="window.WMB.navigateTo('tracking-view', {busId:'${leg2Bus.id}'})">Track Leg 2 Bus (${leg2Bus.number})</button></div>` : ''}
              </div>
            </div>
          `;
        });
      }

      resultsContainer.innerHTML = html;
    }
  }

  // --------------------------------------------------------------------------
  // SCREEN 12: COMMUNITY PASSENGER REPORTS
  // --------------------------------------------------------------------------

  function renderCommunityReportsScreen() {
    const container = document.getElementById('community-reports-list');
    if (!container) return;

    container.innerHTML = '';
    state.communityReportsList.forEach(rep => {
      const html = `
        <div class="report-feed-item">
          <div class="flex-between">
            <strong style="font-size:14px;">${rep.title}</strong>
            <span class="badge badge-orange">${rep.timestamp}</span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary);">
            Reported by: ${rep.reporter} | Auto-expires in: <strong>${rep.expiresIn}</strong>
          </div>
          <div class="flex-between mt-2">
            <span class="badge badge-green">${rep.statusBadge}</span>
            <button class="btn btn-sm btn-secondary btn-upvote-report" data-id="${rep.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Verify (${rep.votes})</span>
            </button>
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', html);
    });

    // Upvote handlers
    container.querySelectorAll('.btn-upvote-report').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const target = state.communityReportsList.find(r => r.id === id);
        if (target) {
          target.votes += 1;
          showToast('Thank you! Report vote updated.');
          renderCommunityReportsScreen();
        }
      });
    });
  }

  function setupNewReportForm() {
    const submitBtn = document.getElementById('btn-submit-community-report');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', () => {
      const select = document.getElementById('report-type-select');
      const noteInput = document.getElementById('report-note-input');
      const val = select.value;
      const note = noteInput.value.trim() || "Reported by passenger at bus stop";

      const newReport = {
        id: `REP-${Date.now()}`,
        stopId: state.activeStop ? state.activeStop.id : (SMART_ST_DATA.busStops[0] ? SMART_ST_DATA.busStops[0].id : 'NSK-CBS'),
        type: val,
        title: note,
        reporter: "Commuter Passenger",
        timestamp: "Just now",
        expiresIn: "30 mins",
        votes: 1,
        statusBadge: "Verified by 1 commuter"
      };

      state.communityReportsList.unshift(newReport);
      showToast('Passenger report published!');
      noteInput.value = '';
      closeModal('report-modal');
      renderCommunityReportsScreen();
    });
  }

  // --------------------------------------------------------------------------
  // SCREEN 13: ADMIN DASHBOARD
  // --------------------------------------------------------------------------

  function renderAdminDashboardScreen() {
    const stats = SMART_ST_DATA.adminStats;
    document.getElementById('admin-total-buses').textContent = stats.activeBusesCount;
    document.getElementById('admin-ontime-rate').textContent = `${stats.onTimePercentage}%`;
    document.getElementById('admin-active-stops').textContent = stats.activeQrStops;
    document.getElementById('admin-daily-passengers').textContent = stats.dailyPassengers.toLocaleString();

    const delayedListContainer = document.getElementById('admin-delayed-routes-list');
    if (delayedListContainer) {
      delayedListContainer.innerHTML = '';
      stats.mostDelayedRoutes.forEach(r => {
        const html = `
          <div class="flex-between" style="padding:8px 0; border-bottom:1px solid var(--border-subtle); font-size:13px;">
            <div>
              <strong>${r.route}</strong>
              <div style="font-size:11px; color:var(--text-secondary);">${r.cause}</div>
            </div>
            <span class="badge badge-orange">Avg: ${r.delayAvg}</span>
          </div>
        `;
        delayedListContainer.insertAdjacentHTML('beforeend', html);
      });
    }
  }

  // --------------------------------------------------------------------------
  // UI Helpers (Toast & Modal)
  // --------------------------------------------------------------------------

  let toastTimeout = null;
  function showToast(message) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-notification';
      toast.className = 'toast-msg';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');
      document.body.appendChild(toast);
    }
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
    toast.textContent = message;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      toastTimeout = null;
    }, 3200);
  }

  function openModal(modalId, triggerEl) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    state.modalTriggerElement = triggerEl || document.activeElement;
    state.activeModalId = modalId;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    document.body.style.overflow = 'hidden';
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.setAttribute('aria-hidden', 'true');
    }

    const drawer = modal.querySelector('.modal-drawer') || modal;
    const focusable = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      const initialFocus = drawer.querySelector('.modal-close-trigger') || focusable[0];
      setTimeout(() => {
        try { initialFocus.focus(); } catch(e) {}
      }, 50);
    }
  }

  function closeModal(modalId) {
    const targetId = modalId || state.activeModalId;
    if (!targetId) return;

    const modal = document.getElementById(targetId);
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }

    const remainingModal = document.querySelector('.modal-backdrop.active');
    if (!remainingModal) {
      document.body.style.overflow = '';
      const appContainer = document.getElementById('app-container');
      if (appContainer) {
        appContainer.removeAttribute('aria-hidden');
      }
      state.activeModalId = null;

      if (state.modalTriggerElement && typeof state.modalTriggerElement.focus === 'function') {
        try { state.modalTriggerElement.focus(); } catch(e) {}
        state.modalTriggerElement = null;
      }
    } else {
      state.activeModalId = remainingModal.id;
    }
  }

  // --------------------------------------------------------------------------
  // Global Event Listeners Setup
  // --------------------------------------------------------------------------

  function setupEventListeners() {
    // Navigation items click
    document.querySelectorAll('[data-screen-target]').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.screenTarget;
        navigateTo(target);
      });
    });

    // Contextual Header Back Button
    const headerBackBtn = document.getElementById('header-back-btn');
    if (headerBackBtn) {
      headerBackBtn.addEventListener('click', () => {
        goBack();
      });
    }

    // Hardware / Browser Back Navigation
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.screenId) {
        navigateTo(e.state.screenId, { isBack: true });
      } else if (state.navigationStack.length > 1) {
        goBack();
      }
    });

    // Language Selector Buttons
    document.querySelectorAll('.lang-selector-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lang = e.currentTarget.dataset.lang;
        updateAppLanguage(lang);
      });
    });

    // Top Header Language Dropdown Pill (Replaces accessibility button)
    const headerLangBtn = document.getElementById('header-lang-dropdown-btn');
    const headerLangMenu = document.getElementById('header-lang-menu');

    if (headerLangBtn && headerLangMenu) {
      headerLangBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        headerLangMenu.classList.toggle('open');
      });

      const langOptions = headerLangMenu.querySelectorAll('.header-lang-option');
      langOptions.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedLang = opt.getAttribute('data-lang');
          if (selectedLang) {
            updateAppLanguage(selectedLang);
          }
          headerLangMenu.classList.remove('open');
        });
      });

      document.addEventListener('click', (e) => {
        if (!headerLangBtn.contains(e.target) && !headerLangMenu.contains(e.target)) {
          headerLangMenu.classList.remove('open');
        }
      });
    }

    // QR Sample Switcher Buttons
    document.querySelectorAll('.sample-qr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const stopId = e.currentTarget.dataset.stopId;
        simulateQRScan(stopId);
      });
    });

    // Schedule Tab Filter Buttons
    document.querySelectorAll('.schedule-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.schedule-tab-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const filter = e.currentTarget.dataset.filter;
        renderScheduleScreen(filter);
      });
    });

    // Accessibility Toggles
    const darkToggle = document.getElementById('toggle-dark-mode');
    if (darkToggle) {
      darkToggle.addEventListener('change', (e) => {
        if (e.target.checked) document.body.classList.add('dark-mode');
        else document.body.classList.remove('dark-mode');
      });
    }

    const highContrastToggle = document.getElementById('toggle-high-contrast');
    if (highContrastToggle) {
      highContrastToggle.addEventListener('change', (e) => {
        if (e.target.checked) document.body.classList.add('high-contrast');
        else document.body.classList.remove('high-contrast');
      });
    }

    const largeTextToggle = document.getElementById('toggle-large-text');
    if (largeTextToggle) {
      largeTextToggle.addEventListener('change', (e) => {
        if (e.target.checked) document.body.classList.add('large-text-mode');
        else document.body.classList.remove('large-text-mode');
      });
    }

    // Modal Triggers
    const openReportModalBtn = document.getElementById('btn-open-report-modal');
    if (openReportModalBtn) {
      openReportModalBtn.addEventListener('click', () => openModal('report-modal'));
    }

    // Flashlight / Torch Toggle Button
    const btnToggleTorch = document.getElementById('btn-toggle-torch');
    if (btnToggleTorch) {
      btnToggleTorch.addEventListener('click', toggleTorch);
    }

    // QR Image File Upload Scanner
    const qrFileInput = document.getElementById('qr-file-input');
    if (qrFileInput) {
      qrFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.getElementById('qr-scan-canvas') || document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);

            // Attempt native BarcodeDetector scan first
            if (state.barcodeDetector) {
              state.barcodeDetector.detect(canvas)
                .then(barcodes => {
                  if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                    handleScannedQr(barcodes[0].rawValue);
                  } else {
                    scanUploadedImageWithJsQR(canvas, ctx);
                  }
                })
                .catch(() => scanUploadedImageWithJsQR(canvas, ctx));
            } else {
              scanUploadedImageWithJsQR(canvas, ctx);
            }
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // reset so same file can be re-selected
      });
    }

    function scanUploadedImageWithJsQR(canvas, ctx) {
      let decoded = false;
      if (typeof jsQR !== 'undefined') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: "dontInvert"
        });
        if (code && code.data) {
          decoded = true;
          handleScannedQr(code.data);
        }
      }
      if (!decoded) {
        showToast('No readable QR code found in this image. Please try a clearer picture.');
      }
    }

    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.currentTarget.closest('.modal-backdrop');
        if (modal) closeModal(modal.id);
      });
    });

    // Modal backdrop click-to-dismiss (clicking outside modal drawer)
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          closeModal(backdrop.id);
        }
      });
    });

    // Global keyboard handling: Escape to dismiss active modal, Tab focus trapping
    document.addEventListener('keydown', (e) => {
      if (state.activeModalId) {
        const modal = document.getElementById(state.activeModalId);
        if (!modal) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal(state.activeModalId);
          return;
        }

        if (e.key === 'Tab') {
          const drawer = modal.querySelector('.modal-drawer') || modal;
          const focusable = Array.from(drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
          if (focusable.length === 0) return;

          const firstEl = focusable[0];
          const lastEl = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === firstEl) {
              e.preventDefault();
              lastEl.focus();
            }
          } else {
            if (document.activeElement === lastEl) {
              e.preventDefault();
              firstEl.focus();
            }
          }
        }
      }
    });

    setupJourneyPlanner();
    setupNewReportForm();
    setupMapInteractiveControls();
    setupNearbyStopsFeature();
    setupStopSearch();
    setupRoutesScreen();
    setupNearbyStopsScreen();
    setupNetworkStatus();
    setupHomeFeatures();
    setupAccessibilityControls();

  }

  function setupHomeFeatures() {
    // 1. Feedback Modal Trigger & Submit
    const btnOpenFeedback = document.getElementById('btn-open-feedback-modal');
    if (btnOpenFeedback) {
      btnOpenFeedback.addEventListener('click', () => openModal('feedback-modal'));
    }

    const btnSubmitFeedback = document.getElementById('btn-submit-feedback');
    if (btnSubmitFeedback) {
      let lastFeedbackTime = 0;
      btnSubmitFeedback.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastFeedbackTime < 5000) {
          showToast('Please wait a moment before submitting again.');
          return;
        }

        const catSelect = document.getElementById('feedback-category-select');
        const msgInput = document.getElementById('feedback-message-input');
        const contactInput = document.getElementById('feedback-contact-input');

        const message = msgInput ? msgInput.value.trim() : '';
        if (!message) {
          showToast('Please enter your feedback message.');
          if (msgInput) msgInput.focus();
          return;
        }

        const newFeedback = {
          id: `FB-${Date.now()}`,
          category: catSelect ? catSelect.value : 'general',
          message: message,
          contact: contactInput ? contactInput.value.trim() : '',
          submittedAt: new Date().toISOString()
        };

        state.feedbackList.unshift(newFeedback);
        try { localStorage.setItem('wmb_feedbacks', JSON.stringify(state.feedbackList)); } catch(e) {}
        lastFeedbackTime = now;

        showToast('Thank you! Your feedback has been recorded.');
        if (msgInput) msgInput.value = '';
        if (contactInput) contactInput.value = '';
        closeModal('feedback-modal');
      });
    }

    // 2. Auth Modal (Sign In / Create Account)
    const btnSignIn = document.getElementById('btn-account-signin');
    const btnSignUp = document.getElementById('btn-account-signup');
    const authModalTitle = document.getElementById('auth-modal-title');
    const authTabSignIn = document.getElementById('auth-tab-signin');
    const authTabSignUp = document.getElementById('auth-tab-signup');
    const authNameGroup = document.getElementById('auth-name-group');
    const authSubmitBtn = document.getElementById('btn-auth-submit');
    const authForm = document.getElementById('auth-form');

    function setAuthMode(signUp) {
      if (signUp) {
        if (authModalTitle) authModalTitle.textContent = 'Create Account';
        if (authTabSignUp) authTabSignUp.className = 'btn btn-sm btn-primary active';
        if (authTabSignIn) authTabSignIn.className = 'btn btn-sm btn-secondary';
        if (authNameGroup) authNameGroup.style.display = 'block';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Create Account';
      } else {
        if (authModalTitle) authModalTitle.textContent = 'Sign In';
        if (authTabSignIn) authTabSignIn.className = 'btn btn-sm btn-primary active';
        if (authTabSignUp) authTabSignUp.className = 'btn btn-sm btn-secondary';
        if (authNameGroup) authNameGroup.style.display = 'none';
        if (authSubmitBtn) authSubmitBtn.textContent = 'Sign In';
      }
    }

    if (btnSignIn) {
      btnSignIn.addEventListener('click', () => {
        setAuthMode(false);
        openModal('auth-modal');
      });
    }

    if (btnSignUp) {
      btnSignUp.addEventListener('click', () => {
        setAuthMode(true);
        openModal('auth-modal');
      });
    }

    if (authTabSignIn) {
      authTabSignIn.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthMode(false);
      });
    }

    if (authTabSignUp) {
      authTabSignUp.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthMode(true);
      });
    }

    if (authForm) {
      authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const contactInput = document.getElementById('auth-contact-input');
        const passwordInput = document.getElementById('auth-password-input');
        const nameInput = document.getElementById('auth-name-input');

        const contactVal = contactInput ? contactInput.value.trim() : '';
        const passwordVal = passwordInput ? passwordInput.value.trim() : '';
        const nameVal = nameInput ? nameInput.value.trim() : '';

        if (!contactVal || !passwordVal) {
          showToast('Please enter your contact number and password.');
          return;
        }

        const displayName = nameVal || (contactVal.includes('@') ? contactVal.split('@')[0] : 'Passenger ' + contactVal.slice(-4));
        const user = {
          name: displayName,
          contact: contactVal,
          favorites: [...state.favorites],
          createdAt: new Date().toISOString()
        };

        state.currentUser = user;
        try { localStorage.setItem('wmb_currentUser', JSON.stringify(user)); } catch(e) {}

        showToast(`Welcome, ${user.name}!`);
        closeModal('auth-modal');
        if (contactInput) contactInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (nameInput) nameInput.value = '';

        renderAccountScreen();
        renderHomeDashboard();
      });
    }

    const btnSignOut = document.getElementById('btn-account-signout');
    if (btnSignOut) {
      btnSignOut.addEventListener('click', () => {
        state.currentUser = null;
        try { localStorage.removeItem('wmb_currentUser'); } catch(e) {}
        showToast('Signed out successfully.');
        renderAccountScreen();
        renderHomeDashboard();
      });
    }

    // 3. Add Favorite Stop Modal
    const btnOpenAddFav = document.getElementById('btn-open-add-favorite');
    const menuFavorites = document.getElementById('account-menu-favorites');
    const favSearchInput = document.getElementById('favorite-search-input');
    const favResultsContainer = document.getElementById('favorite-search-results');

    function populateFavoritePicker(query = '') {
      if (!favResultsContainer) return;
      favResultsContainer.innerHTML = '';
      const q = query.toLowerCase().trim();

      const candidateMap = new Map();
      SMART_ST_DATA.busStops.forEach(s => candidateMap.set(s.id, s));

      const filtered = Array.from(candidateMap.values()).filter(s => {
        if (!q) return true;
        return (s.name && s.name.toLowerCase().includes(q)) ||
               (s.nameMr && s.nameMr.includes(q)) ||
               (s.taluka && s.taluka.toLowerCase().includes(q)) ||
               (s.village && s.village.toLowerCase().includes(q));
      }).slice(0, 15);

      if (filtered.length === 0) {
        favResultsContainer.innerHTML = '<div class="text-sm text-center p-2" style="color:var(--text-secondary);">No matching stops found.</div>';
        return;
      }

      filtered.forEach(st => {
        const isFav = state.favorites.includes(st.id);
        const item = document.createElement('div');
        item.className = 'favorite-search-item';
        item.innerHTML = `
          <div>
            <strong>${getStopDisplayName(st)}</strong>
            <div class="text-sm">${st.taluka || 'Nashik'} • ${st.qrCode || 'MSRTC'}</div>
          </div>
          <button class="btn btn-sm ${isFav ? 'btn-secondary' : 'btn-outline-primary'} btn-toggle-fav-pick" data-stop-id="${st.id}">
            ${isFav ? 'Starred' : '+ Add'}
          </button>
        `;

        const btn = item.querySelector('.btn-toggle-fav-pick');
        if (btn) {
          btn.addEventListener('click', () => {
            if (state.favorites.includes(st.id)) {
              removeFavoriteStop(st.id);
              btn.className = 'btn btn-sm btn-outline-primary';
              btn.textContent = '+ Add';
            } else {
              addFavoriteStop(st.id);
              btn.className = 'btn btn-sm btn-secondary';
              btn.textContent = 'Starred';
            }
          });
        }

        favResultsContainer.appendChild(item);
      });
    }

    if (btnOpenAddFav) {
      btnOpenAddFav.addEventListener('click', () => {
        if (favSearchInput) favSearchInput.value = '';
        populateFavoritePicker('');
        openModal('add-favorite-modal');
      });
    }

    if (menuFavorites) {
      menuFavorites.addEventListener('click', () => {
        if (favSearchInput) favSearchInput.value = '';
        populateFavoritePicker('');
        openModal('add-favorite-modal');
      });
    }

    if (favSearchInput) {
      favSearchInput.addEventListener('input', (e) => {
        populateFavoritePicker(e.target.value);
      });
    }

    // 4. How It Works Modal
    const btnHowItWorks = document.getElementById('btn-home-how-it-works');
    if (btnHowItWorks) {
      btnHowItWorks.addEventListener('click', () => openModal('how-it-works-modal'));
    }

    // 5. Account menu shortcuts
    const menuMyReports = document.getElementById('account-menu-my-reports');
    if (menuMyReports) {
      menuMyReports.addEventListener('click', () => navigateTo('community-view'));
    }

    // 6. Action: Find a Bus Stop on Home (fallback if button present)
    const btnFindStop = document.getElementById('home-action-find-stop');
    if (btnFindStop) {
      btnFindStop.addEventListener('click', () => {
        navigateTo('stop-view');
        setTimeout(() => {
          const inp = document.getElementById('stop-search-input');
          if (inp) inp.focus();
        }, 300);
      });
    }

    // 7. Navigation Side Drawer Handlers
    const homeMenuBtn = document.getElementById('home-menu-btn');
    const sideDrawer = document.getElementById('side-drawer');
    const sideDrawerBackdrop = document.getElementById('side-drawer-backdrop');
    const drawerCloseBtn = document.getElementById('drawer-close-btn');

    function openSideDrawer() {
      if (sideDrawer) sideDrawer.classList.add('open');
      if (sideDrawerBackdrop) sideDrawerBackdrop.classList.add('open');
    }

    function closeSideDrawer() {
      if (sideDrawer) sideDrawer.classList.remove('open');
      if (sideDrawerBackdrop) sideDrawerBackdrop.classList.remove('open');
    }

    if (homeMenuBtn) homeMenuBtn.addEventListener('click', openSideDrawer);
    if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeSideDrawer);
    if (sideDrawerBackdrop) sideDrawerBackdrop.addEventListener('click', closeSideDrawer);

    // Close drawer when clicking any nav item in drawer
    const drawerLinks = document.querySelectorAll('.drawer-link-item');
    drawerLinks.forEach(btn => {
      btn.addEventListener('click', () => {
        closeSideDrawer();
      });
    });

    const drawerBtnFeedback = document.getElementById('drawer-btn-feedback');
    if (drawerBtnFeedback) {
      drawerBtnFeedback.addEventListener('click', () => {
        closeSideDrawer();
        openModal('feedback-modal');
      });
    }

    const drawerBtnGrievance = document.getElementById('drawer-btn-grievance');
    if (drawerBtnGrievance) {
      drawerBtnGrievance.addEventListener('click', () => {
        closeSideDrawer();
        openModal('report-modal');
      });
    }

    const drawerBtnHelpline = document.getElementById('drawer-btn-helpline');
    if (drawerBtnHelpline) {
      drawerBtnHelpline.addEventListener('click', () => {
        closeSideDrawer();
        openModal('helpline-modal');
      });
    }

    const drawerBtnHowItWorks = document.getElementById('drawer-btn-how-it-works');
    if (drawerBtnHowItWorks) {
      drawerBtnHowItWorks.addEventListener('click', () => {
        closeSideDrawer();
        openModal('how-it-works-modal');
      });
    }

    // 9. Apple HIG Search Field & Scope Bar with Recent Searches & Accessibility
    const quickSearchInput = document.getElementById('home-quick-search-input');
    const quickSearchClearBtn = document.getElementById('home-search-clear-btn');
    const quickSearchDropdown = document.getElementById('home-search-dropdown');
    const scopeBar = document.getElementById('home-search-scope-bar');
    let searchScope = 'all';
    let highlightedIndex = -1;

    function getRecentSearches() {
      try {
        const raw = localStorage.getItem('wmb_recent_searches');
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    }

    function saveRecentSearch(item) {
      try {
        let recents = getRecentSearches().filter(r => r.id !== item.id && r.label !== item.label);
        recents.unshift(item);
        if (recents.length > 5) recents = recents.slice(0, 5);
        localStorage.setItem('wmb_recent_searches', JSON.stringify(recents));
      } catch(e) {}
    }

    function clearRecentSearches() {
      try {
        localStorage.removeItem('wmb_recent_searches');
      } catch(e) {}
    }

    function updateClearBtnVisibility() {
      if (!quickSearchClearBtn || !quickSearchInput) return;
      if (quickSearchInput.value.length > 0) {
        quickSearchClearBtn.style.display = 'flex';
      } else {
        quickSearchClearBtn.style.display = 'none';
      }
    }

    function closeSearch() {
      if (!quickSearchDropdown || !quickSearchInput) return;
      quickSearchDropdown.style.display = 'none';
      quickSearchInput.setAttribute('aria-expanded', 'false');
      quickSearchInput.removeAttribute('aria-activedescendant');
      highlightedIndex = -1;
    }

    function renderZeroState() {
      if (!quickSearchDropdown || !quickSearchInput) return;
      const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;
      const recents = getRecentSearches();
      quickSearchDropdown.innerHTML = '';
      highlightedIndex = -1;

      // Section 1: Recent Searches (if any)
      if (recents.length > 0) {
        const header = document.createElement('div');
        header.className = 'search-section-header';
        header.innerHTML = `
          <span>${dict.recentSearches || 'Recent Searches'}</span>
          <button type="button" class="search-header-clear" id="btn-clear-recent">${dict.clearRecent || 'Clear'}</button>
        `;
        quickSearchDropdown.appendChild(header);

        const clearBtn = header.querySelector('#btn-clear-recent');
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearRecentSearches();
            renderZeroState();
          });
        }

        recents.forEach((item, idx) => {
          const el = document.createElement('div');
          el.className = 'home-search-item';
          el.setAttribute('role', 'option');
          el.setAttribute('id', `search-recent-${idx}`);
          el.innerHTML = `
            <div class="search-item-left">
              <div class="search-item-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div class="search-item-text">
                <div class="search-item-title">${item.label}</div>
                <div class="search-item-meta">${item.meta || 'Recent Search'}</div>
              </div>
            </div>
            <span class="text-xs" style="color: var(--apple-label-tertiary);">↵</span>
          `;
          el.addEventListener('click', () => {
            if (item.type === 'stop') {
              const stop = SMART_ST_DATA.busStops.find(s => s.id === item.id);
              if (stop) {
                closeSearch();
                openLiveMapForStop(stop);
              }
            } else if (item.type === 'bus') {
              const bus = SMART_ST_DATA.buses.find(b => b.id === item.id);
              if (bus) {
                closeSearch();
                state.selectedBus = bus;
                navigateTo('tracking-view', { busId: bus.id });
              }
            }
          });
          quickSearchDropdown.appendChild(el);
        });
      }

      // Section 2: Popular Stops (Apple Discovery pattern)
      const popularStops = SMART_ST_DATA.busStops.filter(s => ['NSK-CBS', 'NSK-RD', 'NSK-NMN', 'NSK-TRB', 'NSK-DWK'].includes(s.id));
      if (popularStops.length > 0) {
        const header = document.createElement('div');
        header.className = 'search-section-header';
        header.innerHTML = `<span>${dict.popularStops || 'Popular Stops'}</span>`;
        quickSearchDropdown.appendChild(header);

        popularStops.forEach((stop, idx) => {
          const el = document.createElement('div');
          el.className = 'home-search-item';
          el.setAttribute('role', 'option');
          el.setAttribute('id', `search-pop-${idx}`);
          el.innerHTML = `
            <div class="search-item-left">
              <div class="search-item-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-red)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
              </div>
              <div class="search-item-text">
                <div class="search-item-title">${getStopDisplayName(stop)}</div>
                <div class="search-item-meta">${stop.taluka || 'Nashik'} • ${stop.district || 'Nashik'}</div>
              </div>
            </div>
            <span class="badge badge-blue">View Live</span>
          `;
          el.addEventListener('click', () => {
            saveRecentSearch({
              id: stop.id,
              type: 'stop',
              label: getStopDisplayName(stop),
              meta: `${stop.taluka || 'Nashik'} • Stop`
            });
            closeSearch();
            state.userSelectedStopId = stop.id;
            state.hasUserSelectedStop = true;
            try { localStorage.setItem('wmb_user_selected_stop', stop.id); } catch(e) {}
            renderHomeNearbyStopCard();
            openLiveMapForStop(stop);
          });
          quickSearchDropdown.appendChild(el);
        });
      }

      quickSearchDropdown.style.display = 'flex';
      quickSearchInput.setAttribute('aria-expanded', 'true');
    }

    function performSearch(query) {
      if (!quickSearchDropdown || !quickSearchInput) return;
      const dict = SMART_ST_DATA.i18n[state.currentLanguage] || SMART_ST_DATA.i18n.en;
      highlightedIndex = -1;

      if (!query) {
        renderZeroState();
        return;
      }

      // Filter Stops (by English name, Marathi nameMr, village, taluka, id, qrCode)
      let matchedStops = [];
      if (searchScope === 'all' || searchScope === 'stops') {
        matchedStops = SMART_ST_DATA.busStops.filter(s =>
          (s.name && s.name.toLowerCase().includes(query)) ||
          (s.nameMr && s.nameMr.includes(query)) ||
          (s.village && s.village.toLowerCase().includes(query)) ||
          (s.taluka && s.taluka.toLowerCase().includes(query)) ||
          (s.qrCode && s.qrCode.toLowerCase().includes(query)) ||
          (s.id && s.id.toLowerCase().includes(query))
        ).slice(0, 6);
      }

      // Filter Buses (by bus number, routeName, destination, type, id)
      let matchedBuses = [];
      if (searchScope === 'all' || searchScope === 'routes') {
        matchedBuses = SMART_ST_DATA.buses.filter(b =>
          (b.number && b.number.toLowerCase().includes(query)) ||
          (b.routeName && b.routeName.toLowerCase().includes(query)) ||
          (b.destination && b.destination.toLowerCase().includes(query)) ||
          (b.type && b.type.toLowerCase().includes(query)) ||
          (b.id && b.id.toLowerCase().includes(query))
        ).slice(0, 5);
      }

      // If No Matches Found -> Apple Error/Empty Recovery State
      if (matchedStops.length === 0 && matchedBuses.length === 0) {
        quickSearchDropdown.innerHTML = `
          <div class="search-empty-state">
            <svg class="search-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            <div class="search-empty-title">${dict.noResultsFound || 'No stops or buses found for'} "${query}"</div>
            <div class="search-empty-hint">${dict.tryDifferentSearch || 'Try searching by route name, stop code, or Marathi name.'}</div>
          </div>
        `;
        quickSearchDropdown.style.display = 'flex';
        quickSearchInput.setAttribute('aria-expanded', 'true');
        return;
      }

      quickSearchDropdown.innerHTML = '';
      let itemCounter = 0;

      // Render Stops Section
      if (matchedStops.length > 0) {
        const header = document.createElement('div');
        header.className = 'search-section-header';
        header.innerHTML = `<span>${dict.navStop || 'Bus Stops'} (${matchedStops.length})</span>`;
        quickSearchDropdown.appendChild(header);

        matchedStops.forEach(stop => {
          const item = document.createElement('div');
          item.className = 'home-search-item';
          item.setAttribute('role', 'option');
          item.setAttribute('id', `search-res-${itemCounter++}`);
          item.innerHTML = `
            <div class="search-item-left">
              <div class="search-item-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-red)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="2.5"/>
                </svg>
              </div>
              <div class="search-item-text">
                <div class="search-item-title">${getStopDisplayName(stop)}</div>
                <div class="search-item-meta">${stop.taluka || 'Nashik'} • Stop ${stop.id || ''}</div>
              </div>
            </div>
            <span class="badge badge-blue">View Live</span>
          `;
          item.addEventListener('click', () => {
            saveRecentSearch({
              id: stop.id,
              type: 'stop',
              label: getStopDisplayName(stop),
              meta: `${stop.taluka || 'Nashik'} • Stop`
            });
            closeSearch();
            quickSearchInput.value = '';
            updateClearBtnVisibility();
            state.userSelectedStopId = stop.id;
            state.hasUserSelectedStop = true;
            try { localStorage.setItem('wmb_user_selected_stop', stop.id); } catch(e) {}
            renderHomeNearbyStopCard();
            openLiveMapForStop(stop);
          });
          quickSearchDropdown.appendChild(item);
        });
      }

      // Render Buses Section
      if (matchedBuses.length > 0) {
        const header = document.createElement('div');
        header.className = 'search-section-header';
        header.innerHTML = `<span>${dict.navRoutes || 'Buses & Routes'} (${matchedBuses.length})</span>`;
        quickSearchDropdown.appendChild(header);

        matchedBuses.forEach(bus => {
          const item = document.createElement('div');
          item.className = 'home-search-item';
          item.setAttribute('role', 'option');
          item.setAttribute('id', `search-res-${itemCounter++}`);
          item.innerHTML = `
            <div class="search-item-left">
              <div class="search-item-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="14" rx="2"/>
                  <path d="M7 18v2M17 18v2M3 10h18"/>
                  <circle cx="7.5" cy="14.5" r="1"/>
                  <circle cx="16.5" cy="14.5" r="1"/>
                </svg>
              </div>
              <div class="search-item-text">
                <div class="search-item-title">${bus.number} · <span style="color:var(--msrtc-crimson); font-weight:700;">${bus.type}</span></div>
                <div class="search-item-meta">${bus.routeName} • ETA: ${bus.etaMinutes}m</div>
              </div>
            </div>
            <span class="badge badge-green">Track GPS</span>
          `;
          item.addEventListener('click', () => {
            saveRecentSearch({
              id: bus.id,
              type: 'bus',
              label: `${bus.number} (${bus.type})`,
              meta: `${bus.routeName}`
            });
            closeSearch();
            quickSearchInput.value = '';
            updateClearBtnVisibility();
            state.selectedBus = bus;
            navigateTo('tracking-view', { busId: bus.id });
          });
          quickSearchDropdown.appendChild(item);
        });
      }

      quickSearchDropdown.style.display = 'flex';
      quickSearchInput.setAttribute('aria-expanded', 'true');
    }

    function updateHighlight(items) {
      items.forEach((item, idx) => {
        if (idx === highlightedIndex) {
          item.classList.add('highlighted');
          quickSearchInput.setAttribute('aria-activedescendant', item.id);
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('highlighted');
        }
      });
    }

    if (quickSearchInput && quickSearchDropdown) {
      quickSearchInput.addEventListener('focus', () => {
        const query = quickSearchInput.value.trim().toLowerCase();
        if (!query) {
          renderZeroState();
        } else {
          performSearch(query);
        }
      });

      quickSearchInput.addEventListener('input', (e) => {
        updateClearBtnVisibility();
        const query = e.target.value.trim().toLowerCase();
        performSearch(query);
      });

      quickSearchInput.addEventListener('keydown', (e) => {
        const items = Array.from(quickSearchDropdown.querySelectorAll('.home-search-item'));
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightedIndex = (highlightedIndex + 1) % items.length;
          updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightedIndex = (highlightedIndex - 1 + items.length) % items.length;
          updateHighlight(items);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (highlightedIndex >= 0 && items[highlightedIndex]) {
            items[highlightedIndex].click();
          } else if (items[0]) {
            items[0].click();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeSearch();
          quickSearchInput.blur();
        }
      });

      // Clear button click handler
      if (quickSearchClearBtn) {
        quickSearchClearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          quickSearchInput.value = '';
          updateClearBtnVisibility();
          quickSearchInput.focus();
          renderZeroState();
        });
      }

      // Scope bar buttons click
      if (scopeBar) {
        scopeBar.querySelectorAll('.scope-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            scopeBar.querySelectorAll('.scope-pill').forEach(p => {
              p.classList.remove('active');
              p.setAttribute('aria-selected', 'false');
            });
            pill.classList.add('active');
            pill.setAttribute('aria-selected', 'true');
            searchScope = pill.dataset.scope || 'all';
            const query = quickSearchInput.value.trim().toLowerCase();
            performSearch(query);
          });
        });
      }

      // Click outside to dismiss
      document.addEventListener('click', (e) => {
        const container = document.getElementById('home-search-container');
        if (container && !container.contains(e.target)) {
          closeSearch();
        }
      });
    }

    // 10. Portal 12-Button Grid Direct Actions
    const btnPortalBookTicket = document.getElementById('btn-portal-book-ticket');
    if (btnPortalBookTicket) {
      btnPortalBookTicket.addEventListener('click', () => openModal('ticket-booking-modal'));
    }

    const btnPortalViewTickets = document.getElementById('btn-portal-view-tickets');
    if (btnPortalViewTickets) {
      btnPortalViewTickets.addEventListener('click', () => openModal('view-tickets-modal'));
    }

    const btnPortalMyPass = document.getElementById('btn-portal-my-pass');
    if (btnPortalMyPass) {
      btnPortalMyPass.addEventListener('click', () => openModal('my-pass-modal'));
    }

    const btnPortalNearbyStops = document.getElementById('btn-portal-nearby-stops');
    if (btnPortalNearbyStops) {
      btnPortalNearbyStops.addEventListener('click', () => {
        navigateTo('nearby-stops-view');
      });
    }

    const btnPortalLocateMe = document.getElementById('btn-portal-locate-me');
    if (btnPortalLocateMe) {
      btnPortalLocateMe.addEventListener('click', () => {
        showToast('Acquiring live GPS coordinates...');
        requestUserGpsLocation(
          pos => {
            renderPortalNearbyStopsList();
            renderHomeNearbyStopCard();
            if (state.isAccurateGps) {
              renderNearbyBusStops(pos.coords.latitude, pos.coords.longitude);
              showToast('Updated nearby stops based on your location!');
            } else {
              renderNearbyBusStops();
              showToast('Device GPS unavailable (network IP). Select your stop below.');
            }
          },
          err => {
            showToast('Could not acquire GPS position. Showing regional stops.');
          }
        );
      });
    }

    const btnPortalMyFavourites = document.getElementById('btn-portal-my-favourites');
    if (btnPortalMyFavourites) {
      btnPortalMyFavourites.addEventListener('click', () => {
        renderPortalFavoritesList();
        openModal('home-favorites-modal');
      });
    }

    const btnPortalFeedback = document.getElementById('btn-portal-feedback');
    if (btnPortalFeedback) {
      btnPortalFeedback.addEventListener('click', () => openModal('feedback-modal'));
    }

    const btnPortalGrievance = document.getElementById('btn-portal-grievance');
    if (btnPortalGrievance) {
      btnPortalGrievance.addEventListener('click', () => openModal('report-modal'));
    }

    const btnPortalApplyPass = document.getElementById('btn-portal-apply-pass');
    if (btnPortalApplyPass) {
      btnPortalApplyPass.addEventListener('click', () => openModal('offline-pass-modal'));
    }

    const btnPortalHelpline = document.getElementById('btn-portal-helpline');
    if (btnPortalHelpline) {
      btnPortalHelpline.addEventListener('click', () => openModal('helpline-modal'));
    }

    const btnSplashHowToUse = document.getElementById('btn-splash-how-to-use');
    if (btnSplashHowToUse) {
      btnSplashHowToUse.addEventListener('click', () => openModal('how-it-works-modal', btnSplashHowToUse));
    }

    // 11. New Modal Actions
    const btnProceedBooking = document.getElementById('btn-proceed-booking');
    if (btnProceedBooking) {
      btnProceedBooking.addEventListener('click', () => {
        const fromVal = document.getElementById('booking-from-select')?.value || '';
        const toVal = document.getElementById('booking-to-select')?.value || '';
        closeModal('ticket-booking-modal');
        navigateTo('planner-view');
        setTimeout(() => {
          const originInp = document.getElementById('journey-origin-input') || document.getElementById('planner-origin');
          const destInp = document.getElementById('journey-dest-input') || document.getElementById('planner-dest');
          if (originInp && fromVal) originInp.value = fromVal;
          if (destInp && toVal) destInp.value = toVal;
          const planBtn = document.getElementById('btn-search-journey') || document.getElementById('btn-plan-journey');
          if (planBtn) planBtn.click();
        }, 200);
      });
    }

    const btnShowTicketQr = document.getElementById('btn-show-ticket-qr');
    if (btnShowTicketQr) {
      btnShowTicketQr.addEventListener('click', () => {
        showToast('Conductor QR code active and verified.');
      });
    }

    const btnBookNewFromView = document.getElementById('btn-book-new-ticket-from-view');
    if (btnBookNewFromView) {
      btnBookNewFromView.addEventListener('click', () => {
        closeModal('view-tickets-modal');
        openModal('ticket-booking-modal');
      });
    }

    const btnRenewPass = document.getElementById('btn-renew-pass');
    if (btnRenewPass) {
      btnRenewPass.addEventListener('click', () => {
        showToast('Renewal request submitted to MSRTC Nashik Division.');
      });
    }

    const btnDownloadPass = document.getElementById('btn-download-pass');
    if (btnDownloadPass) {
      btnDownloadPass.addEventListener('click', () => {
        showToast('Smart Pass downloaded to device storage.');
      });
    }

    const btnPortalAddFav = document.getElementById('btn-portal-add-favorite');
    if (btnPortalAddFav) {
      btnPortalAddFav.addEventListener('click', () => {
        closeModal('home-favorites-modal');
        if (favSearchInput) favSearchInput.value = '';
        populateFavoritePicker('');
        openModal('add-favorite-modal');
      });
    }
  }


  function setupAccessibilityControls() {
    const toggleDark = document.getElementById('toggle-dark-mode');
    const toggleContrast = document.getElementById('toggle-high-contrast');
    const toggleLarge = document.getElementById('toggle-large-text');

    // Restore saved preferences
    const isDark = localStorage.getItem('wmb_dark_mode') === 'true';
    const isContrast = localStorage.getItem('wmb_high_contrast') === 'true';
    const isLarge = localStorage.getItem('wmb_large_text') === 'true';

    if (toggleDark) {
      toggleDark.checked = isDark;
      document.body.classList.toggle('dark-mode', isDark);
      toggleDark.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.body.classList.toggle('dark-mode', checked);
        try { localStorage.setItem('wmb_dark_mode', checked); } catch(err) {}
        showToast(checked ? 'Dark Mode activated' : 'Light Mode activated');
      });
    }

    if (toggleContrast) {
      toggleContrast.checked = isContrast;
      document.body.classList.toggle('high-contrast', isContrast);
      toggleContrast.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.body.classList.toggle('high-contrast', checked);
        try { localStorage.setItem('wmb_high_contrast', checked); } catch(err) {}
        showToast(checked ? 'High Contrast Mode activated' : 'Standard Contrast restored');
      });
    }

    if (toggleLarge) {
      toggleLarge.checked = isLarge;
      document.body.classList.toggle('large-text-mode', isLarge);
      toggleLarge.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.body.classList.toggle('large-text-mode', checked);
        try { localStorage.setItem('wmb_large_text', checked); } catch(err) {}
        showToast(checked ? 'Large Readable Text activated' : 'Standard Text Size restored');
      });
    }
  }
  function setupNetworkStatus() {
    const banner = document.getElementById('offline-banner') || document.querySelector('.offline-banner');
    if (!banner) return;
    function updateOnlineStatus() {
      if (navigator.onLine) {
        banner.style.display = 'none';
      } else {
        banner.style.display = 'flex';
      }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    window.addEventListener('resize', () => {
      if (window.google && window.google.maps && state.mapInstance) {
        google.maps.event.trigger(state.mapInstance, 'resize');
      }
    });
    updateOnlineStatus();
  }

  // --------------------------------------------------------------------------
  // Application Bootstrap
  // --------------------------------------------------------------------------

  // Initialize and apply persisted language silently
  updateAppLanguage(state.currentLanguage, { silent: true });

  setupEventListeners();
  // Expose global methods for inline HTML handlers if needed
  window.WMB = {
    navigateTo,
    goBack,
    formatDataFreshness,
    showToast,
    openModal,
    closeModal,
    simulateQRScan,
    renderRoutesScreen,
    renderNearbyStopsScreen,
    renderHomeDashboard,
    openLiveMapForStop,
    findBestUpcomingBusForStop
  };
  window.SmartST = window.WMB;
  window.TMB = window.WMB;

  // Handle URL ?stop= query parameter if scanned from external QR code or test link
  const urlParams = new URLSearchParams(window.location.search);
  const initialStopQuery = urlParams.get('stop');
  if (initialStopQuery) {
    const queryCode = initialStopQuery.trim();
    const matchedStop = SMART_ST_DATA.busStops.find(s => {
      if (s.id && s.id.toLowerCase() === queryCode.toLowerCase()) return true;
      if (s.qrCode && s.qrCode.toLowerCase() === queryCode.toLowerCase()) return true;
      if (s.name && s.name.toLowerCase().includes(queryCode.toLowerCase())) return true;
      if (s.nameMr && s.nameMr.includes(queryCode)) return true;
      return false;
    }) || SMART_ST_DATA.busStops[0];

    console.log('[WMB] Direct QR URL link detected. Opening stop:', matchedStop.name);
    openLiveMapForStop(matchedStop);
  } else {
    // Start on Splash Screen
    navigateTo('splash-view');
  }
});
