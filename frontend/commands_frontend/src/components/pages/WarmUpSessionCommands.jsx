import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversation } from '@elevenlabs/react';
import './WarmUpSession.css';

import { HAND_CONNECTIONS } from '@mediapipe/hands';
import { FaceDetection } from '@mediapipe/face_detection';
import { Holistic } from '@mediapipe/holistic';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import snowGif from '../../assets/snow_gif.gif';
import snowballImg from '../../assets/Snowball.png';

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
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('initializing');
  const [errorMessage, setErrorMessage] = useState('');

  // Camera & UI State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Game Logic State
  const [currentCommand, setCurrentCommand] = useState(null);
  const [commandCompleted, setCommandCompleted] = useState(false);
  const [score, setScore] = useState(0);
  const [faceAbsent, setFaceAbsent] = useState(false);

  // --- PHASES & UI STATE ---
  // Phases: 'WARMUP' -> 'PART_A' -> 'PART_B' -> 'PART_C' -> 'COMPLETED'
  const [lessonPhase, setLessonPhase] = useState('WARMUP');
  const [visibleSentences, setVisibleSentences] = useState(0);

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

  // Detection counters
  const detectionStateRef = useRef({
    clapCount: 0,
    isProcessingClap: false,
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
    if (faceDetectionRef.current) {
      faceDetectionRef.current.close();
      faceDetectionRef.current = null;
    }
    setIsCameraOn(false);
  }, []);

  // --- 2. ELEVENLABS CONFIGURATION ---
  const conversation = useConversation({
    // Define tools for the Agent to control the UI
    clientTools: {
      changeLessonPhase: ({ phase }) => {
        console.log(`🛠️ Tool Called: changeLessonPhase -> ${phase}`);
        if (phase === 'PART_A') {
          stopCamera(); // Turn off camera when moving to Snowball phase
        }
        // Reset visible sentences when changing phase (ensures PART_C starts with hidden sentences)
        setVisibleSentences(0);
        setLessonPhase(phase);
        return `Phase changed to ${phase}`;
      },
      revealSentence: (params) => {
        console.log(`🛠️ Tool Called: revealSentence with params:`, params);
        // Handle the parameter name from ElevenLabs config
        let index = params?.sentenceNumber ?? params?.sentenceIndex ?? params?.index ?? 1;
        console.log(`📊 Extracted sentence number: ${index}`);
        setVisibleSentences(Number(index));
        return `Sentence ${index} revealed`;
      }
    },
    onConnect: () => console.log('✅ Connected to ElevenLabs'),
    onMessage: (message) => {
      let messageText = '';
      if (message.message) messageText = message.message.toLowerCase();
      else if (message.text) messageText = message.text.toLowerCase();
      else if (message.messages?.find(m => m.type === 'text')) {
        messageText = message.messages.find(m => m.type === 'text').text.toLowerCase();
      }

      // --- PHYSICAL COMMAND DETECTION (Only in WARMUP) ---
      if (lessonPhase === 'WARMUP') {
        // Wave
        if (messageText.includes('wave') && (messageText.includes('can you') || messageText.includes('try'))) {
          if (activeCommandRef.current !== 'WAVE' || commandCompletedRef.current) {
            activeCommandRef.current = 'WAVE';
            commandCompletedRef.current = false;
            setCurrentCommand('👋 WAVE');
            setCommandCompleted(false);
          }
        }
        // Clap
        if (messageText.includes('clap') && (messageText.includes('can you') || messageText.includes('try') || messageText.includes('hands'))) {
          if (activeCommandRef.current !== 'CLAP' || commandCompletedRef.current) {
            activeCommandRef.current = 'CLAP';
            commandCompletedRef.current = false;
            setCurrentCommand('👏 CLAP');
            setCommandCompleted(false);
            detectionStateRef.current.clapCount = 0;
          }
        }
        // Touch Nose
        if ((messageText.includes('touch') || messageText.includes('point')) && messageText.includes('nose')) {
          if (activeCommandRef.current !== 'NOSE_TOUCH' || commandCompletedRef.current) {
            activeCommandRef.current = 'NOSE_TOUCH';
            commandCompletedRef.current = false;
            setCurrentCommand('👃 TOUCH NOSE');
            setCommandCompleted(false);
            detectionStateRef.current.noseTouchStreak = 0;
          }
        }
        // Raise Hand
        if (messageText.includes('raise') && messageText.includes('hand')) {
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
    onDisconnect: () => console.log('🔌 Disconnected')
  });

  const { status: convStatus, isSpeaking, startSession, endSession } = conversation;

  // --- 3. INITIALIZATION ---
  useEffect(() => {
    const storedUsername = sessionStorage.getItem('username') || 'Explorer';
    setUsername(storedUsername);
    setStatus('ready');
  }, []);

  // --- SAFETY NET: Auto-reveal if AI fails ---
  useEffect(() => {
    // If we are in PART_B OR PART_C but nothing is visible yet...
    if ((lessonPhase === 'PART_B' || lessonPhase === 'PART_C') && visibleSentences === 0) {
      console.log("⏳ Waiting for AI to reveal sentences...");

      // Set a timer: If AI doesn't reveal sentence 1 within 5 seconds, show ALL.
      const timer = setTimeout(() => {
        console.log("⚠️ AI slow/failed to reveal. Forcing display of all sentences.");
        setVisibleSentences(3); // Force show all
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [lessonPhase, visibleSentences]);

  // Handle Gesture Success
  const handleCommandSuccess = useCallback((commandType) => {
    if (commandCompletedRef.current) return;
    commandCompletedRef.current = true;
    setCommandCompleted(true);
    setScore(prev => prev + 10);

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
  }, [conversation]);

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
    await video.play();

    const holistic = new Holistic({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}` });
    holistic.setOptions({ modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

    const faceDetection = new FaceDetection({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}` });
    faceDetection.setOptions({ model: 'short', minDetectionConfidence: 0.5 });

    // Process Holistic Results (Hands/Pose)
    holistic.onResults((results) => {
      const canvas = canvasRef.current;
      if (!canvas || !results.poseLandmarks) return;
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const activeCommand = activeCommandRef.current;
      const state = detectionStateRef.current;
      const landmarks = results.poseLandmarks;

      // 1. WAVE
      if (activeCommand === 'WAVE') {
        const handLandmarks = results.rightHandLandmarks || results.leftHandLandmarks;
        if (handLandmarks) {
          drawConnectors(ctx, handLandmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
          drawLandmarks(ctx, handLandmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
          const wrist = handLandmarks[0];
          const indexTip = handLandmarks[8];
          const middleTip = handLandmarks[12];
          if (indexTip && middleTip && indexTip.y < wrist.y) {
            const now = Date.now();
            if (!state.isWaving) {
              state.isWaving = true;
              state.waveStartTime = now;
              state.waveCount = 1;
            } else if (now - state.lastWaveTime > 200) {
              state.waveCount++;
              state.lastWaveTime = now;
              if (state.waveCount >= 3) {
                handleCommandSuccess('WAVE');
                state.waveCount = 0;
              }
            }
          }
        }
      }

      // 2. CLAP
      if (activeCommand === 'CLAP') {
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];
        const dist = Math.hypot(leftWrist.x - rightWrist.x, leftWrist.y - rightWrist.y);
        if (dist < 0.15 && !state.isProcessingClap) {
          state.isProcessingClap = true;
          state.clapCount += 1;
          if (state.clapCount >= 2) handleCommandSuccess('CLAP');
          setTimeout(() => { state.isProcessingClap = false; }, 500);
        }
      }

      // 3. NOSE TOUCH
      if (activeCommand === 'NOSE_TOUCH' && results.faceLandmarks) {
        const faceNose = results.faceLandmarks[1];
        const leftHand = results.leftHandLandmarks;
        const rightHand = results.rightHandLandmarks;
        const checkTouch = (hand) => {
          if (!hand) return false;
          const index = hand[8];
          return Math.hypot(index.x - faceNose.x, index.y - faceNose.y) < 0.08;
        }
        if (checkTouch(leftHand) || checkTouch(rightHand)) {
          state.noseTouchStreak++;
          const now = Date.now();
          if (state.noseTouchStreak >= 3 && now - state.lastNoseTouchAt > 1500) {
            state.lastNoseTouchAt = now;
            handleCommandSuccess('NOSE_TOUCH');
          }
        } else {
          state.noseTouchStreak = 0;
        }
      }

      // 4. RAISE HAND
      if (activeCommand === 'RAISE_HAND') {
        const nose = landmarks[0];
        const leftWrist = landmarks[15];
        const rightWrist = landmarks[16];
        if (leftWrist.y < nose.y || rightWrist.y < nose.y) {
          handleCommandSuccess('RAISE_HAND');
        }
      }
      ctx.restore();
    });

    // Process Face Detection
    faceDetection.onResults((results) => {
      const now = Date.now();
      const state = detectionStateRef.current;
      if (results.detections?.length > 0) {
        state.lastFaceDetectedTime = now;
        if (state.isAbsent) {
          state.isAbsent = false;
          handleFaceReturned();
        }
      } else if (now - state.lastFaceDetectedTime > 3000 && !state.isAbsent) {
        state.isAbsent = true;
        handleFaceAbsent(now - state.lastFaceDetectedTime);
      }
    });

    holisticRef.current = holistic;
    faceDetectionRef.current = faceDetection;

    const processFrame = async () => {
      if (!video || video.readyState !== 4) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }
      await holistic.send({ image: video });
      await faceDetection.send({ image: video });
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };
    processFrame();

  }, [handleCommandSuccess, handleFaceAbsent, handleFaceReturned]);


  // --- 5. START SESSION (FIXED WITH DELAY) ---
  const startCameraAndConversation = async () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setStatus('active');

    try {
      // 1. Get Stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
      streamRef.current = stream;

      // 2. Trigger React Render
      setIsCameraOn(true);

      // 3. CRITICAL FIX: Wait 300ms for the <video> tag to appear in the DOM
      await new Promise(resolve => setTimeout(resolve, 300));

      // 4. Initialize MediaPipe
      if (videoRef.current) {
        await initializeCamera(stream);
      } else {
        console.log("Video ref not ready, waiting one more time...");
        await new Promise(resolve => setTimeout(resolve, 500));
        if (videoRef.current) await initializeCamera(stream);
      }

      const config = {
        agentId: 'agent_4701kadwvc69fkvs5ycwka6p0gr3', // UPDATE WITH YOUR ID
        overrides: {
          agent: {
            prompt: {
              prompt: `You are Blizz, a super-energetic, funny AI friend. You are conducting an interactive lesson for a child named Explorer.

## GLOBAL RULE: THE 2-ATTEMPT LIMIT
For every question or command, you allow exactly **TWO attempts**:
1. **First Attempt:** If wrong/silent, give the specific **HINT** listed below.
2. **Second Attempt:** If wrong/silent again, **REVEAL THE ANSWER** immediately and move to the next step. Never ask a third time.

## AVAILABLE TOOLS:
1. **changeLessonPhase** - Call with: phase='WARMUP', 'PART_A', 'PART_B', or 'PART_C'
2. **revealSentence** - Call with: sentenceNumber=1 (for sentence 1), sentenceNumber=2 (for sentence 2), or sentenceNumber=3 (for sentence 3)

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
   - Say: "One… 'The flowers are very colourful.'" -> CALL TOOL: revealSentence(sentenceNumber=1)
   - Say: "Two… 'Can you water the flowers?'" -> CALL TOOL: revealSentence(sentenceNumber=2)
   - Say: "Three… 'Pick a flower for me.'" -> CALL TOOL: revealSentence(sentenceNumber=3)

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
   - THEN CALL TOOL: revealSentence(sentenceNumber=1)
   - Say: "One… will you help your friend"
   - THEN CALL TOOL: revealSentence(sentenceNumber=2)
   - Say: "Two… stop right there"
   - THEN CALL TOOL: revealSentence(sentenceNumber=3)
   - Say: "Three… the sky is turning grey"

2. **Question:**
   - Say: "Explorer… tell me the sentence that is the command. Say it out loud."
   - **CORRECT ("Stop right there" OR "Number 2"):** Say: "Yes! 'Stop right there' is the command!" -> **GO TO FOLLOW-UP**
   - **WRONG (1st):** Say: "Good try, but remember, a command tells someone what to DO. Have another go."
   - **WRONG (2nd):** Say: "Think about the one that STARTS with an action word... The command is: 'Stop right there'." -> **GO TO FOLLOW-UP**

3. **Follow-Up (Bossy Verb):**
   - Say: "Now tell me the bossy verb in that command."
   - **CORRECT ("Stop"):** Say: "Exactly! 'Stop' is the bossy verb! You did amazing today! [LESSON_COMPLETE]"
   - **WRONG (1st):** Say: "Try again… which word is the action word at the very beginning?"
   - **WRONG (2nd):** Say: "The bossy verb is STOP. You did great today! [LESSON_COMPLETE]"
`,
              firstMessage: `Hi ${username}! I'm Blizz! Are you ready to play?`
            }
          }
        }
      };

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
    if (status === 'completed') return;
    setStatus('completed');
    setCurrentCommand(null);
    stopCamera();
    if (endSession) await endSession();
    setTimeout(() => navigate('/dash', { state: { autoPlay: true } }), 2000);
  }, [status, stopCamera, endSession, navigate]);

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
          backgroundColor: '#0d0436ff',
          backgroundImage: `url(${snowGif})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
        aria-hidden="true"
      />

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

                {/* SENTENCE 1 */}
                <div
                  className="sentence-item"
                  style={{
                    display: 'flex', // Force layout so it takes space
                    alignItems: 'center',
                    gap: '15px',
                    padding: '15px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.9)', // White background for readability
                    opacity: visibleSentences >= 1 ? 1 : 0, // Fade in
                    transition: 'opacity 0.5s ease',
                    transform: visibleSentences >= 1 ? 'translateY(0)' : 'translateY(10px)', // Slight slide-up effect
                  }}
                >
                  <span className="number-badge" style={{
                    background: '#FF5722', color: 'white',
                    width: '35px', height: '35px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', fontWeight: 'bold'
                  }}>1</span>
                  <p style={{ margin: 0, color: '#333', fontSize: '1.2rem', fontWeight: '500' }}>The flowers are very colourful.</p>
                </div>

                {/* SENTENCE 2 */}
                <div
                  className="sentence-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    padding: '15px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.9)',
                    opacity: visibleSentences >= 2 ? 1 : 0,
                    transition: 'opacity 0.5s ease',
                    transform: visibleSentences >= 2 ? 'translateY(0)' : 'translateY(10px)',
                  }}
                >
                  <span className="number-badge" style={{
                    background: '#FF5722', color: 'white',
                    width: '35px', height: '35px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', fontWeight: 'bold'
                  }}>2</span>
                  <p style={{ margin: 0, color: '#333', fontSize: '1.2rem', fontWeight: '500' }}>Can you water the flowers?</p>
                </div>

                {/* SENTENCE 3 */}
                <div
                  className="sentence-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    padding: '15px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.9)',
                    opacity: visibleSentences >= 3 ? 1 : 0,
                    transition: 'opacity 0.5s ease',
                    transform: visibleSentences >= 3 ? 'translateY(0)' : 'translateY(10px)',
                  }}
                >
                  <span className="number-badge" style={{
                    background: '#FF5722', color: 'white',
                    width: '35px', height: '35px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', fontWeight: 'bold'
                  }}>3</span>
                  <p style={{ margin: 0, color: '#333', fontSize: '1.2rem', fontWeight: '500' }}>Pick a flower for me.</p>
                </div>

              </div>
            </div>
          )}

          {/* PHASE 4: PART_C (Missing Punctuation) */}
          {lessonPhase === 'PART_C' && (
            <div className="verbal-challenge-container" style={{ minHeight: '400px' }}>
              <div className="snowball-animation">❄️</div>
              <h2 className="quiz-title">Where did the punctuation go?</h2>
              <p className="instruction-sub">Find the COMMAND!</p>
              <div className="sentence-list" style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
                {['will you help your friend', 'stop right there', 'the sky is turning grey'].map((text, i) => (
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
          {commandCompleted && <div className="feedback-overlay success">✅ Great Job!</div>}
          {faceAbsent && lessonPhase === 'WARMUP' && <div className="feedback-overlay warning">😶 Where did you go?</div>}

        </div>
      </div>

      {/* Command text at bottom (Only for Warmup) */}
      {currentCommand && (
        <div className="word-display-container">
          <div className="word-display" style={{ backgroundColor: commandCompleted ? '#4CAF50' : '#2196F3' }}>
            {currentCommand}
          </div>
          <div className="score-display">Score: {score}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="warmup-main-content">
        {status === 'ready' && (
          <>
            <h1 className="welcome-title">Welcome, {username}!</h1>
            <button onClick={startCameraAndConversation} className="start-btn">Start</button>
          </>
        )}
        {status === 'initializing' && <div className="status-container"><div className="spinner"></div><p>Getting things ready...</p></div>}
        {status === 'active' && (
          <div className="active-container">
            <div className="listening-indicator">
              <div className="pulse-ring"></div>
            </div>
            <p className="status-text">{isSpeaking ? '🗣️ Blizz is speaking...' : '👂 Listening...'}</p>
          </div>
        )}
        {status === 'completed' && <div className="status-container"><p>🎉 Lesson Complete!</p></div>}
        {status === 'error' && <div className="error-container"><p>{errorMessage}</p><button onClick={skipSession} className="skip-btn">Skip</button></div>}
      </div>
    </div>
  );
};

export default CommandsWarmUpSession;