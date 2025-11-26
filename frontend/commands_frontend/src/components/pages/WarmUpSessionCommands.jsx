import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversation } from '@elevenlabs/react';
import './WarmUpSession.css';
import VoiceAgentUI from '../VoiceAgentUI';

import { HAND_CONNECTIONS } from '@mediapipe/hands';
import { Holistic } from '@mediapipe/holistic';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import snowGif from '../../assets/snow_gif.gif';
import snowballImg from '../../assets/Snowball.png';
import snowBackground from '../../assets/Snow_background.png';
import commandsVideo from '../../assets/commands_video.mp4';

// API Configuration
const API_BASE_URL = 'http://localhost:8000';

// Helper function to send events to Django backend
const sendEventToBackend = async (eventType, data) => {
  try {
    const response = await fetch(`${API_BASE_URL}/monitor/save-event/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: eventType, ...data })
    });
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('❌ Failed to save event to backend:', error);
  }
};

const CommandsWarmUpSession = () => {
  const navigate = useNavigate();
  // Hardcoded username for this mini project (keeps integration simple).
  const HARDCODED_USERNAME = 'Amal';
  const [username, setUsername] = useState(HARDCODED_USERNAME);
  const [status, setStatus] = useState('intro_video'); // Start directly with video
  const [errorMessage, setErrorMessage] = useState('');

  // Camera & UI State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const isCameraOnRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showEndButton, setShowEndButton] = useState(false);

  // Game Logic State
  const [currentCommand, setCurrentCommand] = useState(null);
  const [commandCompleted, setCommandCompleted] = useState(false);
  const [faceAbsent, setFaceAbsent] = useState(false);

  // --- PHASES & UI STATE ---
  // Phases: 'WARMUP' -> 'PART_A' -> 'PART_B' -> 'PART_C' -> 'COMPLETED'
  const [lessonPhase, setLessonPhase] = useState('WARMUP');
  const [visibleSentences, setVisibleSentences] = useState(0);

  // Keep locally-updated sentence texts so we can mirror the agent's exact spoken transcript
  const defaultPartB = [
    'The flowers are very colourful.',
    'Can you water the flowers?',
    'Pick a flower for me.'
  ];
  const defaultPartC = [
    'will you help your friend',
    'stop right there',
    'the sky is turning grey'
  ];
  const [partBSentences, setPartBSentences] = useState(defaultPartB);
  const [partCSentences, setPartCSentences] = useState(defaultPartC);

  // Track spoken reveals coming from the agent transcript so we can reveal them locally while it's speaking
  const [spokenReveals, setSpokenReveals] = useState([]); // { phase, index, text, ts, shown }

  // NEW: Store conversation messages so we can display agent transcript
  const [conversationHistory, setConversationHistory] = useState([]);

  // Refs
  const activeCommandRef = useRef(null);
  const commandCompletedRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const hasStartedRef = useRef(false);
  const holisticRef = useRef(null);
  const faceDetectionRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastHandLogRef = useRef(0);
  // Safety net timer ref (so we can cancel it from onMessage)
  const safetyTimerRef = useRef(null);

  // Detection counters
  const detectionStateRef = useRef({
    clapCount: 0,
    isProcessingClap: false,
    prevWristDist: null,
    lastClapTime: 0,

    noseTouchStreak: 0,
    lastNoseTouchAt: 0,
    waveCount: 0,
    isWaving: false,
    waveStartTime: 0,
    lastWaveTime: 0,
    lastFaceDetectedTime: Date.now(),
    isAbsent: false,
    absenceNotified: false
  });

  // --- 1. CAMERA CLEANUP ---
  const stopCamera = useCallback(() => {
    isCameraOnRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (holisticRef.current) {
      holisticRef.current.close();
      holisticRef.current = null;
    }
    setIsCameraOn(false);
  }, []);


  // --- 2. ELEVENLABS CONFIGURATION ---
  const conversation = useConversation({
    // Define tools for the Agent to control the UI
    clientTools: {
      changeLessonPhase: async ({ phase }) => {
        console.log(`🛠️ Tool Called: changeLessonPhase -> ${phase}`);

        // Delay slightly to allow "Transition Speech" to play before switching UI
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (phase === 'PART_A') {
          stopCamera(); // Turn off camera when moving to Snowball phase
        }
        // Reset visible sentences when changing phase (ensures PART_C starts with hidden sentences)
        setVisibleSentences(0);
        setLessonPhase(phase);
        setCurrentCommand(null);

        // Wait for UI to render/settle before Agent proceeds to next topic
        await new Promise(resolve => setTimeout(resolve, 500));

        return `Phase changed to ${phase}`;
      },
      revealSentence: async (params) => {
        console.log(`🛠️ Tool Called: revealSentence with params:`, params);

        // Small delay to sync with "One..." or "Two..." speech
        await new Promise(resolve => setTimeout(resolve, 500));

        // Handle the parameter name from ElevenLabs config
        let index = params?.sentenceNumber ?? params?.sentenceIndex ?? params?.index ?? 1;
        console.log(`📊 Extracted sentence number: ${index}`);
        setVisibleSentences(Number(index));
        return `Sentence ${index} revealed`;
      },
      endCall: async () => {
        console.log('🛠️ Tool Called: endCall');
        await conversation.endSession();
        return 'Call ended';
      }
    },
    onConnect: () => console.log('✅ Connected to ElevenLabs'),
    onMessage: (message) => {
      // Store message in history for transcript display
      let messageText = '';
      let messageSource = 'user'; // default

      // Extract text from different message formats
      if (message.message) { messageText = message.message; }
      else if (message.text) { messageText = message.text; }
      else if (message.messages?.find(m => m.type === 'text')) {
        const m = message.messages.find(m => m.type === 'text');
        messageText = m.text;
      }

      // Determine source (agent vs user)
      if (message.source === 'ai' || message.source === 'agent' || message.role === 'assistant') {
        messageSource = 'ai';
      }

      // Add to conversation history
      if (messageText) {
        setConversationHistory(prev => [...prev, { text: messageText, source: messageSource, ts: Date.now() }]);
        console.log(`📨 Message (${messageSource}):`, messageText);
      }

      // Preserve the original/raw text and also a lower-cased version for matching
      let messageRaw = messageText;
      let messageTextLower = messageText.toLowerCase();

      // --- SENTENCE REVEAL LOGIC (Pattern Matching) ---
      // For the 3-option questions (PART_B / PART_C) we capture the exact spoken transcript
      // and reveal the matching sentence locally while the agent is SPEAKING to avoid network/tool delay.
      // Strict local reveal matching: immediately reveal matching sentences
      // to avoid network/tool latency. We set visible sentences locally
      // as soon as the speech transcript includes the expected substring.
      // Helper: Check if text contains ANY of the given keywords (fuzzy substring match)
      const matchesAny = (text, keywords) => keywords.some(k => text.includes(k));

      if (lessonPhase === 'PART_B') {
        if (matchesAny(messageText, ['flowers', 'colourful', 'colorful'])) {
          // Clear safety timer (we've received the transcript we need)
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartBSentences(prev => { const next = [...prev]; next[0] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_B', index: 1, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_B detected: sentence 1 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 1));
        }
        if (matchesAny(messageText, ['water', 'flowers'])) {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartBSentences(prev => { const next = [...prev]; next[1] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_B', index: 2, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_B detected: sentence 2 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 2));
        }
        if (matchesAny(messageText, ['pick', 'flower'])) {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartBSentences(prev => { const next = [...prev]; next[2] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_B', index: 3, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_B detected: sentence 3 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 3));
        }
      }

      if (lessonPhase === 'PART_C') {
        if (matchesAny(messageText, ['help', 'friend'])) {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartCSentences(prev => { const next = [...prev]; next[0] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_C', index: 1, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_C detected: sentence 1 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 1));
        }
        if (matchesAny(messageText, ['stop', 'right', 'there'])) {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartCSentences(prev => { const next = [...prev]; next[1] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_C', index: 2, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_C detected: sentence 2 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 2));
        }
        if (matchesAny(messageText, ['sky', 'turning', 'grey', 'gray'])) {
          if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
          setPartCSentences(prev => { const next = [...prev]; next[2] = messageRaw; return next; });
          setSpokenReveals(prev => [...prev, { phase: 'PART_C', index: 3, text: messageRaw, ts: Date.now(), shown: true }]);
          console.log('🟢 PART_C detected: sentence 3 -> reveal immediately');
          setVisibleSentences(prev => Math.max(prev, 3));
        }
      }

      // --- PHYSICAL COMMAND DETECTION (Only in WARMUP) ---
      if (lessonPhase === 'WARMUP') {
        // Wave
        if (messageTextLower.includes('wave') && (messageTextLower.includes('can you') || messageTextLower.includes('try'))) {
          if (activeCommandRef.current !== 'WAVE' || commandCompletedRef.current) {
            activeCommandRef.current = 'WAVE';
            commandCompletedRef.current = false;
            setCurrentCommand('👋 WAVE');
            setCommandCompleted(false);
          }
        }
        // Clap
        if (messageTextLower.includes('clap') && (messageTextLower.includes('can you') || messageTextLower.includes('try') || messageTextLower.includes('hands'))) {
          if (activeCommandRef.current !== 'CLAP' || commandCompletedRef.current) {
            activeCommandRef.current = 'CLAP';
            commandCompletedRef.current = false;
            setCurrentCommand('👏 CLAP');
            setCommandCompleted(false);
            detectionStateRef.current.clapCount = 0;
          }
        }
        // Touch Nose
        if ((messageTextLower.includes('touch') || messageTextLower.includes('point')) && messageTextLower.includes('nose')) {
          if (activeCommandRef.current !== 'NOSE_TOUCH' || commandCompletedRef.current) {
            activeCommandRef.current = 'NOSE_TOUCH';
            commandCompletedRef.current = false;
            setCurrentCommand('👃 TOUCH NOSE');
            setCommandCompleted(false);
            detectionStateRef.current.noseTouchStreak = 0;
          }
        }
        // Raise Hand
        if (messageTextLower.includes('raise') && messageTextLower.includes('hand')) {
          if (activeCommandRef.current !== 'RAISE_HAND' || commandCompletedRef.current) {
            activeCommandRef.current = 'RAISE_HAND';
            commandCompletedRef.current = false;
            setCurrentCommand('✋ RAISE HAND');
            setCommandCompleted(false);
          }
        }
      }

      // End Session Detection
      if (messageText.includes('[lesson_complete]') && !isFinishing) {
        setIsFinishing(true);
      }
    },
    onError: (error) => {
      console.error('❌ Conversation error:', error);
      setErrorMessage(error.message || 'Conversation error');
      setStatus('error');
    },
    onDisconnect: () => {
      console.warn('🔌 Disconnected');
      try { stopCamera(); } catch (e) { console.error('Error stopping camera on disconnect:', e); }
    }
  });

  const { status: convStatus, isSpeaking, startSession, endSession } = conversation;

  // Extract latest AI message from conversation history
  const latestAgentMessage = conversationHistory
    .slice()
    .reverse()
    .find((msg) => msg.source === 'ai')?.text || '';

  // If the agent is speaking, reveal any spokenReveals for the current phase locally
  useEffect(() => {
    if (!isSpeaking) return;
    setSpokenReveals(prev => {
      let changed = false;
      const next = prev.map(item => {
        if (!item.shown && item.phase === lessonPhase) {
          changed = true;
          setVisibleSentences(v => Math.max(v, item.index));
          return { ...item, shown: true };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [isSpeaking, lessonPhase]);

  // When visibleSentences increases (for example via tool reveal), mark related spokenReveals as shown
  useEffect(() => {
    if (visibleSentences <= 0) return;
    setSpokenReveals(prev => prev.map(item => {
      if (!item.shown && item.phase === lessonPhase && item.index <= visibleSentences) {
        return { ...item, shown: true };
      }
      return item;
    }));
  }, [visibleSentences, lessonPhase]);

  // --- 3. INITIALIZATION ---
  useEffect(() => {
    // For this mini project we hardcode the student name to avoid integration issues.
    setUsername(HARDCODED_USERNAME);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎬 COMPONENT INITIALIZED');
    console.log('  ✓ Hardcoded username:', HARDCODED_USERNAME);
    console.log('  ✓ Initial status:', 'intro_video');
    console.log('═══════════════════════════════════════════════════════════════');
  }, []);

  // --- SAFETY NET: Auto-reveal if AI fails ---
  useEffect(() => {
    // Only run in PART_B or PART_C, and only if no sentences are visible
    if ((lessonPhase === 'PART_B' || lessonPhase === 'PART_C') && visibleSentences === 0) {
      console.log("⏳ Waiting for AI to reveal sentences...");

      // Clear any previous safety timer just in case
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }

      // Set a timer: If AI doesn't reveal sentence 1 within 10 seconds, show ALL.
      safetyTimerRef.current = setTimeout(() => {
        console.warn("⚠️ SAFETY NET TRIGGERED: Forcing display of all sentences in phase:", lessonPhase);
        setVisibleSentences(3); // Force show all
        safetyTimerRef.current = null;
      }, 10000); // 10 seconds

      return () => {
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
      };
    } else {
      // If not in those phases or sentences are visible, clear any timer
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    }
  }, [lessonPhase, visibleSentences]);

  // Handle Gesture Success
  const handleCommandSuccess = useCallback((commandType) => {
    console.log('✅ handleCommandSuccess called for:', commandType);
    if (commandCompletedRef.current) return;
    commandCompletedRef.current = true;
    setCommandCompleted(true);

    // Do not award score for the warmup physical gestures (they are practice)
    const warmupGestures = ['WAVE', 'CLAP', 'NOSE_TOUCH', 'RAISE_HAND'];
    // No scoring for now; warmup gestures shouldn't modify a visible score.

    const signals = {
      'WAVE': '[STUDENT_WAVED]',
      'CLAP': '[STUDENT_CLAPPED]',
      'NOSE_TOUCH': '[STUDENT_TOUCHED_NOSE]',
      'RAISE_HAND': '[STUDENT_RAISED_HAND]'
    };
    const signal = signals[commandType] || '[COMMAND_COMPLETED]';

    if (conversation && conversation.sendUserMessage) {
      conversation.sendUserMessage(signal);
    }

    setTimeout(() => {
      setCurrentCommand(null);
      setCommandCompleted(false);
      activeCommandRef.current = null;
    }, 2000);
  }, [conversation, lessonPhase]);

  // Face Absence Logic
  const handleFaceAbsent = useCallback((duration) => {
    setFaceAbsent(true);
    if (conversation && conversation.sendUserMessage) {
      conversation.sendUserMessage('[STUDENT_LEFT_SCREEN]');
    }
  }, [conversation]);

  const handleFaceReturned = useCallback(() => {
    setFaceAbsent(false);
    if (conversation && conversation.sendUserMessage) {
      conversation.sendUserMessage('[STUDENT_RETURNED]');
    }
  }, [conversation]);

  // --- 4. MEDIAPIPE SETUP ---
  const initializeCamera = useCallback(async (stream) => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;

    // Wait for video metadata and first frame before initializing models
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(() => resolve());
      };
    });

    console.log('📷 Video Metadata loaded. Initializing Holistic Model...');

    // CRITICAL: Dynamically set canvas size to match video (common React bug: canvas starts 0x0)
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      console.log('🔧 Canvas resized to:', canvas.width, 'x', canvas.height);
    }

    // Initialize ONLY Holistic (includes face landmarks; removes need for separate FaceDetection)
    const VERSION = '0.5.1675471629';
    const holistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@${VERSION}/${file}`
    });

    holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    // Single model result handler
    holistic.onResults((results) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // --- FACE ABSENCE DETECTION (using Holistic faceLandmarks) ---
      const now = Date.now();
      const state = detectionStateRef.current;
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        state.lastFaceDetectedTime = now;
        if (state.isAbsent) {
          state.isAbsent = false;
          console.log('📹 Face returned');
          handleFaceReturned();
        }
      } else if (now - state.lastFaceDetectedTime > 3000 && !state.isAbsent) {
        state.isAbsent = true;
        console.warn('📹 Face absent for 3s');
        handleFaceAbsent(now - state.lastFaceDetectedTime);
      }

      // Debug header: which landmarks are present
      console.debug('🛰️ Holistic.onResults:', {
        pose: !!results.poseLandmarks,
        leftHand: !!results.leftHandLandmarks,
        rightHand: !!results.rightHandLandmarks,
        face: !!results.faceLandmarks
      });

      // Throttled hand logging
      try {
        const nowLog = Date.now();
        if (nowLog - lastHandLogRef.current > 500) {
          lastHandLogRef.current = nowLog;
          const left = results.leftHandLandmarks;
          const right = results.rightHandLandmarks;
          console.debug('🖐 Hands:', {
            cmd: activeCommandRef.current,
            leftCount: left ? left.length : 0,
            rightCount: right ? right.length : 0
          });
        }
      } catch (e) {
        // silent
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const activeCommand = activeCommandRef.current;
      const state2 = detectionStateRef.current;
      const landmarks = results.poseLandmarks;

      if (landmarks) {
        // 1. WAVE
        if (activeCommand === 'WAVE') {
          const handLandmarks = results.rightHandLandmarks || results.leftHandLandmarks;
          if (handLandmarks) {
            drawConnectors(ctx, handLandmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
            drawLandmarks(ctx, handLandmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
            const wrist = handLandmarks[0];
            const indexTip = handLandmarks[8];
            const middleTip = handLandmarks[12];
            if (indexTip && middleTip && wrist && indexTip.y < wrist.y) {
              const now = Date.now();
              if (!state2.isWaving) {
                state2.isWaving = true;
                state2.waveStartTime = now;
                state2.waveCount = 1;
              } else if (now - state2.lastWaveTime > 200) {
                state2.waveCount++;
                state2.lastWaveTime = now;
                if (state2.waveCount >= 3) {
                  handleCommandSuccess('WAVE');
                  state2.waveCount = 0;
                }
              }
            }
          }
        }

        // 2. CLAP
        if (activeCommand === 'CLAP') {
          const leftWrist = landmarks[15];
          const rightWrist = landmarks[16];
          const leftIndex = landmarks[19];
          const rightIndex = landmarks[20];

          if (leftWrist && rightWrist && leftIndex && rightIndex) {
            const wristDist = Math.hypot(leftWrist.x - rightWrist.x, leftWrist.y - rightWrist.y);
            const indexDist = Math.hypot(leftIndex.x - rightIndex.x, leftIndex.y - rightIndex.y);

            if ((wristDist < 0.25 || indexDist < 0.25) && !state2.isProcessingClap) {
              state2.isProcessingClap = true;
              state2.clapCount += 1;
              console.debug('👏 Clap count:', state2.clapCount);
              if (state2.clapCount >= 2) handleCommandSuccess('CLAP');
              setTimeout(() => { state2.isProcessingClap = false; }, 500);
            }
          }
        }

        // 3. NOSE TOUCH
        if (activeCommand === 'NOSE_TOUCH' && results.faceLandmarks) {
          const noseIndices = [1, 4, 5, 6, 197, 195];
          const nosePoints = noseIndices.map(idx => results.faceLandmarks[idx]).filter(p => p);
          const leftHand = results.leftHandLandmarks;
          const rightHand = results.rightHandLandmarks;

          const checkTouch = (hand) => {
            if (!hand) return false;
            const fingerTips = [4, 8, 12, 16, 20].map(idx => hand[idx]);
            return fingerTips.some(tip => {
              return nosePoints.some(nose => {
                if (!tip || !nose) return false;
                const dist = Math.hypot(tip.x - nose.x, tip.y - nose.y);
                return dist < 0.20;
              });
            });
          }

          if (checkTouch(leftHand) || checkTouch(rightHand)) {
            state2.noseTouchStreak++;
            const now = Date.now();
            if (state2.noseTouchStreak >= 3 && now - state2.lastNoseTouchAt > 1500) {
              state2.lastNoseTouchAt = now;
              handleCommandSuccess('NOSE_TOUCH');
            }
          } else {
            state2.noseTouchStreak = 0;
          }
        }

        // 4. RAISE HAND
        if (activeCommand === 'RAISE_HAND') {
          const nose = landmarks[0];
          const leftWrist = landmarks[15];
          const rightWrist = landmarks[16];
          if (nose && leftWrist && rightWrist) {
            if (leftWrist.y < nose.y || rightWrist.y < nose.y) {
              handleCommandSuccess('RAISE_HAND');
            }
          }
        }
      }

      ctx.restore();
    });

    holisticRef.current = holistic;

    // Single model processing loop
    const processFrame = async () => {
      if (!streamRef.current || !isCameraOnRef.current) return;

      const videoEl = videoRef.current;
      if (videoEl && videoEl.readyState === 4 && videoEl.videoWidth > 0) {
        try {
          await holistic.send({ image: videoEl });
        } catch (err) {
          console.error('Holistic error:', err);
        }
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();

  }, [handleCommandSuccess, handleFaceAbsent, handleFaceReturned]);

  // --- NEW: INTRO VIDEO HANDLERS ---
  const handleStartClick = () => {
    setStatus('intro_video');
  };

  const handleVideoEnd = () => {
    console.log('📹 VIDEO ENDED — Starting camera and conversation');
    startCameraAndConversation();
  };

  // --- 5. START SESSION (FIXED WITH DELAY) ---
  const startCameraAndConversation = async () => {
    isCameraOnRef.current = true;
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎥 STARTING SESSION');
    if (hasStartedRef.current) {
      console.log('  ⚠️  Session already started, returning.');
      return;
    }
    hasStartedRef.current = true;
    console.log('  ✓ hasStartedRef set to true');
    setStatus('active');
    console.log('  ✓ Status set to: active');

    try {
      console.log('\n  📋 Step 1: Get camera stream...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
      streamRef.current = stream;
      console.log('    ✓ Camera stream obtained');

      console.log('\n  📋 Step 2: Trigger React render...');
      setIsCameraOn(true);
      console.log('    ✓ isCameraOn set to true');

      console.log('\n  📋 Step 3: Wait for <video> tag to appear in DOM...');
      await new Promise(resolve => setTimeout(resolve, 300));
      console.log('    ✓ Waited 300ms');

      console.log('\n  📋 Step 4: Initialize MediaPipe...');
      if (videoRef.current) {
        console.log('    ✓ videoRef ready, initializing camera...');
        await initializeCamera(stream);
      } else {
        console.log('    ⚠️  videoRef not ready, waiting one more time...');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (videoRef.current) {
          console.log('    ✓ videoRef now ready, initializing camera...');
          await initializeCamera(stream);
        }
      }

      console.log('\n  📋 Step 5: Prepare agent config...');
      const studentName = username || HARDCODED_USERNAME;
      console.log('    ✓ Student name resolved:', studentName);

      const config = {
        agentId: 'agent_4701kadwvc69fkvs5ycwka6p0gr3', // UPDATE WITH YOUR ID
        overrides: {
          agent: {
            prompt: {
              prompt: `You are Blizz, You are conducting an interactive lesson for a child named ${studentName}.

## PERSONALIZATION
- The student's name is available as the value of the variable ` + "studentName" + ` (and this prompt also interpolates ${username || 'Explorer'}). Always address the student by name when appropriate: use the name in the introduction, during transitions between phases, and when praising or encouraging. If the name is missing, use 'Explorer'.

## IMPORTANT: DO NOT DISCONNECT EARLY
- Under no circumstances should you call the tool \`endCall\` or otherwise disconnect the call before the lesson has fully completed (i.e., after Phase 4 and the explicit lesson completion sequence).
- If the student says "bye", "goodbye", "see you", or asks to end the call during the lesson, acknowledge kindly (for example: "I'll be here when you're ready — let's keep going!") or offer a short pause, but DO NOT end the session. Continue with the lesson flow or re-engage the student with a gentle prompt.

## GLOBAL RULE: THE 2-ATTEMPT LIMIT
For every question or command, you allow exactly **TWO attempts**:
1. **First Attempt:** If wrong/silent, give the specific **HINT** listed below.
2. **Second Attempt:** If wrong/silent again, **REVEAL THE ANSWER** immediately and move to the next step. Never ask a third time.

## AVAILABLE TOOLS:
1. **changeLessonPhase** - Call with: phase='WARMUP', 'PART_A', 'PART_B', or 'PART_C'
2. **endCall** - Call this ONLY when the lesson is totally finished.

## PHASE 0: INTRODUCTION (Setting the Scene)
**Current Phase:** INTRO

- **Goal:** Introduce yourself and explain the activity.
- **Say:** "Hi there, Explorer! I am Blizz! Today we are going to learn all about **COMMANDS** and **BOSSY VERBS**! We are going to do a wiggle workout, throw some snowballs, and take a fun quiz. Are you ready to get moving?"
- **Wait for response.**

**HANDLING RESPONSES:**
- **IF POSITIVE/READY:** - Say: "Awesome! Let's start with the Wiggle Workout!" 
  - **GO TO PHASE 1**

- **IF NEGATIVE/HESITANT (e.g., "No", "I'm tired"):** - Say: "Aww, don't worry! I promise it will be super fun and easy. We'll do it together! Let's just try the first move!" 
  - **GO TO PHASE 1**

---

## PHASE 1: PHYSICAL COMMANDS (The Wiggle Workout)
**Current Phase:** WARMUP

1. **Command 1 (Clap):**
   - Say: "Here comes your first command… Clap your hands twice!"
   - **IF [STUDENT_CLAPPED]:** "You did it! That was perfect clapping!"
   - **IF FAIL (1st time):** "Give it another try, Explorer — two claps!"
   - **IF FAIL (2nd time):** "That was a tricky one! The answer was to clap like this! *Clap clap*. Let's try the next one."

2. **Command 2 (Nose):**
   - Say: "Great job! Ready for command number two? Touch your nose!"
   - **IF [STUDENT_TOUCHED_NOSE]:** "Nice! You followed that command SO quickly!"
   - **IF FAIL (1st time):** "Try again, Explorer — touch your nose."
   - **IF FAIL (2nd time):** "Oops! The answer was to touch your nose *boop*! Let's do the last one."

3. **Command 3 (Raise Hand):**
   - Say: "All right… last one for this round! Raise one hand up high!"
   - **IF [STUDENT_RAISED_HAND]:** "Woo-hoo! Look at that hand go! You nailed all the commands!"
   - **IF FAIL (1st time):** "Give it another go — raise one hand up high!"
   - **IF FAIL (2nd time):** "Good try! The answer was to raise your hand high! You are still amazing!"

**TRANSITION:**
Say: "Fantastic command-following, Explorer. Now let's see how well you can SPOT commands and bossy verbs!"
THEN CALL TOOL: changeLessonPhase(phase='PART_A')

---

## PHASE 2: THE BOSSY VERB (The Snowball)
**Current Phase:** PART_A
**Visual:** "Throw the snowball high" is on screen.

- Say: "Okay, here’s your next challenge… Look at this sentence: 'Throw the snowball high.' Explorer… say the bossy verb out loud. Which word tells someone what to do?"
  
**HANDLING ANSWERS:**
- **CORRECT ("Throw"):** Say: "Yes! 'Throw' is the bossy verb! It tells you what to do!"
  THEN CALL TOOL: changeLessonPhase(phase='PART_B')

- **WRONG (1st Attempt):** Say: "Give it another go, Explorer. Think about the first word… which action word is telling someone what to do?"

- **WRONG (2nd Attempt - REVEAL ANSWER):** Say: "Actually, the bossy verb is **THROW**. It tells you to throw the snowball! Let's try the next game."
  THEN CALL TOOL: changeLessonPhase(phase='PART_B')

---

## PHASE 3: IDENTIFY THE COMMAND (The Quiz)
**Current Phase:** PART_B

1. **Setup:**
   - Say: "Great! Now… which one of these is a COMMAND? I'll read each sentence. Listen carefully!"
   - Say: "One… 'The flowers are very colourful.'"
   - Say: "Two… 'Can you water the flowers?'"
   - Say: "Three… 'Pick a flower for me.'"

2. **Question 1 (Find the Sentence):**
   - Say: "Now Explorer… can you tell me the sentence that is the command? Say it out loud."

   - **CORRECT ("Number 3" or "Pick a flower"):** Say: "Yes! 'Pick a flower for me' is the command!" -> **GO TO FOLLOW-UP**

   - **WRONG (1st Attempt):** Say: "Give it another try, Explorer… a command tells someone what to DO. Listen again and say the sentence that gives an instruction."

   - **WRONG (2nd Attempt - REVEAL ANSWER):**
     Say: "The command is **Number 3: Pick a flower for me**, because it tells you to pick something!" -> **GO TO FOLLOW-UP**

3. **Follow-Up (Find the Verb):**
   - Say: "Explorer… can you tell me the bossy verb in that command? Say the bossy verb out loud."

   - **CORRECT ("Pick"):**
     Say: "Correct! 'Pick' is the bossy verb — it tells someone what to do!"
     Say: "Okay… time for a TRICKY one! The punctuation has disappeared!"
     THEN CALL TOOL: changeLessonPhase(phase='PART_C')

   - **WRONG (1st Attempt):** Say: "Try again… the bossy verb is the action word — the one that tells someone what to do."

   - **WRONG (2nd Attempt - REVEAL ANSWER):** 
     Say: "The bossy verb is **PICK**. It tells someone to pick the flower!"
     Say: "Okay… time for a TRICKY one! The punctuation has disappeared!"
     THEN CALL TOOL: changeLessonPhase(phase='PART_C')

---
## PHASE 4: MISSING PUNCTUATION (Final Challenge)
**Current Phase:** PART_C
**Visual:** Sentences without punctuation marks.

1. **Setup & Reading:**
   - Say: "One of these is STILL a command. Listen carefully while I read them."
   - Say: "One… will you help your friend"
   - Say: "Two… stop right there"
   - Say: "Three… the sky is turning grey"

2. **Question:**
   - Say: "Explorer… tell me the sentence that is the command. Say it out loud."
   - **CORRECT ("Stop right there" OR "Number 2"):** Say: "Yes! 'Stop right there' is the command!" -> **GO TO FOLLOW-UP**
   - **WRONG (1st):** Say: "Good try, but remember, a command tells someone what to DO. Have another go."
   - **WRONG (2nd):** Say: "Think about the one that STARTS with an action word... The command is: 'Stop right there'." -> **GO TO FOLLOW-UP**

3. **Follow-Up (Bossy Verb):**
   - Say: "Now tell me the bossy verb in that command."
   - **CORRECT ("Stop"):** Say: "Exactly! 'Stop' is the bossy verb! You did amazing today!"
   - **WRONG (1st):** Say: "Try again… which word is the action word at the very beginning?"

4. **TERMINATION:**
   -  You did great today! Thanks for playing, bye bye!"
   - Only now that the user has finished Phase 4, trigger: \`[LESSON_COMPLETE]\`
   - CALL TOOL: "endCall()"
`,
              firstMessage: `Hi ${studentName}! I'm Blizz! Are you ready to play?`
            }
            ,
            studentName: studentName
          }
        }
      };

      console.log('\n  📋 Step 6: Start ElevenLabs session...');
      console.log('    ✓ Agent ID:', config.agentId);
      console.log('    ✓ Student name in config:', config.overrides.agent.studentName);
      console.log('    ✓ First message:', config.overrides.agent.prompt.firstMessage);
      console.log('═══════════════════════════════════════════════════════════════\n');
      await startSession(config);

    } catch (error) {
      console.error('❌ FAILED:', error);
      setErrorMessage('Failed to start. Check camera permissions.');
      setStatus('error');
      hasStartedRef.current = false;
      stopCamera();
    }
  };

  // --- 6. SESSION COMPLETION ---
  const handleSessionComplete = useCallback(async () => {
    if (status === 'completed') return; // guard: don't run twice
    console.log('✅ handleSessionComplete triggered. isFinishing:', isFinishing, 'isSpeaking:', isSpeaking);
    setStatus('completed');
    setCurrentCommand(null);
    try { stopCamera(); } catch (e) { console.error('Error stopping camera:', e); }
    if (endSession) {
      try { await endSession(); } catch (e) { console.error('Error ending session:', e); }
    }
    // Show the End of Activity button after 5 seconds
    setTimeout(() => {
      setShowEndButton(true);
    }, 5000);
  }, [status, stopCamera, endSession]);

  useEffect(() => {
    if (isFinishing && !isSpeaking) {
      const timer = setTimeout(() => handleSessionComplete(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isFinishing, isSpeaking, handleSessionComplete]);

  const skipSession = () => {
    stopCamera();
    if (endSession) endSession();
    navigate('/dash');
  };

  return (
    <div className="warmup-session-container">
      <div
        className="warmup-background"
        style={{
          backgroundColor: '#4aa0e7ff',
          backgroundImage: `url(${snowBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundBlendMode: 'overlay'
        }}
        aria-hidden="true"
      />

      {status !== 'intro_video' && (
        <div className="camera-widget">
          <div className="camera-frame">

            {/* PHASE 1: WARMUP (Camera On) */}
            {lessonPhase === 'WARMUP' && isCameraOn && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="camera-video"
                  style={{ transform: 'scaleX(-1)' }}
                />
                <canvas
                  ref={canvasRef}
                  width="640"
                  height="480"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    transform: 'scaleX(-1)'
                  }}
                />
              </>
            )}

            {/* PHASE 2: PART_A (Snowball) */}
            {lessonPhase === 'PART_A' && (
              <div className="verbal-challenge-container">
                {/* Snowfall overlay (animated) */}
                <div className="snowfall-overlay" aria-hidden="true" />
                {/* Snowball image */}
                <img src={snowballImg} alt="Snowball" className="snowball-img" />
                <h1 className="big-sentence">
                  <span className="highlight-word">Throw</span> the snowball high.
                </h1>
                <p className="instruction-sub">Say the <b>Bossy Verb</b> out loud!</p>
              </div>
            )}

            {/* PHASE 3: PART_B (Quiz) */}
            {lessonPhase === 'PART_B' && (
              <div className="verbal-challenge-container" style={{ minHeight: '400px' }}> {/* Force container height */}
                <h2 className="quiz-title">Which one is a COMMAND?</h2>

                <div className="sentence-list" style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>

                  {partBSentences.map((text, idx) => (
                    <div
                      key={idx}
                      className="sentence-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px',
                        padding: '15px',
                        borderRadius: '12px',
                        background: 'rgba(255, 255, 255, 0.95)',
                        opacity: visibleSentences >= idx + 1 ? 1 : 0,
                        transition: 'opacity 0.45s ease, transform 0.45s ease',
                        transform: visibleSentences >= idx + 1 ? 'translateY(0)' : 'translateY(10px)'
                      }}
                    >
                      <span className="number-badge" style={{
                        background: '#FF5722', color: 'white',
                        width: '35px', height: '35px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        borderRadius: '50%', fontWeight: 'bold'
                      }}>{idx + 1}</span>
                      <p style={{ margin: 0, color: '#333', fontSize: '1.2rem', fontWeight: '500' }}>{text}</p>
                    </div>
                  ))}

                </div>
              </div>
            )}

            {/* PHASE 4: PART_C (Missing Punctuation) */}
            {lessonPhase === 'PART_C' && (
              <div className="verbal-challenge-container" style={{ minHeight: '400px' }}>
                <div className="snowball-animation">❄️</div>

                <p className="instruction-sub">Find the COMMAND!</p>
                <div className="sentence-list" style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
                  {partCSentences.map((text, i) => (
                    <div key={i} className="sentence-item"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '15px', padding: '15px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.95)',
                        opacity: visibleSentences >= i + 1 ? 1 : 0,
                        transform: visibleSentences >= i + 1 ? 'translateY(0)' : 'translateY(10px)',
                        transition: 'all 0.5s ease'
                      }}>
                      <span className="number-badge" style={{ background: '#2196F3', color: 'white', width: '35px', height: '35px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontWeight: 'bold' }}>{i + 1}</span>
                      <p style={{ margin: 0, color: '#333', fontSize: '1.2rem', fontWeight: '500', fontFamily: 'monospace' }}>{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Camera Off Placeholder */}
            {lessonPhase === 'WARMUP' && !isCameraOn && (
              <div className="camera-placeholder"><div className="camera-icon">📹</div></div>
            )}

            {/* Feedback Overlays */}
            {commandCompleted && lessonPhase === 'WARMUP' && (
              <div className="mini-feedback success">✅ Nice!</div>
            )}
            {commandCompleted && lessonPhase !== 'WARMUP' && (
              <div className="feedback-overlay success">✅ Great Job!</div>
            )}
            {faceAbsent && lessonPhase === 'WARMUP' && <div className="mini-feedback warning">😶 Where did you go?</div>}

          </div>
        </div>
      )}

      {/* Command text at bottom (Only for Warmup) */}
      {currentCommand && lessonPhase === 'WARMUP' && (
        <div className="word-display-container">
          <div className="word-display" style={{ backgroundColor: commandCompleted ? '#4CAF50' : '#2196F3' }}>
            {currentCommand}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="warmup-main-content">
        {status === 'ready' && (
          <>
            <h1 className="welcome-title">Welcome, {username}!</h1>
            <button onClick={handleStartClick} className="start-btn">Start</button>
          </>
        )}

        {status === 'intro_video' && (
          <div className="video-wrapper" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: '#000',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <video
              src={commandsVideo}
              autoPlay
              controls
              onEnded={handleVideoEnd}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <button
              onClick={handleVideoEnd}
              style={{
                position: 'absolute',
                bottom: '40px',
                right: '40px',
                padding: '15px 40px',
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '2px solid rgba(255, 255, 255, 0.5)',
                borderRadius: '50px',
                cursor: 'pointer',
                fontSize: '1.2rem',
                fontWeight: 'bold',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.4)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              Skip Video ⏭️
            </button>
          </div>
        )}

        {status === 'initializing' && <div className="status-container"><div className="spinner"></div><p>Getting things ready...</p></div>}

        {status === 'active' && (
          <div className="active-container">
            <VoiceAgentUI isSpeaking={isSpeaking} />

            {/* --- NEW CODE: Agent Transcript --- */}
            <div className="agent-transcript-box">
              {latestAgentMessage ? (
                <p className="agent-text">{latestAgentMessage}</p>
              ) : (
                <p className="agent-placeholder">...</p>
              )}
            </div>
            {/* ---------------------------------- */}
          </div>
        )}

        {status === 'completed' && (
          <div className="status-container">
            <p>🎉 Lesson Complete!</p>
            {showEndButton && (
              <button
                onClick={() => navigate('/dash')}
                className="start-btn"
                style={{ marginTop: '20px' }}
              >
                End of Activity
              </button>
            )}
          </div>
        )}

        {status === 'error' && <div className="error-container"><p>{errorMessage}</p><button onClick={skipSession} className="skip-btn">Skip</button></div>}
      </div>
    </div>
  );
};

export default CommandsWarmUpSession;